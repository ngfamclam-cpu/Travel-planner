// Pull a site's preview image (og:image) and icon from its own page, the way a link preview does.
import type { HttpOpts } from "../tickets/types";

const UA = "Mozilla/5.0 (compatible; RaveRun/0.1; personal trip planner; link preview)";

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4] ?? null) : null;
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&quot;/g, '"');

function resolve(href: string | null, base: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(decode(href.trim()), base);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Best preview image and icon in a page's <head>. Pure, so it's tested with sample pages. */
export function extractPageImages(html: string, pageUrl: string): { hero: string | null; icon: string | null } {
  const head = html.slice(0, 200_000);
  const metas = head.match(/<meta\b[^>]*>/gi) ?? [];
  const links = head.match(/<link\b[^>]*>/gi) ?? [];
  const meta = (keys: string[]) => {
    for (const k of keys) {
      for (const t of metas) {
        const key = (attr(t, "property") ?? attr(t, "name") ?? "").toLowerCase();
        if (key === k) {
          const v = resolve(attr(t, "content"), pageUrl);
          if (v) return v;
        }
      }
    }
    return null;
  };
  const hero = meta(["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"]);
  // Icons: biggest apple-touch-icon / sized icon first, then any icon, then /favicon.ico.
  const icons = links
    .map((t) => ({ rel: (attr(t, "rel") ?? "").toLowerCase(), href: resolve(attr(t, "href"), pageUrl), size: Number((attr(t, "sizes") ?? "0").split("x")[0]) || 0, type: (attr(t, "type") ?? "").toLowerCase() }))
    .filter((i) => i.href && /(^|\s)(icon|apple-touch-icon|apple-touch-icon-precomposed)(\s|$)/.test(i.rel) && !i.type.includes("svg") && !/\.svg(\?|$)/i.test(i.href!));
  icons.sort((a, b) => Number(b.rel.includes("apple")) - Number(a.rel.includes("apple")) || b.size - a.size);
  const icon = icons[0]?.href ?? resolve("/favicon.ico", pageUrl);
  return { hero, icon };
}

export interface FetchedImage {
  url: string;
  contentType: string;
  data: Buffer;
}

const RASTER = /^image\/(png|jpe?g|gif|webp|avif|x-icon|vnd\.microsoft\.icon)$/i;

/** Check the bytes really are a raster image (never SVG/HTML, which could carry scripts). */
export function sniffImage(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.toString("ascii", 0, 4) === "GIF8") return "image/gif";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("ascii", 4, 12) === "ftypavif") return "image/avif";
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return "image/x-icon";
  return null;
}

export async function fetchImage(url: string, opts: HttpOpts & { maxBytes?: number } = {}): Promise<FetchedImage> {
  const max = opts.maxBytes ?? 3_000_000;
  const res = await (opts.fetchImpl ?? fetch)(url, { headers: { "user-agent": UA, accept: "image/avif,image/webp,image/png,image/jpeg,image/*" }, signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
  if (!res.ok) throw new Error(`image HTTP ${res.status}`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > max) throw new Error(`image too large (${len} bytes)`);
  const declared = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (declared && !RASTER.test(declared) && declared !== "application/octet-stream") throw new Error(`not a raster image (${declared})`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > max) throw new Error(`image too large (${data.length} bytes)`);
  const sniffed = sniffImage(data);
  if (!sniffed) throw new Error("file isn't a PNG/JPEG/GIF/WebP/AVIF/ICO image");
  return { url, contentType: sniffed, data };
}

/** Load a page and return its preview image and icon URLs (nothing downloaded yet). */
export async function pageImageUrls(pageUrl: string, opts: HttpOpts = {}): Promise<{ hero: string | null; icon: string | null }> {
  const res = await (opts.fetchImpl ?? fetch)(pageUrl, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
  if (!res.ok) throw new Error(`page HTTP ${res.status}`);
  return extractPageImages(await res.text(), res.url || pageUrl);
}
