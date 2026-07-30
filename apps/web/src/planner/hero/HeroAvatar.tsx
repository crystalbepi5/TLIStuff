/** Heroes have no art asset anywhere in the scraped dataset (see
 * buildUtils.ts's ICON_HOST comment) -- this generates a deterministic
 * monogram + hue instead of inventing artwork. Same id always produces the
 * same color, so it reads as a stable identity rather than random noise. */
function hueFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

function monogramFor(name: string): string {
  const parts = name.split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

interface HeroAvatarProps {
  id: string;
  name: string;
  size?: number;
}

export function HeroAvatar({ id, name, size = 56 }: HeroAvatarProps) {
  const hue = hueFor(id);
  return (
    <div
      className="pv-hero-avatar"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(160deg, hsl(${hue} 55% 28%), hsl(${(hue + 40) % 360} 45% 16%))`
      }}
    >
      {monogramFor(name)}
    </div>
  );
}
