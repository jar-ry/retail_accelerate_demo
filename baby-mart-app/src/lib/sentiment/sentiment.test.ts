import { describe, it, expect } from "vitest";
import { nps, addWeeks } from "./handlers";

// The NPS arithmetic every sentiment page relies on.
describe("sentiment health arithmetic", () => {
  it("rebuilds NPS from counts, never from an average of NPS values", () => {
    expect(nps({ r: 200, p: 90, d: 50 })).toBe(20);
    expect(nps({ r: 3, p: 1, d: 2 })).toBe(-33.3);
    expect(nps({ r: 0, p: 0, d: 0 })).toBeNull();
    // Two stores: +60 on 10 surveys and -20 on 90 is -12 overall, not +20.
    const a = { r: 10, p: 7, d: 1 }, b = { r: 90, p: 27, d: 45 };
    expect(nps({ r: a.r + b.r, p: a.p + b.p, d: a.d + b.d })).toBe(-12);
  });

  it("steps weeks across month and year ends", () => {
    expect(addWeeks("2026-04-27", 1)).toBe("2026-05-04");
    expect(addWeeks("2026-01-05", -2)).toBe("2025-12-22");
    expect(addWeeks("2026-04-27", -3)).toBe("2026-04-06");
  });
});
