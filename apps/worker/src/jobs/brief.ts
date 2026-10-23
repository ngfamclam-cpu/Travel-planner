// Step 8: the daily brief, built once a day at the time set in Settings (America/New_York).
import { mergeSettings, pushText, renderBriefHtml, renderBriefText, todayIn, type BriefPayload } from "@rave-run/core";
import type { Prisma, PrismaClient } from "@rave-run/db";
import { buildBriefPayload } from "../brief/payload";
import { writeSummary, type SummaryResult } from "../brief/summary";
import { sendBriefEmail, sendBriefPush, type EmailConfig, type PushConfig } from "../brief/deliver";

export interface BriefDeps {
  summarize?: (p: BriefPayload) => Promise<SummaryResult>;
  email?: EmailConfig;
  push?: PushConfig;
  /** Public address of the app, for links in the email and push (e.g. https://raverun.example.com). */
  baseUrl?: string;
}

/** HH:MM in New York right now. */
function nowHHMM(now: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
}

/** Build today's brief if it's past the brief time and there isn't one yet (also catches up after downtime). */
export async function briefIfDue(prisma: PrismaClient, deps: BriefDeps, now = new Date()) {
  const settings = mergeSettings(await prisma.setting.findMany());
  if (nowHHMM(now) < settings.briefTime) return null;
  return runBrief(prisma, deps, { now });
}

export async function runBrief(prisma: PrismaClient, deps: BriefDeps, opts: { now?: Date; force?: boolean; log?: (m: string) => void } = {}) {
  const now = opts.now ?? new Date();
  const log = opts.log ?? console.log;
  const settings = mergeSettings(await prisma.setting.findMany());
  const date = new Date(`${todayIn("America/New_York", now)}T00:00:00Z`);
  if (!opts.force && (await prisma.brief.findUnique({ where: { date } }))) return null;
  const payload = await buildBriefPayload(prisma, now);

  const summary = await (deps.summarize ?? ((p) => writeSummary(p, {})))(payload);
  if (summary.source === "template" && summary.note) payload.problems.push({ source: "Brief prose (Claude)", note: summary.note });
  const base = (deps.baseUrl ?? "").replace(/\/$/, "");
  const html = renderBriefHtml(payload, summary.text, base);
  const text = renderBriefText(payload, summary.text, base);
  const data = { html, text, payload: payload as unknown as Prisma.InputJsonValue, summary: summary.text, summarySource: summary.source };
  const brief = await prisma.brief.upsert({ where: { date }, create: { date, ...data }, update: data });

  let sentEmail = false;
  let sentPush = false;
  if (settings.briefChannels.email) {
    const r = await sendBriefEmail(deps.email ?? {}, `Rave Run · ${payload.dateLabel}${payload.counts.actions ? ` · ${payload.counts.actions} to act on` : ""}`, html, text);
    sentEmail = r.ok;
    if (!r.ok) log(`Brief email not sent: ${r.note}`);
  }
  if (settings.briefChannels.push) {
    const r = await sendBriefPush(prisma, deps.push ?? {}, { ...pushText(payload), url: `${base}/brief` });
    sentPush = r.ok;
    if (!r.ok) log(`Brief push not sent: ${r.note}`);
  }
  await prisma.brief.update({ where: { id: brief.id }, data: { sentEmail, sentPush } });
  log(`Brief ${payload.date}: ${payload.counts.actions} actions, summary by ${summary.source}, email ${sentEmail ? "sent" : "no"}, push ${sentPush ? "sent" : "no"}`);
  return { payload, summary, sentEmail, sentPush };
}
