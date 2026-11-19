import { useState } from 'react';
import { hueOf, initials } from '../lib/format';

/** Capa do jogo: a arte do Recompendium quando existe; senão, uma capa gerada (cor e padrão estáveis pelo título). */
export function Cover({ title, url, className = '' }: { title: string; url?: string | null; className?: string }) {
  const [broken, setBroken] = useState(false);
  const img = url && !broken;
  const h = hueOf(title);
  return (
    <div className={`cv ${img ? 'has-img' : `gen p${h % 4}`} ${className}`}
      style={img ? undefined : { backgroundImage: `linear-gradient(160deg, hsl(${h} 70% 52%), hsl(${(h + 40) % 360} 65% 26%))` }}>
      {img && <img src={url!} alt="" loading="lazy" onError={() => setBroken(true)} />}
      <span className="ini">{initials(title)}</span>
      <span className="ct">{title}</span>
    </div>
  );
}
