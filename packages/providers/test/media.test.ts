import { describe, expect, it, vi } from "vitest";
import { extractPageImages, fetchImage, sniffImage } from "../src";

const PNG = Buffer.concat([Buffer.from([0x89]), Buffer.from("PNG\r\n\x1a\n"), Buffer.alloc(20)]);

describe("page images", () => {
  it("finds og:image and the best icon, resolving relative URLs", () => {
    const html = `<html><head>
      <meta property="og:image" content="/img/hero-2027.jpg?x=1&amp;y=2">
      <link rel="icon" href="/fav-32.png" sizes="32x32">
      <link rel="apple-touch-icon" href="https://cdn.ultra.com/apple-180.png" sizes="180x180">
      <link rel="icon" type="image/svg+xml" href="/logo.svg">
    </head></html>`;
    expect(extractPageImages(html, "https://ultramusicfestival.com/miami/")).toEqual({
      hero: "https://ultramusicfestival.com/img/hero-2027.jpg?x=1&y=2",
      icon: "https://cdn.ultra.com/apple-180.png",
    });
  });
  it("falls back to twitter:image and /favicon.ico", () => {
    expect(extractPageImages(`<meta name="twitter:image" content='https://x.com/t.png'>`, "https://movement.us/")).toEqual({ hero: "https://x.com/t.png", icon: "https://movement.us/favicon.ico" });
    expect(extractPageImages(`<meta property="og:image" content="javascript:alert(1)">`, "https://a.com").hero).toBeNull();
  });
  it("accepts only real raster images", async () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>"))).toBeNull();
    const ok = vi.fn(async () => new Response(PNG, { headers: { "content-type": "image/png" } }));
    expect(await fetchImage("https://a.com/i.png", { fetchImpl: ok as unknown as typeof fetch })).toMatchObject({ contentType: "image/png" });
    const svg = vi.fn(async () => new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }));
    await expect(fetchImage("https://a.com/i.svg", { fetchImpl: svg as unknown as typeof fetch })).rejects.toThrow("not a raster image");
    const lying = vi.fn(async () => new Response("<html>hi</html>", { headers: { "content-type": "image/png" } }));
    await expect(fetchImage("https://a.com/x.png", { fetchImpl: lying as unknown as typeof fetch })).rejects.toThrow("isn't a PNG");
    const big = vi.fn(async () => new Response(PNG, { headers: { "content-type": "image/png", "content-length": "9999999" } }));
    await expect(fetchImage("https://a.com/b.png", { fetchImpl: big as unknown as typeof fetch })).rejects.toThrow("too large");
  });
});
