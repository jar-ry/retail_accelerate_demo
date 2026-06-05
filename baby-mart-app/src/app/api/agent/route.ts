import { querySnowflake, executeMultiple } from "@/lib/snowflake";
import { NextRequest, NextResponse } from "next/server";

interface AgentContentItem {
  type: string;
  text?: string;
  tool_result?: {
    content?: Array<{
      type: string;
      json?: {
        text?: string;
        result_set?: {
          data?: unknown[][];
          resultSetMetaData?: {
            rowType?: Array<{ name: string }>;
          };
        };
      };
    }>;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const message = body.message || "";

    const payload = JSON.stringify({
      messages: [
        { role: "user", content: [{ type: "text", text: message }] },
      ],
    });

    // Execute setup commands then the agent call
    const results = await executeMultiple([
      "USE DATABASE BABY_MART_DEMO",
      "USE SCHEMA AI",
      "USE WAREHOUSE DEMO_AI_WH",
      `SELECT TRY_PARSE_JSON(
        SNOWFLAKE.CORTEX.DATA_AGENT_RUN(
          'BABY_MART_DEMO.AI.CATEGORY_MANAGER_AGENT',
          $$${payload}$$
        )
      ) AS response`,
    ]);

    const agentResult = results[3];
    if (!agentResult || agentResult.length === 0 || !agentResult[0].RESPONSE) {
      return NextResponse.json({ content: "No response from agent.", tables: [] });
    }

    const respJson =
      typeof agentResult[0].RESPONSE === "string"
        ? JSON.parse(agentResult[0].RESPONSE)
        : agentResult[0].RESPONSE;

    const textParts: string[] = [];
    const tables: Array<{ columns: string[]; rows: unknown[][] }> = [];

    for (const item of (respJson.content || []) as AgentContentItem[]) {
      if (item.type === "text" && item.text) {
        textParts.push(item.text);
      } else if (item.type === "tool_result" && item.tool_result) {
        for (const tr of item.tool_result.content || []) {
          if (tr.type === "json" && tr.json) {
            if (tr.json.text) {
              textParts.push(tr.json.text);
            }
            const resultSet = tr.json.result_set;
            if (resultSet && resultSet.data) {
              const columns = (
                resultSet.resultSetMetaData?.rowType || []
              ).map((col) => col.name);
              tables.push({ columns, rows: resultSet.data });
            }
          }
        }
      }
    }

    const responseText =
      textParts.length > 0
        ? textParts.join("\n\n")
        : "I couldn't generate a response.";

    return NextResponse.json({ content: responseText, tables });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ content: `Error: ${message}`, tables: [] });
  }
}
