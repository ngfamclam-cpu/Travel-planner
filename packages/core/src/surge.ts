// Surge = event-window price ÷ normal-week price (spec §3).

export interface Surge {
  ratio: number;
  label: string;
  level: "normal" | "elevated" | "surge";
}

export function computeSurge(eventPrice: number | null | undefined, baselinePrice: number | null | undefined): Surge | null {
  if (!eventPrice || !baselinePrice || baselinePrice <= 0) return null;
  const ratio = Math.round((eventPrice / baselinePrice) * 10) / 10;
  const level = ratio >= 1.5 ? "surge" : ratio >= 1.15 ? "elevated" : "normal";
  return { ratio, level, label: `${ratio.toFixed(1)}× normal` };
}

export function surgeSentence(kind: string, s: Surge): string {
  const noun = kind === "hotel" ? "Hotels are" : kind === "flight" ? "Flights are" : `${kind} is`;
  return `${noun} ${s.ratio.toFixed(1)}× normal for these dates`;
}
