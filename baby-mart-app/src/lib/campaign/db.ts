// ─── Campaign & CRM: query helpers ───────────────────────────────────────────
//
// The same helpers as Head of Planning -- one statement, a parallel batch, or a
// transaction for a write and its audit row -- and the same error type, so the
// route maps a refusal to its status the same way.

export { q, batch, tx, str, NOW, HopError as CmpError, type Row, type Stmt, type Run } from "@/lib/hop/db";
