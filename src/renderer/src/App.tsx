import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';
import type { ConsoleId, PlayEvent, UnlockEvent } from '@shared/types';
import { pushProgress } from './lib/progress';
import { fmtPlay } from './lib/format';
import { useTRPC } from './trpc';
import { getSettings, reduceMotion, setSettings, useSettings } from './lib/settings';
import { applyPalette, paletteById, PALETTES } from './lib/palettes';
import { setGlobalKeys, setShortcutHandler } from './lib/input';
import { useConfirmReq } from './lib/dialogs';
import { CartuchoMenu, ConfirmHost, PickerHost } from './views/GlobalUI';
import { MeOverlay, RadarOverlay, SupportOverlay } from './views/Overlays';
import { askConfirm } from './lib/dialogs';
import { CONSOLES } from './stage/consoles';
import { sfx } from './lib/sfx';
import { focusSearch } from './lib/search';
import { Stage } from './stage/Stage';
import { routeConsole, visibleConsoles } from './stage/consoles';
import { Boot } from './views/Boot';
import { Select, type Page } from './views/Select';
import { ConsoleView } from './views/ConsoleView';
import { Settings } from './views/Settings';
import { ConsolePicker } from './views/ConsolePicker';
import { HUBS } from './hubs';
import { TitleBar } from './components/TitleBar';
import { AllGames } from './views/AllGames';

type Inside = { id: ConsoleId; game?: string; tab?: 'lib' | 'cat'; key: number };
const LAST = 'cartucho.lastConsole';

export function App() {
  const s = useSettings();
  const palette = paletteById(s.pal);
  useEffect(() => applyPalette(palette), [palette]);

  const [booting, setBooting] = useState(s.boot);
  const [page, setPage] = useState<Page>(s.start);
  const list = useMemo(() => visibleConsoles(s.hidden), [s.hidden]);
  const [selId, setSelId] = useState(() => localStorage.getItem(LAST) ?? 'snes');
  const sel = Math.max(0, list.findIndex(c => c.id === selId));
  const setSel = (v: number | ((prev: number) => number)) => setSelId(prev => {
    const i = typeof v === 'function' ? v(Math.max(0, list.findIndex(c => c.id === prev))) : v;
    return list[((i % list.length) + list.length) % list.length]!.id;
  });
  useEffect(() => { try { localStorage.setItem(LAST, list[sel]!.id); } catch { } }, [sel, list]);
  const [picker, setPicker] = useState(false);
  const [inside, setInside] = useState<Inside | null>(null);
  const [all, setAll] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [gov, setGov] = useState<null | 'radar' | 'me' | 'support'>(null);
  const confirmReq = useConfirmReq();
  const [tvAnim, setTvAnim] = useState<'' | 'off' | 'on'>('');
  const [toasts, setToasts] = useState<{ k: string; n: string; g: string }[]>([]);
  const [playing, setPlaying] = useState<Record<string, string>>({});
  const toast = (t: { k: string; n: string; g: string }) => { setToasts(x => [...x, t]); setTimeout(() => setToasts(x => x.filter(y => y !== t)), 6000); };

  const trpc = useTRPC(), qc = useQueryClient();
  const overlay = useMutation(trpc.win.overlay.mutationOptions());
  const installUpd = useMutation(trpc.updates.install.mutationOptions());
  const asked = useRef<string | null>(null);
  useSubscription(trpc.updates.onState.subscriptionOptions(undefined, {
    onData: u => {
      qc.setQueryData(trpc.updates.state.queryKey(), u);
      if (u.status !== 'ready' || !u.version || asked.current === u.version) return;
      asked.current = u.version;
      void askConfirm({ title: `Cartucho ${u.version} pronto`, text: 'A atualização já foi baixada. Reiniciar agora para instalar? Se preferir deixar para depois, ela entra sozinha quando você fechar o Cartucho.', ok: 'Reiniciar agora', cancel: 'Depois' })
        .then(y => { if (y) installUpd.mutate(); });
    },
  }));
  useEffect(() => { overlay.mutate({ color: palette.bg0, symbol: palette.acc }); }, [palette.id]);
  const summary = useQuery(trpc.library.summary.queryOptions());

  const timers = useRef<number[]>([]);
  const transition = (fn: () => void) => {
    if (reduceMotion()) return fn();
    timers.current.forEach(clearTimeout);
    setTvAnim('off');
    timers.current = [window.setTimeout(() => { fn(); setTvAnim('on'); timers.current.push(window.setTimeout(() => setTvAnim(''), 460)); }, 420)];
  };

  const enterConsole = (id0: ConsoleId, opts: { game?: string; tab?: 'lib' | 'cat' } = {}) => {
    const id = routeConsole(id0, getSettings().hidden);
    setSelId(id); setZoom(true); sfx.play('ok');
    transition(() => setInside({ id, ...opts, key: Date.now() }));
  };
  const leaveConsole = () => transition(() => { setInside(null); setAll(false); setZoom(false); setPage('stage'); });
  const openAll = () => transition(() => setAll(true));
  const closeAll = () => transition(() => { setAll(false); setPage('act'); });

  const gk = useRef({ booting, picker, confirmReq, inside, leaveConsole, all, closeAll });
  gk.current = { booting, picker, confirmReq, inside, leaveConsole, all, closeAll };
  useEffect(() => setGlobalKeys(k => {
    const g = gk.current;
    if (g.booting || g.picker || g.confirmReq || document.querySelector('.osk-ov, .gl-pick')) return false;
    if (k === 'Start') { sfx.play(menu ? 'back' : 'ok'); setMenu(m => !m); return true; }
    if (k === 'Home') { setMenu(false); setGov(null); setSettingsOpen(false); if (g.inside) g.leaveConsole(); else if (g.all) g.closeAll(); else setPage('stage'); sfx.play('back'); return true; }
    return false;
  }), [menu]);

  useEffect(() => setShortcutHandler(key => {
    const k = key.toLowerCase();
    if (k === 's' && !booting && !picker) { setSettingsOpen(o => !o); return true; }
    if (k === 'm') { setSettings({ snd: !getSettings().snd }); return true; }
    if (k === 'c') { const o = ['auto', 'kb', 'xbox', 'ps', 'nin'] as const; setSettings({ pad: o[(o.indexOf(getSettings().pad) + 1) % o.length]! }); return true; }
    if (k === '/') { if (!focusSearch()) dispatchEvent(new Event('cartucho:search')); return true; }
    if (k === 'p') { const i = PALETTES.findIndex(p => p.id === getSettings().pal); setSettings({ pal: PALETTES[(i + 1) % PALETTES.length]!.id }); return true; }
    return false;
  }), [booting, picker]);

  useSubscription(trpc.achievements.onUnlock.subscriptionOptions(undefined, {
    onData: (e: UnlockEvent) => toast({ k: 'CONQUISTA DESBLOQUEADA', n: e.name, g: e.gameTitle }),
  }));
  useSubscription(trpc.ports.onProgress.subscriptionOptions(undefined, {
    onData: p => { pushProgress(p); if (p.done) { void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }); void qc.invalidateQueries({ queryKey: trpc.library.summary.queryKey() }); } },
  }));
  useSubscription(trpc.art.onChanged.subscriptionOptions(undefined, { onData: () => void qc.invalidateQueries({ queryKey: trpc.art.pathKey() }) }));
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
    tvAnim, (inside && HUBS[inside.id]?.hd) || all ? 'hd' : '', s.crtLvl ? '' : 'no-crt', s.flicker && !s.reduce ? '' : 'no-flicker', s.frame ? '' : 'no-frame',
    s.glow ? '' : 'no-glow', s.blur ? '' : 'no-blur', s.reduce ? 'reduce' : '',
  ].filter(Boolean).join(' '), [tvAnim, s, inside, all]);

  const gameOpen = Object.keys(playing).length > 0;
  const stageMode = inside || all || gameOpen ? 'hidden' : booting || page === 'act' ? 'behind' : 'stage';
  const askPicker = picker || (!s.picked && !booting && !inside && !settingsOpen && page === 'stage');

  return (
    <>
    <TitleBar ctx={inside ? CONSOLES.find(c => c.id === inside.id)?.name ?? null : all ? 'Todos os jogos' : null} onMenu={() => { sfx.play('ok'); setMenu(true); }} />
    <div id="tv" className={tvClass} style={{ ['--crt' as string]: s.crtLvl / 100 }}>
      <Stage list={list} sel={sel} mode={stageMode} zoom={zoom} palette={palette} pixel={s.pixel} onSelect={i => { sfx.play('move'); setSel(i); }} onEnter={i => enterConsole(list[i]!.id)} />
      {all && !inside && <AllGames onBack={closeAll} />}
      {!inside && !all && (
<Select active={!booting && !settingsOpen && !askPicker && !menu && !gov} list={list} page={page} setPage={setPage} sel={sel} setSel={setSel}
          onEnterConsole={enterConsole} onAll={openAll} onMenu={() => { sfx.play('ok'); setMenu(true); }} onSettings={() => { sfx.play('ok'); setSettingsOpen(true); }} />
      )}
      {inside && (() => {
        const H = HUBS[inside.id];
        if (H) return <H.component key={inside.key} id={inside.id} game={inside.game} tab={inside.tab} onBack={leaveConsole} />;
        return <ConsoleView key={inside.key} id={inside.id} game={inside.game} tab={inside.tab} active={!settingsOpen} onBack={leaveConsole} />;
      })()}
      {menu && <CartuchoMenu inside={inside ? CONSOLES.find(c => c.id === inside.id)?.name ?? null : all ? 'Todos os jogos' : null} onClose={() => setMenu(false)}
        onSettings={() => setSettingsOpen(true)} onRadar={() => setGov('radar')} onProfile={() => setGov('me')} onPickConsoles={() => setPicker(true)} onLeave={all ? closeAll : leaveConsole} onAll={openAll} onSupport={() => setGov('support')} />}
      {gov === 'radar' && <RadarOverlay onClose={() => setGov(null)} onOpenConsole={id => { setGov(null); enterConsole(id, { tab: 'cat' }); }} />}
      {gov === 'me' && <MeOverlay onClose={() => setGov(null)} />}
      {gov === 'support' && <SupportOverlay onClose={() => setGov(null)} />}
      <ConfirmHost />
      <PickerHost />
      {settingsOpen && <Settings onSupport={() => { setSettingsOpen(false); setGov('support'); }} onClose={() => setSettingsOpen(false)} onPickConsoles={() => { setSettingsOpen(false); setPicker(true); }} />}
      {askPicker && <ConsolePicker first={!s.picked} onClose={() => setPicker(false)} />}
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
    </>
  );
}
