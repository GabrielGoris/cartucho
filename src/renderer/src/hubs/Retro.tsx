import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AchievementView, ConsoleId, RadarEvent } from '@shared/types';
import { CONSOLE_NAME, isSelfInstall } from '@shared/consoles';
import { useTRPC } from '../trpc';
import { Glyph, useKeys, type Key } from '../lib/input';
import { getSettings, setSettings, useSettings } from '../lib/settings';
import { setSfxProfile, sfx } from '../lib/sfx';
import { ago, fmtDate, fmtPlay, plural } from '../lib/format';
import { focusSearch } from '../lib/search';
import { GameArt } from '../components/GameArt';
import { Discover, initialDiscover } from '../components/Discover';
import { GameView } from '../components/GameView';
import { CONSOLES } from '../stage/consoles';
import { BootOverlay, Fit, useClock, useHubToast } from './HubFrame';
import { useFeed, useHubData, type HubGame } from './data';
import { useGameMenu } from './menu';
import { otherConsoles } from '../stage/consoles';
import { Obj, SHELLS, shellH, type Kind } from './shells';

type Tab = 'games' | 'disc' | 'news' | 'ach' | 'time' | 'cfg';
interface Cfg { kind: Kind; sfx: string; boot: 'retro' | 'soft' | 'white' }
interface St { tab: number; idx: number; li: number; game: string | null; achOpen: boolean; ai2: number }
type Hint = [Parameters<typeof Glyph>[0]['a'], string];
interface Row { key: string; g?: HubGame; t: string; v?: string; s?: string; id?: string; bar?: number; f?: RadarEvent }

export const RETRO: Record<string, Cfg> = {
  snes: { kind: 'snes', sfx: 'square', boot: 'retro' },
  n64: { kind: 'n64', sfx: 'tri', boot: 'retro' },
  ps1: { kind: 'mc1', sfx: 'deep', boot: 'soft' },
  gc: { kind: 'gc', sfx: 'bubble', boot: 'retro' },
  ps2: { kind: 'mc2', sfx: 'deep', boot: 'soft' },
  nes: { kind: 'nes', sfx: 'square', boot: 'retro' },
  megadrive: { kind: 'md', sfx: 'square', boot: 'retro' },
  nds: { kind: 'nds', sfx: 'click', boot: 'white' },
  gb: { kind: 'gb', sfx: 'square', boot: 'retro' },
  other: { kind: 'box', sfx: 'soft', boot: 'soft' },
};
const TABS: [Tab, string][] = [['games', 'Meus jogos'], ['disc', 'Descobrir'], ['news', 'Novidades'], ['ach', 'Conquistas'], ['time', 'Tempo'], ['cfg', 'Ajustes']];
const FEED = { new: 'Novo no catálogo', upd: 'Versão nova', up: 'Mudou de status' } as const;
const CFG_ROWS: Row[] = [{ key: 'dir', id: 'dir', t: 'Pasta dos jogos' }, { key: 'snd', id: 'snd', t: 'Sons' }, { key: 'radar', id: 'radar', t: 'Radar de novidades' }, { key: 'off', id: 'off', t: 'Voltar ao Cartucho' }];
const VISIBLE = 7;

export function RetroHub({ id, game: game0, tab, onBack }: { id: ConsoleId; game?: string; tab?: 'lib' | 'cat'; onBack: () => void }) {
  const c = CONSOLES.find(x => x.id === id)!;
  const cfg = RETRO[id] ?? RETRO.snes!;
  const kind = cfg.kind;
  const cols = SHELLS[kind].cols, rh = shellH(kind) + (kind === 'mc2' ? 190 : 140);
  const self = isSelfInstall(id);
  const s = useSettings();
  const data = useHubData(id === 'other' ? otherConsoles(s.hidden) as ConsoleId[] : id);
  const trpc = useTRPC(), qc = useQueryClient();
  const [toast, show] = useHubToast();
  const [st, set] = useState<St>({ tab: tab === 'cat' ? 1 : 0, idx: 0, li: 0, game: null, achOpen: false, ai2: 0 });
  const up = (p: Partial<St>) => set(x => ({ ...x, ...p }));
  const [dst, setDst] = useState(initialDiscover);
  const clock = useClock();
  const pickDir = useMutation(trpc.settings.pickPortsDir.mutationOptions({ onSuccess: d => { qc.setQueryData(trpc.settings.portsDir.queryKey(), d); show('Pasta dos jogos alterada'); } }));

  useEffect(() => { setSfxProfile(cfg.sfx); const t = setTimeout(() => sfx.play('boot'), 150); return () => clearTimeout(t); }, [cfg.sfx]);

  useEffect(() => {
    const go = () => { sfx.play('ok'); set(x => ({ ...x, tab: 1, game: null, achOpen: false })); setDst(d => ({ ...d, zone: 'search' })); setTimeout(focusSearch, 80); };
    addEventListener('cartucho:search', go);
    return () => removeEventListener('cartucho:search', go);
  }, []);

  const mine = data.lib;
  const lookup = useMemo(() => new Map([...data.lib, ...data.catalog].flatMap(x => [[x.key, x] as const, ...(x.installed && x.catalog ? [[x.catalog.id, x] as const] : [])])), [data.lib, data.catalog]);
  const shown = useRef(false);
  useEffect(() => {
    if (!game0 || shown.current) return;
    const i = mine.findIndex(g => g.key === game0 || g.catalog?.id === game0);
    if (i >= 0) { shown.current = true; up({ idx: i, tab: 0, game: mine[i]!.key }); }
    else if (lookup.has(game0)) { shown.current = true; up({ game: lookup.get(game0)!.key }); }
  }, [game0, mine.length, lookup.size]);
  useEffect(() => { if (st.idx >= mine.length && mine.length) up({ idx: mine.length - 1 }); }, [mine.length]);
  const g = mine[st.idx] ?? null;
  const tk = TABS[st.tab]![0];

  const byPlay = useMemo(() => [...data.lib].sort((a, b) => (b.installed?.playMs ?? 0) - (a.installed?.playMs ?? 0)), [data.lib]);
  const maxPlay = Math.max(1, ...byPlay.map(x => x.installed?.playMs ?? 0));
  const rows: Row[] = tk === 'news' ? data.feed.map(f => ({ key: String(f.id), f, g: data.catalog.find(y => y.catalog?.id === f.gameId), t: f.title, s: `${FEED[f.kind]}${f.detail && !(self && f.kind === 'new') ? ` · ${f.detail}` : ''}`, v: ago(f.at) }))
    : tk === 'ach' ? data.lib.map(x => ({ key: x.key, g: x, t: x.title, v: x.installed?.achievements?.total ? `${x.installed.achievements.unlocked}/${x.installed.achievements.total}` : '—' }))
    : tk === 'time' ? byPlay.map(x => ({ key: x.key, g: x, t: x.title, v: fmtPlay(x.installed?.playMs ?? 0) || '0m', bar: (x.installed?.playMs ?? 0) / maxPlay }))
    : tk === 'cfg' ? CFG_ROWS.map(r => ({ ...r, v: r.id === 'snd' ? (s.snd ? 'Ligados' : 'Desligados') : '' }))
    : [];
  const row = rows[st.li];
  const feed = useFeed(data.feed, tk === 'news' && !st.game);
  const achGame = tk === 'ach' ? row?.g ?? null : null;
  const ach = useQuery(trpc.achievements.forGame.queryOptions({ id: achGame?.installed?.id ?? '' }, { enabled: !!achGame?.installed?.adapter }));
  const achList = ach.data ? [...ach.data.list].sort((a, b) => (b.unlockedAt ?? -1) - (a.unlockedAt ?? -1)) : [];
  const statsAll = useQueries({ queries: (tk === 'time' ? byPlay : []).map(x => trpc.play.stats.queryOptions({ id: x.installed!.id })) });

  const game = st.game ? lookup.get(st.game) ?? null : null;

  const menu = useGameMenu({
    show, onInfo: x => { sfx.play('ok'); up({ game: x.key }); }, onRemoved: () => up({ game: null }),
    onAch: x => up({ game: null, tab: 3, li: Math.max(0, data.lib.indexOf(x)), achOpen: true, ai2: 0 }),
  });
  useEffect(() => { if (menu.error) { show(menu.error); menu.reset(); } }, [menu.error]);
  const { options, run } = menu;
  const openGame = (x: HubGame) => { sfx.play('ok'); up({ game: x.key }); };

  const goTab = (d: number) => { sfx.play('move'); set(x => ({ ...x, tab: (x.tab + d + TABS.length) % TABS.length, li: 0, achOpen: false })); };
  const setTab = (i: number) => { if (i === st.tab) return; sfx.play('move'); up({ tab: i, li: 0, achOpen: false }); };

  const enter = () => {
    if (tk === 'games') {
      if (!g) { sfx.play('ok'); return up({ tab: 1 }); }
      return run(options(g)[0]!.k, g);
    }
    if (!row) return;
    if (tk === 'cfg') {
      sfx.play('ok');
      if (row.id === 'dir') return pickDir.mutate();
      if (row.id === 'snd') return setSettings({ snd: !getSettings().snd });
      if (row.id === 'off') return onBack();
      return show('O radar confere o catálogo toda vez que o Cartucho abre');
    }
    if (tk === 'ach') { if (achList.length) { sfx.play('ok'); up({ achOpen: !st.achOpen, ai2: 0 }); } return; }
    if (row.f) feed.done(row.f);
    if (row.g) openGame(row.g);
  };
  const back = () => {
    sfx.play('back');
    if (st.achOpen) return up({ achOpen: false });
    if (st.tab !== 0) return up({ tab: 0 });
    onBack();
  };

  useKeys((k: Key) => {
    if (k === 'Escape') return back();
    if (k === 'Enter') return enter();
    if (k === 'LB' || k === 'RB' || k === 'Tab') return goTab(k === 'LB' ? -1 : 1);
    const R = k === 'ArrowRight', L = k === 'ArrowLeft', U = k === 'ArrowUp', D = k === 'ArrowDown';
    const mv = (p: Partial<St>) => { sfx.play('move'); up(p); };
    if (tk === 'games') {
      if (k === 'Y') { sfx.play('ok'); up({ tab: 1 }); setDst(d => ({ ...d, zone: 'search' })); setTimeout(focusSearch, 80); return; }
      if (!g) return;
      if (k === 'X') return openGame(g);
      const n = mine.length, i = st.idx;
      if (R && i % cols < cols - 1 && i + 1 < n) mv({ idx: i + 1 });
      else if (L && i % cols > 0) mv({ idx: i - 1 });
      else if (D && i + cols < n) mv({ idx: i + cols });
      else if (D && Math.floor(i / cols) < Math.floor((n - 1) / cols)) mv({ idx: n - 1 });
      else if (U && i >= cols) mv({ idx: i - cols });
      else if (k === 'RT') mv({ idx: Math.min(n - 1, i + cols * 2) });
      else if (k === 'LT') mv({ idx: Math.max(0, i - cols * 2) });
      return;
    }
    if (tk === 'news' && (k === 'X' || k === 'Y')) {
      if (k === 'X' && feed.drop(row?.f)) up({ li: Math.max(0, Math.min(st.li, rows.length - 2)) });
      if (k === 'Y') void feed.clear();
      return;
    }
    if (st.achOpen) { if (D && st.ai2 < achList.length - 1) mv({ ai2: st.ai2 + 1 }); else if (U && st.ai2 > 0) mv({ ai2: st.ai2 - 1 }); return; }
    if (D && st.li < rows.length - 1) mv({ li: st.li + 1 }); else if (U && st.li > 0) mv({ li: st.li - 1 });
    else if (k === 'RT') mv({ li: Math.min(rows.length - 1, st.li + VISIBLE) }); else if (k === 'LT') mv({ li: Math.max(0, st.li - VISIBLE) });
  }, !(game || tk === 'disc'));

  const hints: Hint[] = tk === 'games'
    ? (g ? [['ok', options(g)[0]!.l], ['x', 'Página do jogo'], ['y', 'Buscar'], ['rb', 'Seção'], ['back', 'Sair']] : [['ok', 'Descobrir jogos'], ['rb', 'Seção'], ['back', 'Sair']])
    : tk === 'news' && rows.length ? [['ok', 'Ver jogo'], ['x', 'Dispensar'], ['y', 'Limpar tudo'], ['rb', 'Seção'], ['back', 'Voltar']]
    : [['ok', tk === 'cfg' ? 'OK' : tk === 'ach' ? (st.achOpen ? 'Fechar' : 'Ver lista') : 'Abrir'], ['ud', 'Mover'], ['rb', 'Seção'], ['back', 'Voltar']];
  const H = <div className="rh-ft">{hints.map(([a, t]) => <span key={a + t}><Glyph a={a} />{t}</span>)}</div>;
  const off = Math.max(0, Math.min(st.li - 3, rows.length - VISIBLE));
  const line = (x: HubGame) => id === 'other' ? `${sourceOf(x)} · ${line0(x)}` : line0(x);
  const line0 = (x: HubGame) => x.installed?.missing ? 'Pasta não encontrada' : x.installed?.running ? 'Jogando agora' : x.installed?.playMs ? `${fmtPlay(x.installed.playMs)} jogadas` : 'Ainda não jogado';

  const header = (
    <header className="rh-hd">
      <b className="rh-name">{c.name}</b>
      <nav className="rh-tabs">
        <Glyph a="lb" />
        {TABS.map(([k, l], j) => (
          <button key={k} className={`${j === st.tab ? 'on' : ''}`} onClick={() => setTab(j)}>
            {l}{k === 'news' && data.feed.length > 0 && <i className="nw">{data.feed.length}</i>}
          </button>
        ))}
        <Glyph a="rb" />
      </nav>
      <span className="rh-clock">{clock}</span>
    </header>
  );

  const item = (x: HubGame, i: number) => (
    <button key={x.key} className={`rg-it ${i === st.idx ? 'on' : ''} ${x.installed?.missing ? 'miss' : ''} ${x.installed?.running ? 'run' : ''}`} aria-label={x.title}
      onClick={() => { if (i === st.idx) enter(); else { sfx.play('move'); up({ idx: i }); } }}>
      <Obj kind={kind}><GameArt title={x.title} console={x.console} platformName={x.platformName} fallback={x.coverUrl} variant="cover" /></Obj>
      <span className="rg-t">{x.title}</span>
      <span className="rg-s">{line(x)}</span>
    </button>
  );
  const rowI = Math.floor(st.idx / cols);
  const viewH = kind === 'nds' ? 790 : 796;
  const shift = Math.max(0, (rowI + 1) * rh - viewH + 40);

  const empty = (
    <div className="rw rg-empty">
      <b>Nenhum jogo de {c.name} instalado ainda</b>
      <p>{data.catalog.length ? `O catálogo tem ${plural(data.catalog.length, 'jogo', 'jogos')} para este console. Procure um em Descobrir.` : `O radar avisa quando aparecer o primeiro recomp de ${c.name}.`}</p>
      {data.catalog.length > 0 && <button className="on" onClick={() => { sfx.play('ok'); up({ tab: 1 }); }}><Glyph a="ok" />Descobrir jogos</button>}
    </div>
  );

  return (
    <section className={`view hub sk-rt t-${id}`} style={{ ['--cc' as string]: c.color }}>
      <Fit w={1920} h={1080} className={`rt k-${kind}`} style={{ ['--cc' as string]: c.color }}>
        {header}

        {tk === 'games' && (kind === 'nds' ? (
          <>
            <div className="ds-top">
              {g ? <DsTop g={g} line={line(g)} /> : empty}
            </div>
            <div className="ds-hinge" />
            <div className="ds-bot">
              <div className="rg-view"><div className="rg-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridAutoRows: rh, transform: `translateY(-${shift}px)` }}>{mine.map(item)}</div></div>
            </div>
          </>
        ) : mine.length ? (
          <div className="rg-view"><div className="rg-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridAutoRows: rh, transform: `translateY(-${shift}px)` }}>{mine.map(item)}</div></div>
        ) : empty)}

        {tk !== 'games' && tk !== 'disc' && (
          <div className="rw rl">
            {tk === 'time' && <div className="rl-sum">{fmtPlay(data.playMs) || '0m'} neste console · {statsAll.reduce((a, q) => a + (q.data?.sessions ?? 0), 0)} sessões</div>}
            {st.achOpen && achGame ? (
              <>
                <div className="rl-sum">{achGame.title} · {achList.filter(a => a.unlockedAt != null).length}/{achList.length}</div>
                <AchList list={achList} sel={st.ai2} />
              </>
            ) : rows.length ? (
              <div className="rl-rows">{rows.slice(off, off + VISIBLE).map((r, j) => (
                <button key={r.key} className={`rl-r ${off + j === st.li ? 'on' : ''} ${r.g ? 'thumb' : ''}`} onClick={() => { if (st.li === off + j) enter(); else { sfx.play('move'); up({ li: off + j }); } }}>
                  {r.g && <span className="th"><GameArt title={r.g.title} console={r.g.console} platformName={r.g.platformName} fallback={r.g.coverUrl} variant="cover" /></span>}
                  <span className="t">{r.t}</span>{r.v && <span className="v">{r.v}</span>}
                  {r.s && <span className="s">{r.s}</span>}
                  {r.bar != null && <span className="bar"><i style={{ width: `${r.bar * 100}%` }} /></span>}
                </button>
              ))}</div>
            ) : <div className="rl-empty">{tk === 'news' ? 'Nada novo por aqui.' : 'Nenhum jogo instalado.'}</div>}
            {tk === 'cfg' && row && <div className="rl-note">{row.id === 'dir' ? <PortsDir /> : row.id === 'snd' ? 'Sons de navegação da interface.' : row.id === 'radar' ? 'Confere o catálogo toda vez que o Cartucho abre.' : 'Desliga este console e volta ao palco.'}</div>}
            {tk === 'ach' && !st.achOpen && achGame && !achGame.installed?.adapter && <div className="rl-note">O Cartucho ainda não lê as conquistas deste port.</div>}
          </div>
        )}

        {tk !== 'disc' && H}

        {tk === 'disc' && !game && header}
        {tk === 'disc' && !game && (
          <Discover theme="d-retro" shape={kind === 'snes' || kind === 'n64' ? 'wide' : kind === 'mc1' || kind === 'gb' || kind === 'nds' ? 'square' : 'tall'} cname={c.name} games={data.catalog} extra={data.lib.filter(x => !x.catalog)} self={self} st={dst} set={setDst}
            options={x => options(x).filter(o => o.k !== 'info')} run={run} onOpen={openGame} onBack={() => { sfx.play('back'); up({ tab: 0 }); }} onTab={goTab}
            {...(id === 'other' ? { groupOf: sourceOf, groupLabel: 'Plataforma' } : {})} />
        )}
        {game && <GameView theme="d-retro" g={game} opts={options(game, true)} run={run} self={self} onBack={() => up({ game: null })} />}
        {toast}
      </Fit>
      <BootOverlay kind={cfg.boot} label={c.short} />
    </section>
  );
}

function DsTop({ g, line }: { g: HubGame; line: string }) {
  return (
    <div className="ds-sel" key={g.key}>
      <span className="ds-cv"><GameArt title={g.title} console={g.console} platformName={g.platformName} fallback={g.coverUrl} variant="cover" /></span>
      <div>
        <h2>{g.title}</h2>
        <p>{[g.catalog?.developer, g.catalog?.year].filter(Boolean).join(' · ')}</p>
        <p className="hi">{line}</p>
        {g.installed?.achievements?.total ? <p>{g.installed.achievements.unlocked}/{g.installed.achievements.total} conquistas</p> : null}
      </div>
    </div>
  );
}

function AchList({ list, sel }: { list: AchievementView[]; sel: number }) {
  const off = Math.max(0, Math.min(sel - 2, list.length - 6));
  return (
    <div className="rl-rows">{list.slice(off, off + 6).map((a, j) => (
      <div key={a.id} className={`rl-r ach ${off + j === sel ? 'on' : ''} ${a.unlockedAt != null ? '' : 'lock'}`}>
        <span className="t">{a.unlockedAt != null ? '★ ' : '· '}{a.name}</span><span className="v">{a.unlockedAt != null ? fmtDate(a.unlockedAt).split(',')[0] : 'Bloqueada'}</span>
        {a.description && <span className="s">{a.description}</span>}
      </div>
    ))}</div>
  );
}

function PortsDir() {
  const trpc = useTRPC();
  const q = useQuery(trpc.settings.portsDir.queryOptions());
  return <>{q.data ?? '…'}</>;
}

const sourceOf = (g: HubGame) => (g.console === 'other' ? g.platformName ?? 'Outros' : CONSOLE_NAME[g.console]);
