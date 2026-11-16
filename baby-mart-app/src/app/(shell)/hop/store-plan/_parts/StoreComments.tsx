"use client";

import { useState } from "react";
import type { Row } from "../../_components/useHop";
import { isoDate } from "@/lib/hop/format";

/** A store's comments beside its rows: the latest one, how many there are, and a
 *  box to add one. The full thread is in the store's drawer. */
export function CommentCell({
  comments, onPost, onOpen,
}: {
  comments: Row[]; onPost: (text: string) => Promise<string | null>; onOpen: () => void;
}) {
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = comments[0];
  const post = async () => {
    if (!text.trim()) return;
    setBusy(true); setErr(null);
    const e = await onPost(text.trim());
    setBusy(false);
    if (e) setErr(e); else setText("");
  };
  return (
    <div className="w-48 space-y-1 text-[10px]">
      {latest ? (
        <button onClick={onOpen} className="block w-full text-left" title="Open the store's comments and history">
          <span className="line-clamp-3 text-slate-700">{String(latest.COMMENT_TEXT)}</span>
          <span className="text-slate-400">{String(latest.CREATED_BY)} · {isoDate(latest.CREATED_AT)}{comments.length > 1 ? ` · ${comments.length - 1} more` : ""}</span>
        </button>
      ) : null}
      <div className="flex gap-1">
        <input className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] focus:border-teal-400 focus:outline-none"
          placeholder="Comment" value={text} maxLength={2000} disabled={busy}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && post()} />
        <button onClick={post} disabled={!text.trim() || busy} className="rounded border border-slate-200 px-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40">Add</button>
      </div>
      {err && <div className="text-red-600">{err}</div>}
    </div>
  );
}
