// Save / remove this device's web-push subscription (the daily brief notification).
import { NextResponse } from "next/server";
import { prisma } from "@rave-run/db";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | null;
  if (!body?.endpoint?.startsWith("https://") || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json({ ok: false, error: "invalid subscription" }, { status: 400 });
  }
  const data = { keys: { p256dh: body.keys.p256dh, auth: body.keys.auth }, userAgent: req.headers.get("user-agent")?.slice(0, 200) ?? null };
  await prisma.pushSubscription.upsert({ where: { endpoint: body.endpoint }, create: { endpoint: body.endpoint, ...data }, update: data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => null)) as { endpoint?: string } | null;
  if (body?.endpoint) await prisma.pushSubscription.deleteMany({ where: { endpoint: body.endpoint } });
  return NextResponse.json({ ok: true });
}
