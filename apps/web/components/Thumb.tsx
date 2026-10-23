/** Event/trip picture: the festival's own image when we have it, else a colour tile with initials. */
export function Thumb({ src, name, color = "#a855f7", size = 56, radius = 12 }: { src?: string | null; name: string; color?: string; size?: number; radius?: number }) {
  const initials = name
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^(the|of|and|nye|nyd)$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const style = { width: size, height: size, borderRadius: radius, flex: "none" as const };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" loading="lazy" className="thumb" style={{ ...style, objectFit: "cover" }} />;
  }
  return (
    <div className="thumb thumb-fallback" style={{ ...style, background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 35%, #0b0b12))`, fontSize: Math.round(size * 0.34) }} aria-hidden>
      {initials || "♪"}
    </div>
  );
}

export const KIND_ICON: Record<string, string> = { flight: "✈️", hotel: "🏨", ticket: "🎟️", ground: "🚕", food: "🍜", other: "📦" };

export const mediaUrl = (id: string | null | undefined, key: string) => (id ? `/media/${key}` : null);
