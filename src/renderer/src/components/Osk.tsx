import { createPortal } from 'react-dom';
import { useState } from 'react';
import { Glyph, useKeys } from '../lib/input';
import { sfx } from '../lib/sfx';

const ROWS = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKLÇ', 'ZXCVBNM-:\''];
const SPECIAL = [['space', 'ESPAÇO'], ['del', 'APAGAR'], ['clear', 'LIMPAR'], ['ok', 'OK']] as const;

export function Osk({ value, onChange, onDone, onCancel, label }: { value: string; onChange: (v: string) => void; onDone: () => void; onCancel: () => void; label: string }) {
  const [r, setR] = useState(1), [c, setC] = useState(0);
  const rows = ROWS.length + 1;
  const width = (ri: number) => (ri < ROWS.length ? ROWS[ri]!.length : SPECIAL.length);
  const press = (ri: number, ci: number) => {
    if (ri < ROWS.length) { sfx.play('move'); onChange(value + ROWS[ri]![ci]!.toLowerCase()); return; }
    const k = SPECIAL[ci]![0];
    if (k === 'space') onChange(value + ' ');
    else if (k === 'del') onChange(value.slice(0, -1));
    else if (k === 'clear') onChange('');
    else { sfx.play('ok'); onDone(); return; }
    sfx.play('move');
  };
  const mv = (dr: number, dc: number) => {
    sfx.play('move');
    let nr = (r + dr + rows) % rows;
    let nc = dr ? Math.round((c / Math.max(1, width(r) - 1)) * (width(nr) - 1)) : (c + dc + width(r)) % width(r);
    if (dr && nr === r) nr = r;
    nc = Math.max(0, Math.min(width(nr) - 1, nc));
    setR(nr); setC(nc);
  };
  useKeys(k => {
    if (k === 'ArrowUp') mv(-1, 0); else if (k === 'ArrowDown') mv(1, 0);
    else if (k === 'ArrowLeft') mv(0, -1); else if (k === 'ArrowRight') mv(0, 1);
    else if (k === 'Enter') press(r, c);
    else if (k === 'X') { sfx.play('move'); onChange(value.slice(0, -1)); }
    else if (k === 'Y') { sfx.play('move'); onChange(value + ' '); }
    else if (k === 'Start' || k === 'RT') { sfx.play('ok'); onDone(); }
    else if (k === 'Escape') { sfx.play('back'); onCancel(); }
  });
  return createPortal(
    <div className="osk-ov" onMouseDown={e => e.preventDefault()}>
      <div className="osk">
        <div className="osk-v"><small>{label}</small><b>{value}<i /></b></div>
        {ROWS.map((row, ri) => (
          <div key={ri} className="osk-r">{[...row].map((ch, ci) => (
            <button key={ch} className={ri === r && ci === c ? 'on' : ''} onClick={() => { setR(ri); setC(ci); press(ri, ci); }}>{ch}</button>
          ))}</div>
        ))}
        <div className="osk-r sp">{SPECIAL.map(([k, l], ci) => (
          <button key={k} className={`${k} ${r === ROWS.length && ci === c ? 'on' : ''}`} onClick={() => { setR(ROWS.length); setC(ci); press(ROWS.length, ci); }}>{l}</button>
        ))}</div>
        <div className="osk-h"><span><Glyph a="ok" />Tecla</span><span><Glyph a="x" />Apagar</span><span><Glyph a="y" />Espaço</span><span><Glyph a="menu" />Buscar</span><span><Glyph a="back" />Fechar</span></div>
      </div>
    </div>,
    document.getElementById('tv') ?? document.body,
  );
}
