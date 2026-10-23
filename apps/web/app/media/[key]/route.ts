// Serves images saved by the worker (festival and ticket-site images). Raster only; locked down.
import { prisma } from "@rave-run/db";

export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!/^[a-z0-9-]{3,120}$/i.test(key)) return new Response("not found", { status: 404 });
  const m = await prisma.media.findUnique({ where: { key } });
  if (!m) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(m.data), {
    headers: {
      "content-type": m.contentType,
      "cache-control": "private, max-age=604800",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
