import { describe, expect, it } from "vitest";
import { screenDescription } from "@/lib/domain/hazmat";

describe("R-06 phrase screen", () => {
  const flagged: [string, string][] = [
    ["Portable power bank 20000mAh", "lithium battery"],
    ["Li-ion battery pack", "lithium battery"],
    ["Replacement lithium-ion cells", "lithium battery"],
    ["Lithium batteries AA", "lithium battery"],
    ["LiPo drone battery", "lithium battery"],
    ["Aerosol hair spray 250ml", "aerosol"],
    ["Spray paint, matt black", "aerosol"],
    ["Flammable solvent cleaner", "flammable liquid"],
    ["Acetone nail polish remover", "flammable liquid"],
    ["Lighter fluid refill", "flammable liquid"],
  ];
  for (const [text, cat] of flagged) {
    it(`flags "${text}"`, () => {
      expect(screenDescription(text).matches.map((m) => m.category)).toContain(cat);
    });
  }
  const clean = [
    "Battery-free kitchen timer",
    "Non-aerosol pump hand cream",
    "Non-flammable water-based paint",
    "Wooden toy, no batteries",
    "Ceramic coffee mug, 350 ml",
    "Cotton t-shirt",
  ];
  for (const text of clean) {
    it(`does not flag "${text}"`, () => {
      expect(screenDescription(text).matches).toEqual([]);
    });
  }
  it("ambiguous wording yields a clarification cue, not a match", () => {
    const s = screenDescription("AA batteries 4-pack");
    expect(s.matches).toEqual([]);
    expect(s.ambiguous).toContain("batteries");
  });
});
