/**
 * R-06 prohibited-goods screening: deterministic, case-insensitive phrase matching for the three
 * categories in the rulebook (lithium batteries, aerosols, flammable liquids).
 *
 * This is a high-recall screen for the hackathon rulebook, not a regulatory dangerous-goods
 * classifier. Ambiguous words produce an unscored clarification note instead of a Red finding.
 */

export type HazardCategory = "lithium battery" | "aerosol" | "flammable liquid";

export type HazardMatch = { category: HazardCategory; phrase: string };
export type HazardScreen = { matches: HazardMatch[]; ambiguous: string[] };

const PATTERNS: { category: HazardCategory; re: RegExp }[] = [
  { category: "lithium battery", re: /\blithium[\s-]*(?:ion|polymer|metal)?(?:[\s-]*(?:batter(?:y|ies)|cells?|packs?))?\b/ },
  { category: "lithium battery", re: /\bli[\s-]?(?:ion|po|poly)\b/ },
  { category: "lithium battery", re: /\blipo\b/ },
  { category: "lithium battery", re: /\bpower[\s-]?banks?\b/ },
  { category: "lithium battery", re: /\b(?:18650|21700|cr2032)\b/ },
  { category: "lithium battery", re: /\b(?:e-?cig(?:arette)?s?|vapes?|vape pens?)\b/ },
  { category: "aerosol", re: /\baerosols?\b/ },
  { category: "aerosol", re: /\bspray[\s-]?(?:paint|cans?)\b/ },
  { category: "aerosol", re: /\b(?:deodorant|hair|body|cooking)[\s-]?sprays?\b/ },
  { category: "aerosol", re: /\bcompressed (?:air|gas)\b/ },
  { category: "aerosol", re: /\bpressuri[sz]ed (?:can|canister|container)s?\b/ },
  { category: "flammable liquid", re: /\bflammable\b/ },
  { category: "flammable liquid", re: /\binflammable\b/ },
  { category: "flammable liquid", re: /\b(?:petrol|gasoline|kerosene|paraffin|white spirit|turpentine|acetone|methylated spirits?|lighter (?:fluid|gas)|butane|propane|ethanol|isopropyl alcohol|nail polish remover|paint thinners?|thinners)\b/ },
  { category: "flammable liquid", re: /\bsolvent[\s-]?based (?:paint|adhesive|glue|ink)s?\b/ },
];

/** Words that might indicate a prohibited item but need the seller to clarify. */
const AMBIGUOUS: RegExp[] = [/\bbatter(?:y|ies)\b/, /\bsprays?\b/, /\bsolvents?\b/, /\bperfumes?\b/, /\bfragrances?\b/, /\bfuel\b/, /\bgas\b/];

/** Negations that neutralise a match: "battery-free", "non-aerosol", "no batteries", "without lithium". */
const NEGATION_BEFORE = /\b(?:no|non|not|without|free of|excluding|excl\.?|zero)[\s-]+(?:\w+[\s-]+)?$/;
const NEGATION_AFTER = /^[\s-]*(?:free|less)\b/;

function isNegated(text: string, index: number, length: number): boolean {
  const before = text.slice(Math.max(0, index - 24), index);
  const after = text.slice(index + length, index + length + 8);
  return NEGATION_BEFORE.test(before) || NEGATION_AFTER.test(after);
}

export function screenDescription(raw: string | null | undefined): HazardScreen {
  const text = (raw ?? "").toLowerCase();
  const matches: HazardMatch[] = [];
  if (!text.trim()) return { matches, ambiguous: [] };
  const covered: [number, number][] = [];
  for (const { category, re } of PATTERNS) {
    const global = new RegExp(re.source, "g");
    for (const m of text.matchAll(global)) {
      const idx = m.index ?? 0;
      if (isNegated(text, idx, m[0].length)) continue;
      covered.push([idx, idx + m[0].length]);
      if (!matches.some((x) => x.category === category && x.phrase === m[0].trim())) {
        matches.push({ category, phrase: m[0].trim() });
      }
    }
  }
  const ambiguous: string[] = [];
  if (!matches.length) {
    for (const re of AMBIGUOUS) {
      const global = new RegExp(re.source, "g");
      for (const m of text.matchAll(global)) {
        const idx = m.index ?? 0;
        if (isNegated(text, idx, m[0].length)) continue;
        if (covered.some(([s, e]) => idx >= s && idx < e)) continue;
        if (!ambiguous.includes(m[0])) ambiguous.push(m[0]);
      }
    }
  }
  return { matches, ambiguous };
}
