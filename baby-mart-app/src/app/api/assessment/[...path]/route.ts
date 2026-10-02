import { NextRequest, NextResponse } from "next/server";
import {
  querySnowflake, querySnowflakeWithBinds, toIsoDateTime,
} from "@/lib/snowflake";

// ─── AI Assessment API ────────────────────────────────────────────────────────
//
// Backs /settings (SOP + insight templates, with version history) and
// /assessment (run and review cross-dashboard assessments).
//
// A full assessment measured at ~52 seconds against Snowhouse: ~17K tokens of
// input through CORTEX.COMPLETE. Nothing else in this app sets maxDuration, and
// the default would cut that off, so it is raised here explicitly.
export const maxDuration = 300;

// SQL is written against BABY_MART_DEMO.* literally; querySnowflake pipes every
// statement through remapNamespace to rewrite the prefix for the target account.
// Do not build the FQN from env vars here.

// ─── Helpers ──────────────────────────────────────────────────────────────────

function num(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function str(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

/** Who is making the change, for the audit trail.
 *
 *  In App Runtime the caller's identity arrives as a header; locally it does
 *  not, so this falls back to a marker rather than pretending to know. Recording
 *  "unknown" honestly is more useful in an audit table than recording a
 *  hardcoded name that is wrong. */
function actor(request: NextRequest): string {
  return (
    request.headers.get("sf-context-current-user") ??
    request.headers.get("x-snowflake-user") ??
    "app-user"
  );
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const segments = path.map(decodeURIComponent);

  // Ordered longest-match-first. Without the try/catch a failing query returns
  // Next's HTML 500 page and the client's r.json() throws, which surfaces as an
  // endless spinner instead of the actual Snowflake error.
  try {
    if (segments[0] === "templates" && segments[2] === "history" && segments.length === 3) {
      return NextResponse.json(await handleTemplateHistory(segments[1]));
    }
    if (segments[0] === "templates" && segments.length === 2) {
      return NextResponse.json(await handleTemplate(segments[1]));
    }
    if (segments[0] === "templates" && segments.length === 1) {
      return NextResponse.json(await handleTemplates());
    }
    if (segments[0] === "runs" && segments.length === 2) {
      return NextResponse.json(await handleRun(segments[1]));
    }
    if (segments[0] === "runs" && segments.length === 1) {
      return NextResponse.json(await handleRuns());
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[assessment] GET /${segments.join("/")} failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const segments = path.map(decodeURIComponent);

  try {
    if (segments[0] === "templates" && segments.length === 1) {
      return await handleSaveTemplate(request);
    }
    if (segments[0] === "generate" && segments.length === 1) {
      return await handleGenerate(request);
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[assessment] POST /${segments.join("/")} failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const segments = path.map(decodeURIComponent);

  try {
    if (segments[0] === "templates" && segments.length === 2) {
      // The current row only. ASSESSMENT_TEMPLATE_HISTORY is deliberately left
      // intact: it is an audit trail, and deleting a template should not erase
      // the record that it once existed and what it said. SAVE_ASSESSMENT_TEMPLATE
      // reads the version counter from history, so recreating the same name later
      // continues numbering instead of colliding at version 1.
      await querySnowflakeWithBinds(
        `DELETE FROM BABY_MART_DEMO.ANALYTICS.ASSESSMENT_TEMPLATE
          WHERE TEMPLATE_NAME = ?`,
        [segments[1]]
      );
      return NextResponse.json({ deleted: segments[1] });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[assessment] DELETE /${segments.join("/")} failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── Templates ────────────────────────────────────────────────────────────────

function mapTemplate(r: Record<string, unknown>) {
  return {
    templateName: String(r.TEMPLATE_NAME),
    description: str(r.DESCRIPTION),
    sopText: str(r.SOP_TEXT) ?? "",
    templateText: str(r.TEMPLATE_TEXT) ?? "",
    scope: String(r.SCOPE),
    isDefault: r.IS_DEFAULT === true || r.IS_DEFAULT === "true",
    version: num(r.VERSION),
    updatedAt: toIsoDateTime(r.UPDATED_AT),
    updatedBy: str(r.UPDATED_BY),
  };
}

async function handleTemplates() {
  // The list view omits the two large text columns: a settings sidebar does not
  // need every SOP body, and sending them all makes the page slow for no gain.
  const rows = await querySnowflake(`
    SELECT TEMPLATE_NAME, DESCRIPTION, SCOPE, IS_DEFAULT, VERSION,
           UPDATED_AT, UPDATED_BY,
           LENGTH(SOP_TEXT)      AS SOP_CHARS,
           LENGTH(TEMPLATE_TEXT) AS TEMPLATE_CHARS,
           REGEXP_COUNT(TEMPLATE_TEXT, '^## ', 1, 'm') AS SECTION_COUNT
    FROM BABY_MART_DEMO.ANALYTICS.ASSESSMENT_TEMPLATE
    ORDER BY IS_DEFAULT DESC, TEMPLATE_NAME
  `);

  return {
    templates: rows.map((r) => ({
      templateName: String(r.TEMPLATE_NAME),
      description: str(r.DESCRIPTION),
      scope: String(r.SCOPE),
      isDefault: r.IS_DEFAULT === true || r.IS_DEFAULT === "true",
      version: num(r.VERSION),
      updatedAt: toIsoDateTime(r.UPDATED_AT),
      updatedBy: str(r.UPDATED_BY),
      sopChars: num(r.SOP_CHARS),
      templateChars: num(r.TEMPLATE_CHARS),
      sectionCount: num(r.SECTION_COUNT),
    })),
  };
}

async function handleTemplate(name: string) {
  const rows = await querySnowflakeWithBinds(
    `SELECT TEMPLATE_NAME, DESCRIPTION, SOP_TEXT, TEMPLATE_TEXT, SCOPE,
            IS_DEFAULT, VERSION, UPDATED_AT, UPDATED_BY
       FROM BABY_MART_DEMO.ANALYTICS.ASSESSMENT_TEMPLATE
      WHERE TEMPLATE_NAME = ?`,
    [name]
  );
  if (rows.length === 0) return { error: `Template "${name}" not found` };
  return mapTemplate(rows[0]);
}

async function handleTemplateHistory(name: string) {
  const rows = await querySnowflakeWithBinds(
    `SELECT TEMPLATE_NAME, VERSION, DESCRIPTION, SOP_TEXT, TEMPLATE_TEXT, SCOPE,
            CHANGED_AT, CHANGED_BY, CHANGE_NOTE
       FROM BABY_MART_DEMO.ANALYTICS.ASSESSMENT_TEMPLATE_HISTORY
      WHERE TEMPLATE_NAME = ?
      ORDER BY VERSION DESC`,
    [name]
  );

  return {
    templateName: name,
    history: rows.map((r) => ({
      version: num(r.VERSION),
      description: str(r.DESCRIPTION),
      sopText: str(r.SOP_TEXT) ?? "",
      templateText: str(r.TEMPLATE_TEXT) ?? "",
      scope: String(r.SCOPE),
      changedAt: toIsoDateTime(r.CHANGED_AT),
      changedBy: str(r.CHANGED_BY),
      changeNote: str(r.CHANGE_NOTE),
    })),
  };
}

async function handleSaveTemplate(request: NextRequest) {
  const body = await request.json();
  const name = String(body.templateName ?? "").trim();
  const templateText = String(body.templateText ?? "").trim();

  if (!name) {
    return NextResponse.json({ error: "templateName is required" }, { status: 400 });
  }
  if (!templateText) {
    return NextResponse.json(
      { error: "templateText is required: it defines the assessment's sections." },
      { status: 400 }
    );
  }

  // Every value bound, never interpolated. SOP text is free-form multi-line
  // prose that routinely contains apostrophes and quotes.
  const rows = await querySnowflakeWithBinds(
    `CALL BABY_MART_DEMO.ANALYTICS.SAVE_ASSESSMENT_TEMPLATE(?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      body.description ?? null,
      body.sopText ?? "",
      templateText,
      String(body.scope ?? "BOTH").toUpperCase(),
      body.isDefault === true,
      actor(request),
      body.changeNote ?? null,
    ]
  );

  const raw = rows.length > 0 ? rows[0].SAVE_ASSESSMENT_TEMPLATE : null;
  if (!raw) {
    return NextResponse.json({ error: "Save returned no result." }, { status: 502 });
  }
  const result = typeof raw === "string" ? JSON.parse(raw) : raw;

  // The procedure validates and reports failures as {error} rather than throwing.
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}

// ─── Runs ─────────────────────────────────────────────────────────────────────

async function handleRuns() {
  // History list: metadata plus a short excerpt, not the full markdown. Loading
  // every past assessment body to render a list would grow unboundedly.
  const rows = await querySnowflake(`
    SELECT ASSESSMENT_ID, CREATED_AT, CREATED_BY, TEMPLATE_NAME, TEMPLATE_VERSION,
           SCOPE, MODEL, ELAPSED_MS,
           LENGTH(OUTPUT_MARKDOWN) AS MD_CHARS,
           LEFT(REGEXP_REPLACE(OUTPUT_MARKDOWN, '^#+ .*$|[*#|\`]', '', 1, 0, 'm'), 220) AS EXCERPT
    FROM BABY_MART_DEMO.ANALYTICS.ASSESSMENT_RUN
    ORDER BY CREATED_AT DESC
    LIMIT 50
  `);

  return {
    runs: rows.map((r) => ({
      assessmentId: String(r.ASSESSMENT_ID),
      createdAt: toIsoDateTime(r.CREATED_AT),
      createdBy: str(r.CREATED_BY),
      templateName: str(r.TEMPLATE_NAME),
      templateVersion: num(r.TEMPLATE_VERSION),
      scope: String(r.SCOPE),
      model: str(r.MODEL),
      elapsedMs: num(r.ELAPSED_MS),
      mdChars: num(r.MD_CHARS),
      excerpt: (str(r.EXCERPT) ?? "").replace(/\s+/g, " ").trim(),
    })),
  };
}

async function handleRun(id: string) {
  const rows = await querySnowflakeWithBinds(
    `SELECT ASSESSMENT_ID, CREATED_AT, CREATED_BY, TEMPLATE_NAME, TEMPLATE_VERSION,
            SCOPE, SOP_SNAPSHOT, TEMPLATE_SNAPSHOT, OUTPUT_MARKDOWN,
            SOURCE_METRICS, MODEL, ELAPSED_MS
       FROM BABY_MART_DEMO.ANALYTICS.ASSESSMENT_RUN
      WHERE ASSESSMENT_ID = ?`,
    [id]
  );
  if (rows.length === 0) return { error: `Assessment "${id}" not found` };
  const r = rows[0];

  const metrics = r.SOURCE_METRICS;
  return {
    assessmentId: String(r.ASSESSMENT_ID),
    createdAt: toIsoDateTime(r.CREATED_AT),
    createdBy: str(r.CREATED_BY),
    templateName: str(r.TEMPLATE_NAME),
    templateVersion: num(r.TEMPLATE_VERSION),
    scope: String(r.SCOPE),
    // Snapshots of what actually ran, so a saved assessment stays explicable
    // even after the template has been edited since.
    sopSnapshot: str(r.SOP_SNAPSHOT),
    templateSnapshot: str(r.TEMPLATE_SNAPSHOT),
    markdown: str(r.OUTPUT_MARKDOWN) ?? "",
    metrics: typeof metrics === "string" ? JSON.parse(metrics) : metrics,
    model: str(r.MODEL),
    elapsedMs: num(r.ELAPSED_MS),
  };
}

// ─── Generate ─────────────────────────────────────────────────────────────────

async function handleGenerate(request: NextRequest) {
  const body = await request.json();
  const templateName = body.templateName ? String(body.templateName) : null;
  const scope = body.scope ? String(body.scope).toUpperCase() : null;
  const save = body.save !== false;

  if (scope && !["PLANNING", "COMMERCIAL", "BOTH"].includes(scope)) {
    return NextResponse.json(
      { error: `scope must be PLANNING, COMMERCIAL or BOTH, got "${scope}"` },
      { status: 400 }
    );
  }

  const rows = await querySnowflakeWithBinds(
    `CALL BABY_MART_DEMO.AI.GENERATE_AI_ASSESSMENT(?, ?, ?, ?)`,
    [templateName, scope, save, actor(request)]
  );

  const raw = rows.length > 0 ? rows[0].GENERATE_AI_ASSESSMENT : null;
  if (!raw) {
    return NextResponse.json({ error: "No assessment returned." }, { status: 502 });
  }
  const result = typeof raw === "string" ? JSON.parse(raw) : raw;

  // A missing template or bad scope comes back as {error}, not as an exception.
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  if (!result.markdown || !String(result.markdown).trim()) {
    return NextResponse.json(
      { error: "The model returned an empty assessment.", metrics: result.metrics ?? null },
      { status: 502 }
    );
  }

  // Map to the camelCase contract the page reads. The procedure returns
  // snake_case, and passing its object straight through left templateVersion and
  // elapsedMs undefined -- which the page rendered as a bare "v" badge and a
  // duration of "NaNs". handleRun does this mapping for saved runs; a freshly
  // generated one has to match it or the same assessment looks different
  // depending on whether you just ran it or reopened it from history.
  return NextResponse.json({
    assessmentId: result.assessment_id ?? null,
    templateName: result.template_name ?? null,
    templateVersion: result.template_version ?? null,
    scope: result.scope ?? null,
    model: result.model ?? null,
    elapsedMs: result.elapsed_ms ?? null,
    markdown: result.markdown ?? "",
    metrics: result.metrics ?? null,
  });
}
