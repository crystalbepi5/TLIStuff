import { useState } from 'react';
import { Box } from 'lucide-react';
import { resolveIconUrl } from '../buildUtils';

interface ItemIconProps {
  icon: string | undefined;
  size?: number;
}

/** Real scraped gear art (GearBase.icon, only present for bases scraped via
 * gear-master -- legendaries have none) with a graceful fallback glyph,
 * same pattern as skills/SkillIcon.tsx. */
export function ItemIcon({ icon, size = 32 }: ItemIconProps) {
  const [failed, setFailed] = useState(false);
  const src = resolveIconUrl(icon);

  if (!src || failed) {
    return (
      <div className="pv-skill-icon pv-skill-icon-fallback" style={{ width: size, height: size }} aria-hidden="true">
        <Box size={size * 0.5} />
      </div>
    );
  }

  return (
    <img
      className="pv-skill-icon"
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
