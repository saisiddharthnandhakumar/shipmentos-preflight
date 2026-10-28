/**
 * HS code sanity check. A small keyword → heading table covering the kinds of goods these sellers ship.
 * It is advisory only: it never changes a rule result, and anything it does not recognise is left to the
 * AI suggestion or to the seller. The seller (or their customs broker) always confirms the final code.
 */
export type HsEntry = { code: string; label: string; keywords: string[] };

export const HS_TABLE: HsEntry[] = [
  { code: "691200", label: "Ceramic tableware, kitchenware (mugs, plates, bowls)", keywords: ["mug", "cup", "plate", "bowl", "jug", "teapot", "ceramic", "stoneware", "porcelain", "crockery"] },
  { code: "691110", label: "Porcelain tableware and kitchenware", keywords: ["porcelain"] },
  { code: "701349", label: "Glassware for table or kitchen (drinking glasses, jugs)", keywords: ["drinking glass", "glassware", "wine glass", "tumbler", "carafe"] },
  { code: "732393", label: "Stainless steel table, kitchen or household articles", keywords: ["stainless", "bottle opener", "cutlery", "saucepan", "steel bottle"] },
  { code: "610910", label: "Cotton T-shirts, singlets and vests, knitted", keywords: ["t-shirt", "tshirt", "t shirt", "tee shirt", "tee"] },
  { code: "611020", label: "Cotton jerseys, pullovers, hoodies and sweatshirts, knitted", keywords: ["hoodie", "sweatshirt", "pullover", "jumper", "sweater", "jersey"] },
  { code: "611595", label: "Cotton socks and hosiery, knitted", keywords: ["sock", "socks", "hosiery", "tights"] },
  { code: "620342", label: "Men's cotton trousers and shorts, woven", keywords: ["trousers", "jeans", "chinos", "shorts"] },
  { code: "620462", label: "Women's cotton trousers and shorts, woven", keywords: ["women's trousers", "womens trousers"] },
  { code: "640399", label: "Footwear with leather uppers", keywords: ["shoe", "boot", "trainer", "sneaker", "footwear"] },
  { code: "630499", label: "Furnishing articles, not knitted (cushion covers, throws)", keywords: ["cushion", "throw", "pillow cover", "furnishing"] },
  { code: "630260", label: "Terry towelling and bath towels, cotton", keywords: ["towel"] },
  { code: "630231", label: "Cotton bed linen", keywords: ["bed linen", "duvet", "bedsheet", "sheet set", "pillowcase"] },
  { code: "940520", label: "Electric table, desk, bedside or floor lamps", keywords: ["lamp", "table lamp", "desk lamp", "floor lamp", "lampshade"] },
  { code: "940540", label: "Other electric lamps and lighting fittings", keywords: ["light fitting", "pendant", "chandelier", "led light", "string light", "fairy light"] },
  { code: "940360", label: "Wooden furniture", keywords: ["wooden chair", "wooden table", "bookcase", "shelf", "shelving", "wooden furniture", "cabinet"] },
  { code: "940171", label: "Upholstered seats with metal frames", keywords: ["office chair", "chair", "stool", "armchair"] },
  { code: "482010", label: "Notebooks, diaries, exercise books and memo pads", keywords: ["notebook", "diary", "journal", "notepad", "exercise book"] },
  { code: "960810", label: "Ball-point pens", keywords: ["pen set", "ballpoint", "ball-point", "pen"] },
  { code: "490199", label: "Printed books", keywords: ["book", "paperback", "hardback"] },
  { code: "850760", label: "Lithium-ion batteries and accumulators", keywords: ["power bank", "lithium", "battery", "li-ion"] },
  { code: "851713", label: "Smartphones", keywords: ["smartphone", "mobile phone", "iphone"] },
  { code: "851830", label: "Headphones and earphones", keywords: ["headphone", "earphone", "earbud", "headset"] },
  { code: "847130", label: "Laptops and portable computers", keywords: ["laptop", "notebook computer", "tablet pc"] },
  { code: "392690", label: "Other articles of plastics", keywords: ["plastic", "storage box", "container", "organiser", "organizer"] },
  { code: "420221", label: "Handbags with leather outer surface", keywords: ["handbag", "leather bag", "purse"] },
  { code: "420292", label: "Bags with textile outer surface (backpacks, tote bags)", keywords: ["backpack", "rucksack", "tote", "canvas bag", "holdall"] },
  { code: "330499", label: "Beauty, skincare and make-up preparations", keywords: ["moisturiser", "moisturizer", "face cream", "lotion", "skincare", "serum", "makeup", "make-up"] },
  { code: "330300", label: "Perfumes and toilet waters", keywords: ["perfume", "fragrance", "eau de"] },
  { code: "340600", label: "Candles and similar articles", keywords: ["candle"] },
  { code: "950300", label: "Toys (tricycles, dolls, puzzles, models)", keywords: ["toy", "doll", "puzzle", "lego", "plush", "teddy"] },
  { code: "950662", label: "Inflatable balls", keywords: ["football", "basketball", "volleyball"] },
  { code: "420500", label: "Other articles of leather", keywords: ["leather belt", "leather wallet", "wallet"] },
  { code: "711790", label: "Imitation jewellery", keywords: ["jewellery", "jewelry", "necklace", "bracelet", "earring"] },
  { code: "090121", label: "Roasted coffee, not decaffeinated", keywords: ["coffee beans", "ground coffee", "roasted coffee"] },
  { code: "090240", label: "Black tea, in bulk", keywords: ["black tea", "tea bags", "loose tea"] },
  { code: "180632", label: "Chocolate and cocoa preparations", keywords: ["chocolate", "cocoa"] },
  { code: "392410", label: "Plastic tableware and kitchenware", keywords: ["plastic cup", "plastic plate", "tupperware", "lunch box"] },
  { code: "761510", label: "Aluminium table, kitchen or household articles", keywords: ["aluminium", "aluminum"] },
  { code: "821599", label: "Spoons, forks, ladles (non-precious metal)", keywords: ["spoon", "fork", "ladle"] },
  { code: "560721", label: "Binder or baler twine, rope and cordage", keywords: ["rope", "twine", "cordage"] },
  { code: "870899", label: "Motor vehicle parts and accessories", keywords: ["car part", "brake pad", "car accessory", "wiper"] },
];

const normCode = (raw: string) => raw.replace(/[\s.]/g, "");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9' -]+/g, " ").replace(/\s+/g, " ").trim();

export type HsSuggestion = { code: string; label: string };

/** Matches ordered best-first: more specific (longer) keyword hits win, then table order. */
export function suggestHs(description: string | null | undefined, limit = 3): HsSuggestion[] {
  const text = ` ${norm(description ?? "")} `;
  if (text.trim() === "") return [];
  const hits: { e: HsEntry; score: number }[] = [];
  for (const e of HS_TABLE) {
    let best = 0;
    for (const k of e.keywords) {
      const re = new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?(?=[^a-z0-9]|$)`);
      if (re.test(text)) best = Math.max(best, k.length);
    }
    if (best) hits.push({ e, score: best });
  }
  const seen = new Set<string>();
  return hits
    .sort((a, b) => b.score - a.score)
    .filter((h) => (seen.has(h.e.code) ? false : (seen.add(h.e.code), true)))
    .slice(0, limit)
    .map((h) => ({ code: h.e.code, label: h.e.label }));
}

export type HsVerdict =
  | { kind: "ok" } // the code agrees with the description
  | { kind: "mismatch"; suggestions: HsSuggestion[]; message: string }
  | { kind: "unknown" }; // not enough to judge (no description, no code, or a product we don't recognise)

/** Compare a typed HS code with the product description. Only the 4-digit heading is compared. */
export function checkHs(description: string | null | undefined, hsCode: string | null | undefined): HsVerdict {
  const code = normCode(hsCode ?? "");
  if (!code || !/^\d{4,}/.test(code)) return { kind: "unknown" };
  const suggestions = suggestHs(description, 3);
  if (!suggestions.length) return { kind: "unknown" };
  const heading = code.slice(0, 4);
  if (suggestions.some((s) => s.code.startsWith(heading))) return { kind: "ok" };
  // Same 2-digit chapter as a suggestion: close, but still worth a look.
  const chapter = code.slice(0, 2);
  const close = suggestions.find((s) => s.code.startsWith(chapter));
  const top = suggestions[0];
  return {
    kind: "mismatch",
    suggestions,
    message: close
      ? `${code} is in the right chapter but heading ${heading} doesn't usually cover this. ${top.code} (${top.label}) is more typical.`
      : `${code} doesn't look like a code for this product. ${top.code} (${top.label}) is more typical.`,
  };
}
