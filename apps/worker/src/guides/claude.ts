// Claude picks food and things to do from the real places list and writes short notes around them.
import Anthropic from "@anthropic-ai/sdk";
import { verifyPicks, type ArrivalGuideContent, type GuideContext, type Place } from "@rave-run/core";

const SYSTEM = `You write a short arrival guide for one person going to an EDM festival.
You get the trip and a list of real places near the venue (each with an id). Pick only from that list, by id:
- 5 to 8 food picks: local specialties first, and at least one late-night option (lateNight: true) if any exist, for after the show.
- Up to 5 things to do on the days without sets (sights, parks, museums).
For each pick write one short, specific reason (under 20 words). Also suggest up to 3 neighborhoods near the venue or hotel area worth knowing, and up to 4 notes on getting to and from the venue.
Never mention prices, opening times or phone numbers, and never name a place that isn't in the list.`;

const PICK = {
  type: "object",
  properties: { placeId: { type: "string" }, why: { type: "string" } },
  required: ["placeId", "why"],
  additionalProperties: false,
};
const SCHEMA = {
  type: "object",
  properties: {
    neighborhoods: {
      type: "array",
      items: { type: "object", properties: { name: { type: "string" }, why: { type: "string" } }, required: ["name", "why"], additionalProperties: false },
    },
    food: { type: "array", items: PICK },
    todo: { type: "array", items: PICK },
    gettingThere: { type: "array", items: { type: "string" } },
  },
  required: ["neighborhoods", "food", "todo", "gettingThere"],
  additionalProperties: false,
};

interface Draft {
  neighborhoods: { name: string; why: string }[];
  food: { placeId: string; why: string }[];
  todo: { placeId: string; why: string }[];
  gettingThere: string[];
}

export type GuideWriter = (ctx: GuideContext, places: Place[]) => Promise<{ draft: Draft } | { error: string }>;

export function claudeGuideWriter(opts: { apiKey?: string; model?: string; client?: Anthropic }): GuideWriter | null {
  if (!opts.client && !opts.apiKey) return null;
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });
  return async (ctx, places) => {
    const list = places.slice(0, 120).map((p) => ({ id: p.id, name: p.name, kind: p.kind, cuisine: p.cuisine ?? undefined, rating: p.rating ?? undefined, lateNight: p.lateNight || undefined }));
    try {
      const response = await client.beta.messages.create({
        model: opts.model ?? "claude-opus-5-5",
        max_tokens: 4000,
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM,
        messages: [{ role: "user", content: JSON.stringify({ trip: ctx, places: list }) }],
      });
      if (response.stop_reason === "refusal") return { error: "model declined" };
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return { draft: JSON.parse(text) as Draft };
    } catch (e) {
      if (e instanceof Anthropic.APIError) return { error: `Anthropic API error ${e.status ?? ""}`.trim() };
      return { error: `guide writing failed: ${(e as Error).message}` };
    }
  };
}

/** Turn Claude's draft into guide content, keeping only real places and dropping anything with prices. */
export function finishDraft(draft: Draft, places: Place[]): Pick<ArrivalGuideContent, "neighborhoods" | "food" | "todo" | "gettingThere"> | null {
  const food = verifyPicks(draft.food, places.filter((p) => p.kind === "food" || p.kind === "drink")).slice(0, 8);
  if (food.length < 3) return null;
  const noPrices = (s: string) => !/\$|€|£|¥/.test(s);
  return {
    neighborhoods: draft.neighborhoods.filter((n) => n.name && noPrices(n.why)).slice(0, 3),
    food: food.filter((f) => noPrices(f.why)),
    todo: verifyPicks(draft.todo, places.filter((p) => p.kind === "sight" || p.kind === "park")).filter((t) => noPrices(t.why)).slice(0, 5),
    gettingThere: draft.gettingThere.filter(noPrices).slice(0, 4),
  };
}
