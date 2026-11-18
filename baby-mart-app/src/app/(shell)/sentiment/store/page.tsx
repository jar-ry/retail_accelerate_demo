"use client";

import { StoreView } from "../_components/StoreView";

// Store 360 with no store named: opens the store whose NPS fell furthest over
// the four weeks to the focus week (chosen by the API).
export default function StoreDefaultPage() {
  return <StoreView code={null} />;
}
