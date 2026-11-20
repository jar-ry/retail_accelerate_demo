import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "fs";
import path from "path";
import { DEMO_TRACKS, stepForPath, stepHref, stepPath, trackById } from "./tracks";

const SHELL = path.resolve(__dirname, "../../app/(shell)");

/** Whether a URL path resolves to a page under app/(shell), matching a
 *  dynamic segment ([id], [name]) the way Next does. */
function hasPage(urlPath: string): boolean {
  const parts = urlPath.split("/").filter(Boolean);
  const walk = (dir: string, i: number): boolean => {
    if (i === parts.length) return existsSync(path.join(dir, "page.tsx"));
    if (existsSync(path.join(dir, parts[i]))) return walk(path.join(dir, parts[i]), i + 1);
    const dyn = readdirSync(dir).find((d) => /^\[[^.\]]+\]$/.test(d));
    return dyn ? walk(path.join(dir, dyn), i + 1) : false;
  };
  return walk(SHELL, 0);
}

describe("demo talk tracks", () => {
  it("has one track per persona, each opening with the wake-up line", () => {
    expect(DEMO_TRACKS.map((t) => t.id).sort()).toEqual(["campaign", "category", "hop", "nps", "planning", "supply"]);
    for (const t of DEMO_TRACKS) {
      expect(t.hook.startsWith("Imagine you wake up tomorrow and")).toBe(true);
      expect(t.steps.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("points every step at a page that exists", () => {
    for (const t of DEMO_TRACKS)
      for (const s of t.steps) expect(hasPage(stepPath(s.route)), `${t.id}: ${s.route}`).toBe(true);
  });

  it("finds the step for the page being shown", () => {
    const cat = trackById("category")!;
    expect(stepForPath(cat, "/brand/Huggies")).toBe(1);
    expect(stepForPath(cat, "/brand/Huggies/")).toBe(1);
    expect(stepForPath(cat, "/vendor/scorecard")).toBe(-1);
    // /agent appears twice: the current step wins when it matches.
    expect(stepForPath(cat, "/agent")).toBe(2);
    expect(stepForPath(cat, "/agent", 3)).toBe(3);
    expect(stepForPath(trackById("campaign")!, "/campaigns/performance/camp-001")).toBe(1);
  });

  it("tags shared pages with the persona so the sidebar survives the reload", () => {
    const cat = trackById("category")!;
    expect(stepHref(cat, cat.steps[3])).toBe("/agent?persona=category");
    expect(stepHref(cat, cat.steps[2])).toMatch(/^\/agent\?mode=investigate&q=.+&persona=category$/);
    expect(stepHref(cat, cat.steps[0])).toBe("/dashboard");
  });
});
