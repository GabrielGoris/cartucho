import { useState } from 'react';
import { hueOf, initials } from '../lib/format';
import { tt } from '@shared/i18n';

export function Cover({ title, url, className = '', done = false }: { title: string; url?: string | null; className?: string; done?: boolean }) {
  const [broken, setBroken] = useState(false);
  const img = url && !broken;
  const h = hueOf(title);
  return (
    <div className={`cv ${img ? 'has-img' : `gen p${h % 4}`} ${className}`}
      style={img ? undefined : { backgroundImage: `linear-gradient(160deg, hsl(${h} 70% 52%), hsl(${(h + 40) % 360} 65% 26%))` }}>
      {img && <img src={url!} alt="" loading="lazy" onError={() => setBroken(true)} />}
      <span className="ini">{initials(title)}</span>
      <span className="ct">{title}</span>
      {done && <span className="cv-done" title={tt('100% das conquistas')}>100%</span>}
    </div>
  );
}
