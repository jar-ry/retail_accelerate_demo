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
    expect(stepForPath(cat, "/category/nappies-wipes")).toBe(1);
    expect(stepForPath(cat, "/brand/Huggies")).toBe(2);
    expect(stepForPath(cat, "/brand/Huggies/")).toBe(2);
    expect(stepForPath(cat, "/meeting/Huggies")).toBe(5);
    expect(stepForPath(cat, "/vendor/scorecard")).toBe(-1);
    // /agent appears twice (decline, then spike): the current step wins when it matches.
    expect(stepForPath(cat, "/agent")).toBe(3);
    expect(stepForPath(cat, "/agent", 4)).toBe(4);
    // The brand page's Investigate links: the question picks the step, whatever is stored.
    const spike = `?mode=investigate&q=${encodeURIComponent("What drove the Huggies Crawler Nappies spike?")}&persona=category`;
    const decline = `?mode=investigate&q=${encodeURIComponent("Why is Huggies down on last year?")}`;
    expect(stepForPath(cat, "/agent", 3, spike)).toBe(4);
    expect(stepForPath(cat, "/agent", -1, spike)).toBe(4);
    expect(stepForPath(cat, "/agent", 4, decline)).toBe(3);
    // A question no step asks falls back to the stored step on that page.
    expect(stepForPath(cat, "/agent", 4, "?q=Why%20is%20Bugaboo%20down%3F")).toBe(4);
    expect(stepForPath(trackById("campaign")!, "/campaigns/performance/camp-001")).toBe(1);
  });

  it("tags shared pages with the persona so the sidebar survives the reload", () => {
    const cat = trackById("category")!;
    expect(stepHref(cat, { title: "", route: "/agent", show: "", say: "" })).toBe("/agent?persona=category");
    for (const i of [3, 4]) expect(stepHref(cat, cat.steps[i])).toMatch(/^\/agent\?mode=investigate&q=.+&persona=category$/);
    expect(stepHref(cat, cat.steps[0])).toBe("/dashboard");
  });

  it("asks the same questions as the brand page's buttons", () => {
    const cat = trackById("category")!;
    const q = (i: number) => new URLSearchParams(cat.steps[i].route.split("?")[1]).get("q");
    expect(q(3)).toBe("Why is Huggies down on last year?");
    expect(q(4)).toBe("What drove the Huggies Crawler Nappies spike?");
  });
});
