import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConsoleId, InstalledGame } from '@shared/types';
import { useTRPC } from '../trpc';
import { Hints, useKeys, usePadKind, PAD_NAMES } from '../lib/input';
import { useSpatialNav } from '../lib/spatial';
import { setSettings, useSettings } from '../lib/settings';
import { clockStr, fmtPlay, plural } from '../lib/format';
import { initAudio, sfx } from '../lib/sfx';
import { MAKERS, MAKER_LABEL, otherConsoles, type StageConsole } from '../stage/consoles';
import { Home, setCaption } from './Home';
import { MeOverlay, RadarOverlay } from './Overlays';

export type Page = 'act' | 'stage';
interface Props {
  active: boolean;
  list: StageConsole[];   // consoles à mostra no palco
  page: Page; setPage: (p: Page) => void;
  sel: number; setSel: (i: number | ((prev: number) => number)) => void;
  onEnterConsole: (id: ConsoleId, opts?: { game?: string; tab?: 'lib' | 'cat' }) => void;
  onSettings: () => void;
}

function Clock() {
  const [t, setT] = useState(clockStr());
  useEffect(() => { const i = setInterval(() => setT(clockStr()), 15_000); return () => clearInterval(i); }, []);
  return <span className="clock">{t}</span>;
}

/** Fora dos consoles: topo, Início e o palco. */
export function Select({ active, list, page, setPage, sel, setSel, onEnterConsole, onSettings }: Props) {
  const trpc = useTRPC(), qc = useQueryClient();
  const summary = useQuery(trpc.library.summary.queryOptions());
  const games = useQuery(trpc.games.list.queryOptions());
  const add = useMutation(trpc.games.addFromDialog.mutationOptions({
    onSuccess: g => { void qc.invalidateQueries(); if (g) onEnterConsole(g.console, { game: g.id }); },
  }));
  const play = useMutation(trpc.play.start.mutationOptions({ onSuccess: () => void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }) }));
  const [ov, setOv] = useState<null | 'radar' | 'me'>(null);
  const root = useRef<HTMLElement>(null);
  const pad = usePadKind();
  const s = useSettings();

  const go = (p: Page) => { sfx.play('ok'); setPage(p); };
  const move = (d: number) => { initAudio(); sfx.play('move'); setSel(prev => prev + d); };
  const openGame = (g: InstalledGame) => onEnterConsole(g.console, { game: g.id });

  // palco: setas trocam de console, Enter liga
  useKeys(k => {
    if (k === 'ArrowLeft' || k === 'LB') move(-1);
    else if (k === 'ArrowRight' || k === 'RB') move(1);
    else if (k === 'Enter') { initAudio(); onEnterConsole(list[sel]!.id); }
    else if (k === 'Escape' || k === 'Tab') go('act');
  }, active && page === 'stage' && !ov);

  // Início: navegação espacial entre topo e conteúdo
  useSpatialNav(root, {
    active: active && page === 'act' && !ov, initial: '[data-main]',
    onFocus: setCaption,
    onKey: k => { if (k === 'Tab' || k === 'LB' || k === 'RB') { go('stage'); return true; } if (k === 'Escape') return true; },
  });

  // Outros soma os consoles escondidos
  const c = list[sel]!, group = c.id === 'other' ? otherConsoles(s.hidden) : [c.id];
  const pc = group.reduce((t, id) => { const x = summary.data?.perConsole[id]; return x ? { recomps: t.recomps + x.recomps, installed: t.installed + x.installed, fresh: t.fresh + x.fresh, platforms: t.platforms + x.platforms } : t; },
    { recomps: 0, installed: 0, fresh: 0, platforms: 0 });
  const unseen = summary.data?.radar.unseen ?? 0;

  return (
    <section className="view select" ref={root} aria-label="Cartucho">
      <header className="topbar">
        <div className="logo glow"><i />CARTUCHO</div>
        <div className="seg" role="tablist">
          <button role="tab" className={page === 'act' ? 'on' : ''} aria-selected={page === 'act'} onClick={() => go('act')}>INÍCIO</button>
          <button role="tab" className={page === 'stage' ? 'on' : ''} aria-selected={page === 'stage'} onClick={() => go('stage')}>CONSOLES</button>
        </div>
        <div className="top-right">
          <button className={`hm-pill ${unseen ? 'has' : ''}`} data-hf data-cap="Radar" onClick={() => { sfx.play('ok'); setOv('radar'); }}><i />{unseen ? plural(unseen, 'novidade', 'novidades') : 'radar'}</button>
          <button className="hm-set" data-hf aria-label="Configurações" title="Configurações (S)" onClick={onSettings}>⚙</button>
          <button className="hm-me" data-hf aria-label="Perfil" onClick={() => { sfx.play('ok'); setOv('me'); }}>G</button>
          <Clock />
        </div>
      </header>

      {page === 'act' && <Home games={games.data} summary={summary.data} onOpenGame={openGame} onPlay={g => { initAudio(); sfx.play('ok'); play.mutate({ id: g.id }); }} playError={play.error?.message ?? null} onStage={() => go('stage')} onAddGame={() => add.mutate()} adding={add.isPending} />}

      {page === 'stage' && (
        <div className="stage-ui">
          <div className="cname glow" style={{ color: c.color }}>{c.name.toUpperCase()}</div>
          <div className="cmeta">
            {c.id === 'other' ? plural(pc.platforms, 'plataforma', 'plataformas') : `${c.maker} · ${c.year}`}
            {' · '}{pc?.recomps ? plural(pc.recomps, 'recomp', 'recomps') : 'nenhum recomp ainda'}
            {pc?.installed ? ` · ${plural(pc.installed, 'instalado', 'instalados')}` : ''}
            {(() => { const ms = (games.data ?? []).filter(g => group.includes(g.console)).reduce((s, g) => s + g.playMs, 0); return ms ? ` · ${fmtPlay(ms)}` : ''; })()}
            {pc?.fresh ? <> · <b>{plural(pc.fresh, 'novo', 'novos')}</b></> : null}
          </div>
          <div className="nav">
            <button className="arrow" aria-label="Console anterior" onClick={() => move(-1)}>◀</button>
            <button className="enter" onClick={() => { initAudio(); onEnterConsole(c.id); }}>LIGAR</button>
            <button className="arrow" aria-label="Próximo console" onClick={() => move(1)}>▶</button>
          </div>
          <div className="groups">
            {MAKERS.filter(m => list.some(x => x.maker === m)).map(m => (
              <div key={m} className={`grp ${c.maker === m ? 'on' : ''}`}>
                <button onClick={() => setSel(list.findIndex(x => x.maker === m))}>{MAKER_LABEL[m]}</button>
                <div className="d">{list.map((x, i) => x.maker === m && <button key={x.id} className={i === sel ? 'on' : ''} aria-label={x.name} title={x.name} onClick={() => setSel(i)} />)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {add.error && <div className="toasts"><div className="toast"><div className="toast-k">NÃO DEU PARA ADICIONAR</div><div className="toast-g">{add.error.message}</div></div></div>}

      <Hints items={page === 'act' ? [['ok', 'Abrir'], ['menu', 'Consoles']] : [['lr', 'Console'], ['ok', 'Ligar'], ['back', 'Início']]} />
      <div className="sel-tools">
        <button className="icon-btn" title="Trocar botões mostrados (C)" onClick={() => {
          const o = ['auto', 'kb', 'xbox', 'ps', 'nin'] as const; setSettings({ pad: o[(o.indexOf(s.pad) + 1) % o.length]! });
        }}>🎮 {s.pad === 'auto' ? `Auto: ${PAD_NAMES[pad]}` : PAD_NAMES[s.pad]}</button>
      </div>

      {ov === 'radar' && <RadarOverlay onClose={() => setOv(null)} onOpenConsole={id => { setOv(null); onEnterConsole(id, { tab: 'cat' }); }} />}
      {ov === 'me' && <MeOverlay onClose={() => setOv(null)} />}
    </section>
  );
}
