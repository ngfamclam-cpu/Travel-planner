// Brief delivery: email via Resend's HTTP API, web push via VAPID (web-push).
import webpush from "web-push";
import type { PrismaClient } from "@rave-run/db";

export interface EmailConfig {
  apiKey?: string;
  to?: string;
  from?: string;
  fetchImpl?: typeof fetch;
}

export async function sendBriefEmail(cfg: EmailConfig, subject: string, html: string, text: string): Promise<{ ok: boolean; note?: string }> {
  if (!cfg.apiKey) return { ok: false, note: "RESEND_API_KEY not set" };
  if (!cfg.to) return { ok: false, note: "BRIEF_EMAIL_TO not set" };
  try {
    const res = await (cfg.fetchImpl ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
      // onboarding@resend.dev works without a domain, but only to your own Resend account address.
      body: JSON.stringify({ from: cfg.from || "Rave Run <onboarding@resend.dev>", to: [cfg.to], subject, html, text }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { ok: false, note: `Resend HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, note: `email failed: ${(e as Error).message}` };
  }
}

export interface PushConfig {
  publicKey?: string;
  privateKey?: string;
  subject?: string;
}

export async function sendBriefPush(prisma: PrismaClient, cfg: PushConfig, msg: { title: string; body: string; url: string }): Promise<{ ok: boolean; sent: number; note?: string }> {
  if (!cfg.publicKey || !cfg.privateKey) return { ok: false, sent: 0, note: "VAPID keys not set" };
  const subs = await prisma.pushSubscription.findMany();
  if (!subs.length) return { ok: false, sent: 0, note: "no device has turned on notifications (Settings → Daily brief)" };
  webpush.setVapidDetails(cfg.subject || "mailto:rave-run@example.com", cfg.publicKey, cfg.privateKey);
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys as { p256dh: string; auth: string } }, JSON.stringify(msg), { TTL: 6 * 3600 });
      await prisma.pushSubscription.update({ where: { id: s.id }, data: { lastOkAt: new Date() } });
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      // 404/410: the browser dropped this subscription; forget it.
      if (status === 404 || status === 410) await prisma.pushSubscription.delete({ where: { id: s.id } });
    }
  }
  return { ok: sent > 0, sent, note: sent ? undefined : "push failed for every device" };
}
