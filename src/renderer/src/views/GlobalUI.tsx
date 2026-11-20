import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';
import { useTRPC } from '../trpc';
import { Glyph, PAD_NAMES, useKeys, usePadKind } from '../lib/input';
import { useSpatialNav } from '../lib/spatial';
import { getSettings, setSettings, useSettings } from '../lib/settings';
import { sfx } from '../lib/sfx';
import { setMenuOpen, useConfirmReq } from '../lib/dialogs';

export function ConfirmHost() {
  const req = useConfirmReq();
  const root = useRef<HTMLDivElement>(null);
  useSpatialNav(root, { active: !!req, initial: '[data-main]', onKey: k => { if (k === 'Escape') { sfx.play('back'); req?.resolve(false); return true; } } });
  if (!req) return null;
  return (
    <div className="ov gl-ov">
      <div className="gl-box" ref={root}>
        <h3>{req.title}</h3>
        {req.text && <p>{req.text}</p>}
        <div className="gl-btns">
          <button className="btn" data-hf data-main onClick={() => { sfx.play('back'); req.resolve(false); }}>{req.cancel ?? 'Cancelar'}</button>
          <button className={`btn ${req.danger ? 'danger' : 'acc'}`} data-hf onClick={() => { sfx.play('ok'); req.resolve(true); }}>{req.ok ?? 'Confirmar'}</button>
        </div>
      </div>
    </div>
  );
}

interface Req { id: number; title: string; kind: 'dir' | 'exe'; start: string }

export function PickerHost() {
  const trpc = useTRPC();
  const [req, setReq] = useState<Req | null>(null);
  const [path, setPath] = useState('');
  const [sel, setSel] = useState(0);
  const answer = useMutation(trpc.fs.answer.mutationOptions());
  useSubscription(trpc.fs.onPick.subscriptionOptions(undefined, { onData: r => { setReq(r); setPath(r.start); setSel(0); } }));
  const q = useQuery(trpc.fs.list.queryOptions({ path, kind: req?.kind ?? 'dir' }, { enabled: !!req && !!path }));
  const listRef = useRef<HTMLDivElement>(null);
  const done = (p: string | null, native = false) => { if (!req) return; answer.mutate({ id: req.id, path: p, native }); setReq(null); };
  const entries = q.data?.entries ?? [];
  const places = q.data?.places ?? [];
  const rows: { k: string; label: string; act: () => void; kind: 'use' | 'up' | 'dir' | 'file' | 'place' | 'native' }[] = req ? [
    ...(req.kind === 'dir' ? [{ k: 'use', label: 'Usar esta pasta', act: () => { sfx.play('ok'); done(path); }, kind: 'use' as const }] : []),
    ...(q.data?.parent ? [{ k: 'up', label: '.. (voltar uma pasta)', act: () => { sfx.play('back'); setPath(q.data!.parent!); setSel(0); }, kind: 'up' as const }] : []),
    ...entries.map(e => ({ k: e.path, label: e.name, act: () => { sfx.play('ok'); if (e.dir) { setPath(e.path); setSel(0); } else done(e.path); }, kind: e.dir ? 'dir' as const : 'file' as const })),
  ] : [];
  const side = req ? [...places.map(p => ({ k: p.path, label: p.name, act: () => { sfx.play('move'); setPath(p.path); setSel(0); } })), { k: 'native', label: 'Janela do Windows…', act: () => { sfx.play('ok'); done(null, true); } }] : [];
  const [col, setCol] = useState<'list' | 'side'>('list');
  const [si, setSi] = useState(0);
  useEffect(() => { listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }, [sel, col, si]);
  useKeys(k => {
    if (!req) return;
    const n = col === 'list' ? rows.length : side.length, cur = col === 'list' ? sel : si, set = col === 'list' ? setSel : setSi;
    if (k === 'ArrowDown' && cur < n - 1) { sfx.play('move'); set(cur + 1); }
    else if (k === 'ArrowUp' && cur > 0) { sfx.play('move'); set(cur - 1); }
    else if (k === 'RT') { sfx.play('move'); set(Math.min(n - 1, cur + 8)); }
    else if (k === 'LT') { sfx.play('move'); set(Math.max(0, cur - 8)); }
    else if (k === 'ArrowLeft' && col === 'list') { sfx.play('move'); setCol('side'); }
    else if (k === 'ArrowRight' && col === 'side') { sfx.play('move'); setCol('list'); }
    else if (k === 'Enter') (col === 'list' ? rows[sel] : side[si])?.act();
    else if (k === 'Y' && req.kind === 'dir') { sfx.play('ok'); done(path); }
    else if (k === 'X' && q.data?.parent) { sfx.play('back'); setPath(q.data.parent); setSel(0); }
    else if (k === 'Escape') { sfx.play('back'); done(null); }
  }, !!req);
  if (!req) return null;
  return (
    <div className="ov gl-ov">
      <div className="gl-pick">
        <h3>{req.title}</h3>
        <div className="gl-path">{path}</div>
        <div className="gl-cols">
          <div className={`gl-side ${col === 'side' ? 'f' : ''}`}>{side.map((p, j) => (
            <button key={p.k} className={col === 'side' && j === si ? 'on' : ''} onClick={p.act}>{p.label}</button>
          ))}</div>
          <div className={`gl-list ${col === 'list' ? 'f' : ''}`} ref={listRef}>
            {q.isLoading ? <div className="gl-empty">Lendo…</div> : rows.map((r, j) => (
              <button key={r.k} className={`${r.kind} ${col === 'list' && j === sel ? 'on' : ''}`} onClick={r.act}>
                <span className="ic">{r.kind === 'use' ? '✔' : r.kind === 'up' ? '↰' : r.kind === 'dir' ? '▸' : '◆'}</span>{r.label}
              </button>
            ))}
            {!q.isLoading && !entries.length && <div className="gl-empty">{req.kind === 'exe' ? 'Nenhuma pasta ou programa aqui.' : 'Nenhuma pasta aqui.'}</div>}
          </div>
        </div>
        <div className="gl-h">
          <span><Glyph a="ok" />Abrir</span>
          {req.kind === 'dir' && <span><Glyph a="y" />Usar esta pasta</span>}
          <span><Glyph a="x" />Pasta acima</span><span><Glyph a="lr" />Locais</span><span><Glyph a="back" />Cancelar</span>
        </div>
      </div>
    </div>
  );
}

export function CartuchoMenu({ inside, onSettings, onRadar, onProfile, onPickConsoles, onLeave, onClose, onAll, onSupport }: {
  inside: string | null; onSettings: () => void; onRadar: () => void; onProfile: () => void; onPickConsoles: () => void; onLeave: () => void; onClose: () => void; onAll: () => void; onSupport: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const s = useSettings();
  const pad = usePadKind();
  useEffect(() => { setMenuOpen(true); return () => setMenuOpen(false); }, []);
  useSpatialNav(root, { active: true, initial: '[data-main]', onKey: k => { if (k === 'Escape' || k === 'Start') { sfx.play('back'); onClose(); return true; } } });
  const cyclePad = () => { const o = ['auto', 'kb', 'xbox', 'ps', 'nin'] as const; setSettings({ pad: o[(o.indexOf(getSettings().pad) + 1) % o.length]! }); };
  const go = (f: () => void) => () => { sfx.play('ok'); onClose(); f(); };
  return (
    <div className="ov gl-ov" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="gl-menu" ref={root}>
        <h3><i />CARTUCHO{inside ? <small>{inside}</small> : null}</h3>
        {inside && <button data-hf data-main onClick={go(onLeave)}>◀ Voltar ao palco</button>}
        <button data-hf data-main={inside ? undefined : true} onClick={go(onSettings)}>⚙ Configurações</button>
        {inside !== 'Todos os jogos' && <button data-hf onClick={go(onAll)}>▤ Todos os jogos</button>}
        <button data-hf onClick={go(onRadar)}>● Novidades do radar</button>
        <button data-hf onClick={go(onProfile)}>◉ Perfil e conta</button>
        <button data-hf onClick={go(onPickConsoles)}>▦ Consoles no palco</button>
        <button data-hf onClick={() => { sfx.play('move'); cyclePad(); }}>🎮 Botões: {s.pad === 'auto' ? `Auto (${PAD_NAMES[pad]})` : PAD_NAMES[s.pad]}</button>
        <button data-hf onClick={() => { setSettings({ snd: !s.snd }); sfx.play('move'); }}>♪ Sons: {s.snd ? 'ligados' : 'desligados'}</button>
        <button data-hf onClick={go(onSupport)}>♥ Apoiar o Cartucho</button>
        <div className="gl-h"><span><Glyph a="ok" />Escolher</span><span><Glyph a="back" />Fechar</span></div>
      </div>
    </div>
  );
}
