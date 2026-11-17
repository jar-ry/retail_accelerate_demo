// ─── Head of Planning: who is making a change ─────────────────────────────────
//
// SPCS ingress puts the authenticated Snowflake user on every request, so
// attribution for the audit trail needs no text box and cannot be mistyped or
// left blank. An override records value + rationale + author + timestamp, and an
// author of "app" -- what the reference implementation recorded before it fixed
// this -- makes the other three worth less.
//
// Falls back to "local-dev" so a local run without ingress still writes, but is
// recognisable in the trail as not being a real user.

export function sessionUser(request: Request): string {
  const header =
    request.headers.get("Sf-Context-Current-User") ?? request.headers.get("sf-context-current-user");
  return header?.trim() || "local-dev";
}
