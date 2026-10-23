// Claude writes a few sentences around the facts. Numbers are checked against the payload before use.
import Anthropic from "@anthropic-ai/sdk";
import { inventedNumbers, templateSummary, type BriefPayload } from "@rave-run/core";

const SYSTEM = `You write the opening paragraph of a personal morning briefing for someone planning EDM festival trips from Boston.
You get today's facts as JSON. Write 3 to 5 plain sentences: lead with what to do today (action items, anything marked BUY_NOW), then how planned trip totals moved, then anything new or anything that couldn't be checked.
Use only facts from the JSON. Every number you write (prices, changes, dates, counts, days) must appear in the JSON exactly as given: do not add, subtract, round, convert or estimate. If a price is missing or was not checked, say so instead of guessing.
No greeting, no headings, no lists, no markdown. Write like a friend who tracks prices for them: direct and brief.`;

export interface SummaryResult {
  text: string;
  source: "claude" | "template";
  note?: string;
}

export async function writeSummary(payload: BriefPayload, opts: { apiKey?: string; model?: string; client?: Anthropic } = {}): Promise<SummaryResult> {
  const fallback = (note: string): SummaryResult => ({ text: templateSummary(payload), source: "template", note });
  if (!opts.client && !opts.apiKey) return fallback("ANTHROPIC_API_KEY not set");
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });
  try {
    const response = await client.beta.messages.create({
      model: opts.model ?? "claude-opus-5-5",
      max_tokens: 2000,
      // A short summary needs little reasoning; low effort keeps it fast and cheap.
      output_config: { effort: "low" },
      // If the model declines, the API retries on a fallback model in the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    });
    if (response.stop_reason === "refusal") return fallback("model declined");
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) return fallback("empty response");
    const bad = inventedNumbers(text, payload);
    if (bad.length) return fallback(`summary used numbers not in the data (${bad.slice(0, 5).join(", ")})`);
    return { text, source: "claude" };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return fallback("Anthropic API key rejected");
    if (e instanceof Anthropic.RateLimitError) return fallback("Anthropic rate limit");
    if (e instanceof Anthropic.APIError) return fallback(`Anthropic API error ${e.status ?? ""}`.trim());
    return fallback(`Anthropic request failed: ${(e as Error).message}`);
  }
}
