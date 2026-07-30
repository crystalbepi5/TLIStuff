import { useState } from 'react';
import { Wand2 } from 'lucide-react';
import { skillIconUrl } from '../buildUtils';

interface SkillIconProps {
  icon: string | undefined;
  name: string;
  size?: number;
}

/** Real scraped art (see buildUtils.skillIconUrl) with a graceful fallback
 * to a generic glyph if a specific icon 404s or the host is unreachable --
 * never blocks or errors the surrounding UI on a broken image. */
export function SkillIcon({ icon, name, size = 32 }: SkillIconProps) {
  const [failed, setFailed] = useState(false);
  const src = skillIconUrl(icon);

  if (!src || failed) {
    return (
      <div className="pv-skill-icon pv-skill-icon-fallback" style={{ width: size, height: size }} aria-hidden="true">
        <Wand2 size={size * 0.5} />
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
