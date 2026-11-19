import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';
import type { ConsoleId, PlayEvent, UnlockEvent } from '@shared/types';
import { pushProgress } from './lib/progress';
import { fmtPlay } from './lib/format';
import { useTRPC } from './trpc';
import { getSettings, reduceMotion, setSettings, useSettings } from './lib/settings';
import { applyPalette, paletteById, PALETTES } from './lib/palettes';
import { setShortcutHandler } from './lib/input';
import { sfx } from './lib/sfx';
import { Stage } from './stage/Stage';
import { consoleIndex, CONSOLES } from './stage/consoles';
import { Boot } from './views/Boot';
import { Select, type Page } from './views/Select';
import { ConsoleView } from './views/ConsoleView';
import { Settings } from './views/Settings';

type Inside = { id: ConsoleId; game?: string; tab?: 'lib' | 'cat'; key: number };
const LAST = 'cartucho.lastConsole';

export function App() {
  const s = useSettings();
  const palette = paletteById(s.pal);
  useEffect(() => applyPalette(palette), [palette]);

  const [booting, setBooting] = useState(s.boot);
  const [page, setPage] = useState<Page>(s.start);
  const [sel, setSel] = useState(() => consoleIndex(localStorage.getItem(LAST) ?? 'snes'));
  useEffect(() => { try { localStorage.setItem(LAST, CONSOLES[sel]!.id); } catch { /* ok */ } }, [sel]);
  const [inside, setInside] = useState<Inside | null>(null);
  const [zoom, setZoom] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tvAnim, setTvAnim] = useState<'' | 'off' | 'on'>('');
  const [toasts, setToasts] = useState<{ k: string; n: string; g: string }[]>([]);
  const [playing, setPlaying] = useState<Record<string, string>>({});   // jogos abertos agora (id → título)
  const toast = (t: { k: string; n: string; g: string }) => { setToasts(x => [...x, t]); setTimeout(() => setToasts(x => x.filter(y => y !== t)), 6000); };

  const trpc = useTRPC(), qc = useQueryClient();
  const summary = useQuery(trpc.library.summary.queryOptions());

  // desligar/ligar a TV entre telas
  const timers = useRef<number[]>([]);
  const transition = (fn: () => void) => {
    if (reduceMotion()) return fn();
    timers.current.forEach(clearTimeout);
    setTvAnim('off');
    timers.current = [window.setTimeout(() => { fn(); setTvAnim('on'); timers.current.push(window.setTimeout(() => setTvAnim(''), 460)); }, 420)];
  };

  const enterConsole = (id: ConsoleId, opts: { game?: string; tab?: 'lib' | 'cat' } = {}) => {
    setSel(consoleIndex(id)); setZoom(true); sfx.play('ok');
    transition(() => setInside({ id, ...opts, key: Date.now() }));
  };
  const leaveConsole = () => transition(() => { setInside(null); setZoom(false); setPage('stage'); });

  // atalhos de uma letra
  useEffect(() => setShortcutHandler(key => {
    const k = key.toLowerCase();
    if (k === 's' && !booting) { setSettingsOpen(o => !o); return true; }
    if (k === 'm') { setSettings({ snd: !getSettings().snd }); return true; }
    if (k === 'c') { const o = ['auto', 'kb', 'xbox', 'ps', 'nin'] as const; setSettings({ pad: o[(o.indexOf(getSettings().pad) + 1) % o.length]! }); return true; }
    if (k === 'p') { const i = PALETTES.findIndex(p => p.id === getSettings().pal); setSettings({ pal: PALETTES[(i + 1) % PALETTES.length]!.id }); return true; }
    return false;
  }), [booting]);

  useSubscription(trpc.achievements.onUnlock.subscriptionOptions(undefined, {
    onData: (e: UnlockEvent) => toast({ k: 'CONQUISTA DESBLOQUEADA', n: e.name, g: e.gameTitle }),
  }));
  useSubscription(trpc.ports.onProgress.subscriptionOptions(undefined, {
    onData: p => { pushProgress(p); if (p.done) { void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }); void qc.invalidateQueries({ queryKey: trpc.library.summary.queryKey() }); } },
  }));
  useSubscription(trpc.play.onEvent.subscriptionOptions(undefined, {
    onData: (e: PlayEvent) => {
      setPlaying(p => { const { [e.gameId]: _, ...rest } = p; return e.running ? { ...rest, [e.gameId]: e.title } : rest; });
      if (!e.running && e.sessionMs) toast({ k: 'SESSÃO ENCERRADA', n: fmtPlay(e.sessionMs), g: e.title });
      void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }); void qc.invalidateQueries({ queryKey: trpc.play.pathKey() }); void qc.invalidateQueries({ queryKey: trpc.library.summary.queryKey() });
    },
  }));
  useSubscription(trpc.achievements.onChanged.subscriptionOptions(undefined, {
    onData: () => { void qc.invalidateQueries({ queryKey: trpc.games.list.queryKey() }); void qc.invalidateQueries({ queryKey: trpc.achievements.pathKey() }); void qc.invalidateQueries({ queryKey: trpc.library.summary.queryKey() }); },
  }));

  const tvClass = useMemo(() => [
    tvAnim, s.crtLvl ? '' : 'no-crt', s.flicker && !s.reduce ? '' : 'no-flicker', s.frame ? '' : 'no-frame',
    s.glow ? '' : 'no-glow', s.blur ? '' : 'no-blur', s.reduce ? 'reduce' : '',
  ].filter(Boolean).join(' '), [tvAnim, s]);

  // com um jogo aberto o palco 3D para de desenhar (a placa de vídeo fica para o jogo)
  const gameOpen = Object.keys(playing).length > 0;
  const stageMode = inside || gameOpen ? 'hidden' : booting || page === 'act' ? 'behind' : 'stage';

  return (
    <div id="tv" className={tvClass} style={{ ['--crt' as string]: s.crtLvl / 100 }}>
      <Stage sel={sel} mode={stageMode} zoom={zoom} palette={palette} pixel={s.pixel} onSelect={i => { sfx.play('move'); setSel((i + CONSOLES.length) % CONSOLES.length); }} onEnter={i => enterConsole(CONSOLES[i]!.id)} />
      {!inside && (
        <Select active={!booting && !settingsOpen} page={page} setPage={setPage} sel={sel} setSel={setSel}
          onEnterConsole={enterConsole} onSettings={() => { sfx.play('ok'); setSettingsOpen(true); }} />
      )}
      {inside && <ConsoleView key={inside.key} id={inside.id} game={inside.game} tab={inside.tab} active={!settingsOpen} onBack={leaveConsole} />}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      {booting && <Boot summary={summary.data} onDone={() => setBooting(false)} />}

      {gameOpen && <div className="playing">▶ JOGANDO {Object.values(playing).join(', ').toUpperCase()}</div>}
      <div className="toasts">
        {toasts.map((t, i) => (
          <div key={i} className="toast">
            <div className="toast-k">{t.k}</div>
            <div className="toast-n">{t.n}</div>
            <div className="toast-g">{t.g}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
