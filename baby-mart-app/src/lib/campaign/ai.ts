// ─── Campaign & CRM: grounded AI calls (server only) ─────────────────────────
//
// Every AI call the persona makes goes through runGrounded: a model from a fixed
// list, the prompt bound (never spliced), temperature 0, a required response
// schema, and a row in AI_RUN whatever happens -- including failures, because a
// failure hidden from the log is a silent failure. When the caller supplies the
// figures the answer may use, every number in the answer is checked against them
// (src/lib/ai/grounded.ts) and the run is marked verified or not.

import { S } from "./schema";
import { q, CmpError, NOW, type Row } from "./db";
import { verifyCitations } from "../ai/grounded";
import { MODELS } from "./config";
import { toNum } from "./format";

export type Grounded<T> = { runId: string; result: T; verified: boolean | null; unmatched: string[]; tokens: number | null };

function parseVariant(v: unknown): Row {
  if (v === null || v === undefined) return {};
  return typeof v === "string" ? JSON.parse(v) : (v as Row);
}

export async function defaultModel(): Promise<string> {
  const r = await q(`SELECT SETTING_VALUE FROM ${S}.CMP_SETTING WHERE SETTING_KEY = 'DEFAULT_MODEL'`);
  const m = String(r[0]?.SETTING_VALUE ?? "claude-sonnet-4-6");
  return (MODELS as readonly string[]).includes(m) ? m : "claude-sonnet-4-6";
}

/** responseFormatSql must be a Snowflake object literal built from constants in
 *  code, never from input: AI_COMPLETE does not take it as a bind. */
export async function runGrounded<T>(o: {
  stage: string;
  campaignId?: string | null;
  templateKey: string;
  prompt: string;
  responseFormatSql: string;
  user: string;
  question?: string | null;
  /** Figures the answer may cite. Null: nothing to verify (e.g. a spec). */
  figures?: unknown;
  /** Pull the prose to check out of the structured answer. */
  prose?: (r: T) => string[];
  cited?: (r: T) => string[];
  maxTokens?: number;
  model?: string;
}): Promise<Grounded<T>> {
  const model = o.model ?? (await defaultModel());
  if (!(MODELS as readonly string[]).includes(model)) throw new CmpError(409, `The model '${model}' is not supported.`);
  const runId = `AI-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const log = async (x: { response?: unknown; cited?: string[]; unmatched?: string[]; verified?: boolean | null; usage?: Row; error?: string }) => {
    await q(
      `INSERT INTO ${S}.AI_RUN (RUN_ID, STAGE, CAMPAIGN_ID, TEMPLATE_KEY, MODEL, QUESTION, GROUNDING_PAYLOAD, PROMPT_CHARS, RESPONSE,
         FIGURES_CITED, UNVERIFIED_FIGURES, IS_VERIFIED, PROMPT_TOKENS, COMPLETION_TOKENS, TOTAL_TOKENS, ERROR_MESSAGE, GENERATED_BY, GENERATED_AT)
       SELECT ?, ?, ?, ?, ?, ?, PARSE_JSON(?), ?, PARSE_JSON(?), PARSE_JSON(?), PARSE_JSON(?), ?, ?, ?, ?, ?, ?, ${NOW}`,
      [runId, o.stage, o.campaignId ?? null, o.templateKey, model, o.question ?? null, JSON.stringify(o.figures ?? null), o.prompt.length,
        x.response === undefined ? null : JSON.stringify(x.response), JSON.stringify(x.cited ?? []), JSON.stringify(x.unmatched ?? []),
        x.verified ?? null, toNum(x.usage?.prompt_tokens), toNum(x.usage?.completion_tokens), toNum(x.usage?.total_tokens), x.error ?? null, o.user],
    ).catch((e) => console.error("[cmp] AI_RUN log failed", e));
  };

  let raw: Row;
  try {
    const r = await q(
      `SELECT AI_COMPLETE(model => '${model}', prompt => ?, model_parameters => {'temperature': 0, 'max_tokens': ${Math.min(8000, o.maxTokens ?? 3500)}},
                          response_format => ${o.responseFormatSql}, show_details => TRUE) AS R`,
      [o.prompt],
    );
    if (r[0]?.R == null) throw new Error("The answer was cut off before it finished. Try again, or ask for less.");
    raw = parseVariant(r[0].R);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await log({ error: message.slice(0, 2000) });
    throw new CmpError(502, `The model did not answer: ${message.slice(0, 300)}`);
  }
  const structured = (raw.structured_output as Row[] | undefined)?.[0]?.raw_message as T | undefined;
  if (!structured) {
    await log({ response: raw, error: "The response did not follow the schema." });
    throw new CmpError(502, "The model's answer did not follow the required shape. It has been logged.");
  }
  let verified: boolean | null = null;
  let unmatched: string[] = [];
  const cited = o.cited ? o.cited(structured) : [];
  if (o.figures !== undefined && o.figures !== null) {
    const check = verifyCitations(o.figures, cited, o.prose ? o.prose(structured) : []);
    verified = check.verified;
    unmatched = check.unmatched;
  }
  const usage = raw.usage as Row | undefined;
  await log({ response: structured, cited, unmatched, verified, usage });
  return { runId, result: structured, verified, unmatched, tokens: toNum(usage?.total_tokens) };
}
