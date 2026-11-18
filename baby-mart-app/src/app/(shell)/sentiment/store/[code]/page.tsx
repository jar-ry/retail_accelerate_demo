"use client";

import { useParams } from "next/navigation";
import { StoreView } from "../../_components/StoreView";

export default function StorePage() {
  // Next 14 passes params as a plain object, which React 18 use() rejects.
  const code = String(useParams<{ code: string }>().code ?? "").toUpperCase();
  return <StoreView code={code} />;
}
