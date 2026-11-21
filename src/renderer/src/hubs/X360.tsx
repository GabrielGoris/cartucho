import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConsoleId, PlayStats, RadarEvent } from '@shared/types';
import { isSelfInstall, SELF_INSTALL_NOTE, STATUS_LABEL } from '@shared/consoles';
import { useTRPC } from '../trpc';
import { Glyph, useKeys, type Key } from '../lib/input';
import { getSettings, setSettings, useSettings } from '../lib/settings';
import { setSfxProfile, sfx } from '../lib/sfx';
import { ago, fmtDate, fmtPlay, plural } from '../lib/format';
import { focusSearch as focusAny, matchesQuery } from '../lib/search';
import { GameView } from '../components/GameView';
import { Discover, initialDiscover } from '../components/Discover';
import { useArt } from '../lib/art';
import { useTranslated } from '../lib/translate';
import { GameArt } from '../components/GameArt';
import { CONSOLES } from '../stage/consoles';
import { BootOverlay, Fit, useClock, useHubToast } from './HubFrame';
import { Ic, type IconName } from './icons';
import { useHubActions, useHubData, type HubGame } from './data';

type Tab = 'home' | 'games' | 'cat' | 'news' | 'ach' | 'time' | 'cfg';
type Zone = 'tabs' | 'tiles' | 'list' | 'gacts' | 'gshots' | 'gtext';
interface St { tab: number; zone: Zone; fi: number; li: number; mi: number; dir: 1 | -1; menu: boolean; game: string | null; ai: number; gs: number }
interface Tile { x: number; y: number; w: number; h: number; g?: HubGame; cls?: string; cap: string; sub?: string; big?: boolean; quick?: HubGame[]; txt?: ReactNode; bar?: number; tag?: string; tagCls?: string; go?: Tab; feed?: RadarEvent; idx?: number }
interface Row { key: string; g?: HubGame; ic?: IconName; l: string; v?: string; id?: string }
type Opt = { k: string; l: string; ic: IconName };
type Hint = [Parameters<typeof Glyph>[0]['a'], string];

const TABS: [Tab, string][] = [['home', 'início'], ['games', 'jogos'], ['cat', 'descobrir'], ['news', 'novidades'], ['ach', 'conquistas'], ['time', 'tempo'], ['cfg', 'ajustes']];
const CFG: Row[] = [
  { key: 'dir', id: 'dir', l: 'Pasta dos jogos', ic: 'folder' }, { key: 'snd', id: 'snd', l: 'Sons da interface', ic: 'sound' },
  { key: 'radar', id: 'radar', l: 'Radar de novidades', ic: 'bell' }, { key: 'off', id: 'off', l: 'Voltar ao Cartucho', ic: 'power' },
];
const FEED = { new: 'novo no catálogo', upd: 'versão nova', up: 'mudou de status' } as const;
const PER = 10, LIST_ROWS = 7;

const Art = ({ g, v }: { g: HubGame; v: 'cover' | 'wide' | 'square' }) =>
  <GameArt title={g.title} console={g.console} platformName={g.platformName} fallback={g.coverUrl} variant={v} />;

function nearest(T: Tile[], fi: number, k: Key) {
  const a = T[fi]; if (!a) return -1;
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
  let best = -1, bs = 1e9;
  T.forEach((b, j) => {
    if (j === fi) return;
    const dx = b.x + b.w / 2 - ax, dy = b.y + b.h / 2 - ay;
    const ok = k === 'ArrowRight' ? dx > 20 : k === 'ArrowLeft' ? dx < -20 : k === 'ArrowDown' ? dy > 20 : dy < -20;
    if (!ok) return;
    const h = k === 'ArrowRight' || k === 'ArrowLeft';
    const sc = (h ? Math.abs(dx) : Math.abs(dy)) + (h ? Math.abs(dy) : Math.abs(dx)) * 2;
    if (sc < bs) { bs = sc; best = j; }
  });
  return best;
}

export function X360Hub({ id, game: game0, tab, onBack }: { id: ConsoleId; game?: string; tab?: 'lib' | 'cat'; onBack: () => void }) {
  const c = CONSOLES.find(x => x.id === id)!;
  const og = id === 'xbox';
  const self = isSelfInstall(id);
  const data = useHubData(id);
  const act = useHubActions();
  const trpc = useTRPC(), qc = useQueryClient();
  const s = useSettings();
  const [toast, show] = useHubToast();
  const [st, set] = useState<St>(() => ({ tab: tab === 'cat' ? 2 : tab === 'lib' ? 1 : 0, zone: 'tiles', fi: tab ? 0 : 2, li: 0, mi: 0, dir: 1, menu: false, game: null, ai: 0, gs: 0 }));
  const up = (p: Partial<St>) => set(x => ({ ...x, ...p }));
  const [query, setQuery] = useState('');
  const clock = useClock();
  const pickDir = useMutation(trpc.settings.pickPortsDir.mutationOptions({ onSuccess: d => { qc.setQueryData(trpc.settings.portsDir.queryKey(), d); show('Pasta dos jogos alterada'); } }));
  const chooseExe = useMutation(trpc.games.chooseExe.mutationOptions({ onSuccess: () => void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }) }));
  const openFolder = useMutation(trpc.games.openFolder.mutationOptions());

  useEffect(() => { setSfxProfile('click'); const t = setTimeout(() => sfx.play('boot'), 150); return () => clearTimeout(t); }, []);
  useEffect(() => { if (act.error) { show(act.error); act.reset(); } }, [act.error]);
  const [dst, setDst] = useState(initialDiscover);
  const focusSearch = () => { setDst(d => ({ ...d, zone: 'search' })); setTimeout(focusAny, 80); };
  useEffect(() => {
    const go = () => { sfx.play('ok'); set(x => ({ ...x, game: null, menu: false, dir: x.tab > 2 ? -1 : 1, tab: 2, zone: 'tiles', fi: 0 })); focusSearch(); };
    addEventListener('cartucho:search', go);
    return () => removeEventListener('cartucho:search', go);
  }, []);

  const lib = data.lib;
  const shown = useRef(false);
  useEffect(() => {
    if (!game0 || shown.current) return;
    const i = lib.findIndex(g => g.key === game0 || g.catalog?.id === game0);
    if (i >= 0) { shown.current = true; up({ tab: 1, zone: 'tiles', fi: i }); openGame(lib[i]!); }
  }, [game0, lib.length]);
  const byPlay = useMemo(() => [...lib].sort((a, b) => (b.installed?.playMs ?? 0) - (a.installed?.playMs ?? 0)), [lib]);
  const all = useMemo(() => new Map([...data.lib, ...data.catalog].flatMap(x => [[x.key, x] as const, ...(x.installed && x.catalog ? [[x.catalog.id, x] as const] : [])])), [data.lib, data.catalog]);
  const found = useMemo(() => query.trim() ? [...data.catalog, ...data.lib.filter(x => !x.catalog)].filter(x => matchesQuery(query, x.title, x.platformName, x.catalog?.developer)) : data.catalog, [data.catalog, data.lib, query]);
  const tk = TABS[st.tab]![0];

  const achTot = lib.reduce((a, g) => a + (g.installed?.achievements?.total ?? 0), 0);
  const achGot = lib.reduce((a, g) => a + (g.installed?.achievements?.unlocked ?? 0), 0);
  const tiles = ((): Tile[] | null => {
    if (tk === 'home') {
      const [g0, g1] = lib, F = data.feed;
      return [
        g1 ? { x: 0, y: 0, w: 300, h: 230, g: g1, cap: g1.title, sub: g1.installed?.playMs ? fmtPlay(g1.installed.playMs) : 'ainda não jogado' }
          : { x: 0, y: 0, w: 300, h: 230, cls: 'grey', cap: 'descobrir recomps', sub: plural(data.catalog.length, 'jogo', 'jogos'), go: 'cat' },
        { x: 0, y: 240, w: 300, h: 230, cls: 'acc', quick: lib.slice(0, 3), cap: 'meus jogos', sub: plural(lib.length, 'instalado', 'instalados'), go: 'games' },
        g0 ? { x: 310, y: 0, w: 630, h: 470, g: g0, big: true, cap: g0.title, sub: g0.installed?.missing ? 'pasta do jogo não encontrada' : g0.installed?.playMs ? `${fmtPlay(g0.installed.playMs)} jogadas · continuar de onde parou` : 'ainda não jogado' }
          : { x: 310, y: 0, w: 630, h: 470, cls: 'grey', big: true, cap: data.catalog.length ? 'nada instalado ainda' : 'nenhum recomp ainda', sub: data.catalog.length ? 'abra descobrir para instalar' : 'o radar avisa quando aparecer', go: 'cat' },
        { x: 950, y: 0, w: 300, h: 230, cls: 'grey', txt: <><b>{F.length}</b>{F[0] ? `${F[0].title} · ${FEED[F[0].kind]}` : 'nada novo por aqui'}</>, cap: 'novidades', go: 'news' },
        { x: 950, y: 240, w: 300, h: 230, cls: 'dark', txt: <><b>{achGot}/{achTot}</b>conquistas neste console</>, bar: achTot ? achGot / achTot : 0, cap: 'conquistas', go: 'ach' },
      ];
    }
    if (tk === 'games' || tk === 'cat') {
      const L = tk === 'games' ? lib : found, pg = Math.floor(st.fi / PER);
      return L.slice(pg * PER, pg * PER + PER).map((g, j) => ({
        x: (j % 5) * 254, y: Math.floor(j / 5) * 240, w: 244, h: 230, g, idx: pg * PER + j, cap: g.title,
        sub: tk === 'cat' ? `${g.status ? STATUS_LABEL[g.status].toLowerCase() : ''}${g.installed ? ' · instalado' : ''}` : g.installed?.missing ? 'pasta não encontrada' : g.installed?.playMs ? fmtPlay(g.installed.playMs) : 'ainda não jogado',
        tag: g.update?.updateAvailable && !self ? 'versão nova' : g.isNew ? 'novo' : undefined, tagCls: g.isNew ? 'new' : '',
        cls: tk === 'cat' && !g.installed ? 'off' : g.installed?.missing ? 'off' : '',
      }));
    }
    if (tk === 'news') {
      const pg = Math.floor(st.fi / 6);
      return data.feed.slice(pg * 6, pg * 6 + 6).map((f, j) => {
        const g = data.catalog.find(y => y.catalog?.id === f.gameId);
        return { x: (j % 3) * 420, y: Math.floor(j / 3) * 240, w: 410, h: 230, g, feed: f, idx: pg * 6 + j, cap: f.title, sub: `${f.detail && !(self && f.kind === 'new') ? f.detail + ' · ' : ''}${ago(f.at)}`, tag: FEED[f.kind], tagCls: f.kind === 'new' ? 'new' : '' };
      });
    }
    return null;
  })();
  const total = tk === 'games' ? lib.length : tk === 'cat' ? found.length : tk === 'news' ? data.feed.length : tiles?.length ?? 0;
  const per = tk === 'news' ? 6 : PER;
  const paged = tk === 'games' || tk === 'cat' || tk === 'news';
  const loc = paged ? st.fi % per : st.fi;
  const cur = tiles ? tiles[loc] ?? null : null;

  const rows: Row[] = tk === 'ach' ? lib.map(g => ({ key: g.key, g, l: g.title, v: g.installed?.achievements?.total ? `${g.installed.achievements.unlocked}/${g.installed.achievements.total}` : '—' }))
    : tk === 'time' ? [{ key: 'sum', l: 'Resumo', ic: 'chart', v: fmtPlay(data.playMs) || '0m' }, ...byPlay.map(g => ({ key: g.key, g, l: g.title, v: fmtPlay(g.installed?.playMs ?? 0) || '0m' }))]
    : tk === 'cfg' ? CFG.map(r => ({ ...r, v: r.id === 'snd' ? (s.snd ? 'ligados' : 'desligados') : '' }))
    : [];
  const row = rows[st.li];
  const ach = useQuery(trpc.achievements.forGame.queryOptions({ id: row?.g?.installed?.id ?? '' }, { enabled: tk === 'ach' && !!row?.g?.installed?.adapter }));
  const statQ = useQueries({ queries: (tk === 'time' ? byPlay : []).map(x => trpc.play.stats.queryOptions({ id: x.installed!.id })) });
  const stats = new Map(byPlay.map((x, i) => [x.key, statQ[i]?.data] as const));

  const game = st.game ? all.get(st.game) ?? null : null;

  const options = (x: HubGame): Opt[] => {
    const inst = x.installed;
    const L: Opt[] = [];
    if (inst?.missing) {
      if (x.catalog?.repo && !self) L.push({ k: 'reinstall', l: 'Instalar de novo', ic: 'dl' });
      L.push({ k: 'relink', l: 'Procurar a pasta', ic: 'folder' });
      L.push({ k: 'remove', l: 'Tirar da biblioteca', ic: 'stop' });
    } else if (inst) {
      L.push(inst.running ? { k: 'quit', l: 'Fechar o jogo', ic: 'stop' } : inst.exe ? { k: 'play', l: 'Jogar', ic: 'play' } : { k: 'exe', l: 'Escolher o .exe', ic: 'folder' });
      if (x.update?.updateAvailable && !self) L.push({ k: 'update', l: `Atualizar para ${x.update.latest?.tag}`, ic: 'dl' });
      if (inst.adapter) L.push({ k: 'ach', l: 'Conquistas', ic: 'medal' });
      L.push({ k: 'time', l: 'Tempo de jogo', ic: 'clock' });
      L.push({ k: 'folder', l: 'Abrir pasta', ic: 'folder' });
      if (inst.exe) L.push({ k: 'exe', l: 'Escolher o .exe', ic: 'folder' });
    } else {
      if (x.repo && !self) L.push({ k: 'install', l: 'Instalar', ic: 'dl' });
      L.push({ k: 'add', l: self ? 'Já instalei: adicionar pasta' : 'Escolher pasta', ic: 'folder' });
    }
    if (x.repo) L.push({ k: 'gh', l: 'Ver no GitHub', ic: 'link' });
    if (!st.game) L.push({ k: 'info', l: 'Página do jogo', ic: 'info' });
    return L;
  };
  const primaryOf = (x: HubGame) => options(x)[0]!;
  const gameOpts = game ? options(game) : [];
  const goTab = (i: number, extra: Partial<St> = {}) => {
    const n = (i + TABS.length) % TABS.length;
    const k = TABS[n]![0];
    set(x => ({ ...x, tab: n, dir: n > x.tab ? 1 : -1, fi: k === 'home' ? 2 : 0, li: 0, menu: false, zone: x.zone === 'tabs' && !extra.zone ? 'tabs' : k === 'ach' || k === 'time' || k === 'cfg' ? 'list' : 'tiles', ...extra }));
  };
  const openGame = (x: HubGame) => { up({ game: x.key, menu: false, zone: 'gacts', ai: 0, gs: 0 }); };

  const run = (k: string, x: HubGame) => {
    up({ menu: false });
    if (k === 'play' || k === 'quit' || k === 'install') {
      const r = act.primary(x);
      sfx.play(r === 'quit' ? 'back' : 'ok');
      if (r === 'play') show(`${x.title} aberto · o tempo de jogo começou a contar`);
      else if (r === 'install') show(`Baixando ${x.repo} do GitHub…`);
      else if (r === 'quit') show(`Fechando ${x.title}…`);
      else if (r === 'pick') chooseExe.mutate({ id: x.installed!.id });
      else if (r === 'relink') show('Escolha onde o jogo está agora');
      return;
    }
    sfx.play('ok');
    if (k === 'add') { act.addFolder(x); return show('Escolha a pasta onde o jogo está instalado'); }
    if (k === 'reinstall') { act.reinstall(x); return show(`Baixando ${x.repo} de novo… o tempo de jogo continua`); }
    if (k === 'relink') { act.relink(x); return show('Escolha onde o jogo está agora'); }
    if (k === 'remove') { act.remove(x); up({ game: null }); return show(`${x.title} saiu da biblioteca · nenhum arquivo foi apagado`); }
    if (k === 'update') { act.update(x); return show(`Atualizando para ${x.update?.latest?.tag}… configurações e saves ficam`); }
    if (k === 'ach') { up({ game: null }); return goTab(4, { zone: 'list', li: Math.max(0, lib.indexOf(x)) }); }
    if (k === 'time') { up({ game: null }); return goTab(5, { zone: 'list', li: Math.max(0, byPlay.indexOf(x) + 1) }); }
    if (k === 'folder') return openFolder.mutate({ id: x.installed!.id });
    if (k === 'exe') return chooseExe.mutate({ id: x.installed!.id });
    if (k === 'gh') return act.github(x);
    if (k === 'info') return openGame(x);
  };

  const enter = () => {
    if (st.menu && cur?.g) { const o = options(cur.g)[st.mi]; if (o) run(o.k, cur.g); return; }
    if (st.zone === 'tabs') { sfx.play('ok'); return up({ zone: tiles ? 'tiles' : 'list' }); }
    if (tiles) {
      if (!cur) return;
      if (cur.go) { sfx.play('ok'); return goTab(TABS.findIndex(t => t[0] === cur.go), { zone: cur.go === 'ach' ? 'list' : 'tiles' }); }
      if (cur.feed) { if (cur.g) { sfx.play('ok'); openGame(cur.g); } return; }
      if (cur.g) { if (tk === 'cat') { sfx.play('ok'); return openGame(cur.g); } return run(primaryOf(cur.g).k, cur.g); }
      return;
    }
    if (tk === 'cfg' && row) {
      sfx.play('ok');
      if (row.id === 'dir') return pickDir.mutate();
      if (row.id === 'snd') return setSettings({ snd: !getSettings().snd });
      if (row.id === 'off') return onBack();
      return show('O radar confere o catálogo do Recompendium toda vez que o Cartucho abre');
    }
    if (tk === 'time' && row?.g) { sfx.play('ok'); return openGame(row.g); }
    if (tk === 'ach' && row?.g) { sfx.play('ok'); return openGame(row.g); }
  };
  const back = () => {
    sfx.play('back');
    if (game) return up({ game: null });
    if (st.menu) return up({ menu: false });
    if (tk === 'cat' && query) return setQuery('');
    if (st.tab !== 0) return set(x => ({ ...x, tab: 0, fi: 2, zone: 'tiles', dir: -1 }));
    onBack();
  };

  useKeys((k: Key) => {
    if ((tk === 'cat' && !game && !st.menu) || game) return;
    if (k === 'Escape') return back();
    const R = k === 'ArrowRight', L = k === 'ArrowLeft', U = k === 'ArrowUp', D = k === 'ArrowDown';
    const mv = (p: Partial<St>) => { sfx.play('move'); up(p); };
    if (k === 'Enter') return enter();
    if (st.menu && cur?.g) {
      const n = options(cur.g).length;
      if (D && st.mi < n - 1) mv({ mi: st.mi + 1 }); else if (U && st.mi > 0) mv({ mi: st.mi - 1 });
      return;
    }
    if (k === 'LB' || k === 'RB' || k === 'Tab') { sfx.play('move'); return goTab(st.tab + (k === 'LB' ? -1 : 1)); }
    if (k === 'Y') { sfx.play('ok'); if (tk !== 'cat') goTab(2, { zone: 'tiles' }); focusSearch(); return; }
    if (k === 'X') { if (cur?.g) { sfx.play('ok'); up({ menu: true, mi: 0 }); } return; }
    if (st.zone === 'tabs') {
      if (L) { sfx.play('move'); goTab(st.tab - 1); } else if (R) { sfx.play('move'); goTab(st.tab + 1); }
      else if (D) mv({ zone: tiles ? 'tiles' : 'list' });
      return;
    }
    if (st.zone === 'list') {
      if (D && st.li < rows.length - 1) mv({ li: st.li + 1 });
      else if (U) { if (st.li > 0) mv({ li: st.li - 1 }); else mv({ zone: 'tabs' }); }
      else if (L) { sfx.play('move'); goTab(st.tab - 1, { zone: 'list' }); } else if (R) { sfx.play('move'); goTab(st.tab + 1, { zone: 'list' }); }
      return;
    }
    if (!tiles || !tiles.length) {
      if (U) mv({ zone: 'tabs' }); else if (L) { sfx.play('move'); goTab(st.tab - 1, { zone: 'tiles' }); } else if (R) { sfx.play('move'); goTab(st.tab + 1, { zone: 'tiles' }); }
      else if (D && tk === 'cat') focusSearch();
      return;
    }
    const base = paged ? Math.floor(st.fi / per) * per : 0;
    const nx = nearest(tiles, loc, k);
    if (nx >= 0) return mv({ fi: base + nx });
    if (paged && R && total > base + per) return mv({ fi: base + per });
    if (paged && L && base > 0) return mv({ fi: base - per + (per === PER ? 4 : 2) });
    if (D && tk === 'cat') { sfx.play('ok'); return focusSearch(); }
    if (U) return mv({ zone: 'tabs' });
    if (R) { sfx.play('move'); return goTab(st.tab + 1, { zone: 'tiles' }); }
    if (L) { sfx.play('move'); return goTab(st.tab - 1, { zone: 'tiles' }); }
  });

  const hints: Hint[] = st.menu ? [['ok', 'Selecionar'], ['back', 'Fechar']]
    : !tiles ? [['ok', 'Selecionar'], ['back', 'Voltar'], ['rb', 'Abas']]
    : cur?.g ? [['ok', tk === 'cat' || cur.feed ? 'Ver jogo' : primaryOf(cur.g).l], ['x', 'Opções'], ['y', 'Buscar'], ['back', st.tab ? 'Voltar' : 'Sair']]
    : [['ok', 'Selecionar'], ['y', 'Buscar'], ['back', st.tab ? 'Voltar' : 'Sair']];
  const tabsRef = useRef<HTMLElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => { const el = tabsRef.current?.children[st.tab] as HTMLElement | undefined; if (el) setShift(el.offsetLeft); }, [st.tab, !!game, data.feed.length]);
  const artG = game ?? cur?.g ?? row?.g ?? null;
  const pages = paged ? Math.max(1, Math.ceil(total / per)) : 0;

  return (
    <section className="view hub sk-x3" style={{ ['--cc' as string]: c.color }}>
      <Fit w={1920} h={1080} className={`x3 ${og ? 'og' : ''}`} style={{ ['--cc' as string]: c.color }}>
        <Backdrop g={artG} />
        <div className="x3-floor" />
        {game ? (
          <GameView theme={`d-x3 ${og ? 'og' : ''}`} g={game} self={self} run={run} onBack={() => up({ game: null })}
            opts={gameOpts.map(o => ({ k: o.k, l: o.l, icon: <Ic n={o.ic} /> }))} />
        ) : tk === 'cat' ? (
          <Discover theme={`d-x3 ${og ? 'og' : ''}`} cname={c.name} games={data.catalog} extra={data.lib.filter(x => !x.catalog)} self={self} st={dst} set={setDst}
            options={x => options(x).filter(o => o.k !== 'info').map(o => ({ k: o.k, l: o.l, icon: <Ic n={o.ic} /> }))}
            run={run} onOpen={openGame} onBack={() => { sfx.play('back'); set(x => ({ ...x, tab: 0, fi: 2, zone: 'tiles', dir: -1 })); }} />
        ) : (
          <>
            <div className="x3-me"><span>Cartucho<small>{fmtPlay(data.playMs) || '0m'} · {clock}</small></span><i><Ic n="pad" /></i></div>
            <nav className="x3-tabs" ref={tabsRef} style={{ transform: `translateX(-${shift}px)` }}>{TABS.map(([k, l], j) => (
              <button key={k} className={j === st.tab ? `on ${st.zone === 'tabs' ? 'f' : ''}` : ''} onClick={() => { sfx.play('move'); goTab(j, { zone: k === 'ach' || k === 'time' || k === 'cfg' ? 'list' : 'tiles' }); }}>
                {l}{k === 'news' && data.feed.length > 0 && <span className="n">{data.feed.length}</span>}
              </button>
            ))}</nav>
            {tiles ? (
              <>
                <div className={`x3-pg ${st.dir < 0 ? 'back' : ''}`} key={`${tk}-${Math.floor(st.fi / per)}`}>
                  {tiles.length ? tiles.map((t, j) => (
                    <button key={`${t.cap}-${j}`} className={`xt ${t.cls ?? ''} ${st.zone === 'tiles' && j === loc ? 'on' : ''}`} style={{ left: t.x, top: t.y, width: t.w, height: t.h }}
                      onClick={() => { if (st.zone === 'tiles' && j === loc) enter(); else mv2(j); }}>
                      {t.g && <Art g={t.g} v={t.big || t.w > 300 ? 'wide' : 'square'} />}
                      {t.quick && <div className="mini">{t.quick.map(q => <span key={q.key}><Art g={q} v="square" /></span>)}</div>}
                      {t.txt && <div className="txt">{t.txt}</div>}
                      {t.bar != null && <div className="bar"><i style={{ width: `${t.bar * 100}%` }} /></div>}
                      {t.g?.installed?.running && <span className="run"><Ic n="play" /></span>}
                      {t.tag && <span className={`tg ${t.tagCls ?? ''}`}>{t.tag}</span>}
                      <div className={`cap ${t.big ? 'big' : ''}`}>{t.cap}{t.sub && <small>{t.sub}</small>}</div>
                    </button>
                  )) : (
                    <div className="xt grey empty" style={{ left: 0, top: 0, width: 630, height: 230 }}>
                      <div className="cap">{tk === 'games' ? 'nenhum jogo instalado' : 'nada por aqui ainda'}</div>
                    </div>
                  )}
                </div>
                <div className="x3-peek"><div>{TABS[(st.tab + 1) % TABS.length]![1]}</div><div /><div /></div>
                {pages > 1 && <div className="x3-pages">{Math.floor(st.fi / per) + 1} / {pages}</div>}
              </>
            ) : (
              <div className={`x3-lw ${st.dir < 0 ? 'back' : ''}`} key={tk}>
                <div className="x3-lst">
                  <div style={{ transform: `translateY(-${Math.max(0, st.li - (LIST_ROWS - 2)) * 74}px)` }}>
                    {rows.length ? rows.map((r, j) => (
                      <button key={r.key} className={st.zone === 'list' && j === st.li ? 'on' : ''} onClick={() => { if (st.zone === 'list' && st.li === j) enter(); else { sfx.play('move'); up({ zone: 'list', li: j }); } }}>
                        {r.g ? <span className="th"><Art g={r.g} v="square" /></span> : r.ic ? <Ic n={r.ic} /> : null}
                        <span className="l">{r.l}</span><span className="v">{r.v}</span>
                      </button>
                    )) : <div className="x3-none">nenhum jogo instalado neste console</div>}
                  </div>
                </div>
                <div className="x3-det">
                  <Detail tk={tk} row={row} achList={ach.data?.list ?? []} achLoading={ach.isLoading} stats={row?.g ? stats.get(row.g.key) : undefined}
                    lib={byPlay} statsAll={stats} playMs={data.playMs} cname={c.name} sndOn={s.snd} />
                </div>
              </div>
            )}
            <div className={`x3-dots ${tiles ? '' : 'low'}`}>{TABS.map((_, j) => <i key={j} className={j === st.tab ? 'on' : ''} />)}</div>
          </>
        )}
        {st.menu && cur?.g && !game && (
          <div className="x3-menu" onClick={() => up({ menu: false })}>
            <div className="w" onClick={e => e.stopPropagation()}>
              <div className="x3-lst">{options(cur.g).map((o, j) => (
                <button key={o.k + j} className={j === st.mi ? 'on' : ''} onClick={() => { if (st.mi === j) enter(); else { sfx.play('move'); up({ mi: j }); } }}><Ic n={o.ic} /><span className="l">{o.l}</span></button>
              ))}</div>
              <div className="x3-det"><MenuInfo g={cur.g} self={self} /></div>
            </div>
          </div>
        )}
        {tk !== 'cat' && !game && <div className="x3-ft">{hints.map(([a, t]) => <span key={a + t}><Glyph a={a} />{t}</span>)}</div>}
        {toast}
      </Fit>
      <BootOverlay kind={og ? 'soft' : 'sweep'} label={c.name.toUpperCase()} />
    </section>
  );

  function mv2(j: number) { sfx.play('move'); up({ zone: 'tiles', fi: (paged ? Math.floor(st.fi / per) * per : 0) + j }); }
}

function Backdrop({ g }: { g: HubGame | null }) {
  const art = useArt(g?.console, g?.title ?? '', g?.platformName);
  const src = g ? art.fanart ?? art.cover ?? g.coverUrl : null;
  return <div className="x3-bg">{src ? <img key={src} src={src} alt="" /> : <div className="glow" />}</div>;
}

function MenuInfo({ g, self }: { g: HubGame; self: boolean }) {
  const needs = useTranslated(g.catalog?.needs);
  const i = g.installed;
  return (
    <>
      <h3>{g.title}</h3>
      <div className="r"><span>status</span><span>{g.status ? STATUS_LABEL[g.status] : '—'}</span></div>
      {g.catalog?.developer && <div className="r"><span>estúdio</span><span>{g.catalog.developer}</span></div>}
      <div className="r"><span>tempo</span><span>{i ? fmtPlay(i.playMs) || '0m' : 'não instalado'}</span></div>
      {!i && needs.text && <p className="sm">Precisa: {needs.text}</p>}
      {self && !i && <p className="sm">{SELF_INSTALL_NOTE}</p>}
    </>
  );
}

function Detail({ tk, row, achList, achLoading, stats, lib, statsAll, playMs, cname, sndOn }: {
  tk: Tab; row: Row | undefined; achList: { id: number; name: string; unlockedAt: number | null; points: number | null }[]; achLoading: boolean;
  stats: PlayStats | undefined; lib: HubGame[]; statsAll: Map<string, PlayStats | undefined>; playMs: number; cname: string; sndOn: boolean;
}) {
  if (!row) return <><h3>nada por aqui</h3><p className="sm">Sem itens nesta lista ainda.</p></>;
  if (tk === 'ach' && row.g) {
    const a = row.g.installed?.achievements;
    if (!row.g.installed?.adapter) return <><h3>{row.g.title}</h3><p className="sm">O Cartucho ainda não sabe ler as conquistas deste port. Quando houver um leitor, elas aparecem aqui sozinhas.</p></>;
    const L = [...achList].sort((x, y) => (y.unlockedAt ?? -1) - (x.unlockedAt ?? -1));
    return (
      <>
        <h3>{row.g.title}</h3>
        <div className="big">{a?.unlocked ?? 0}/{a?.total ?? L.length}</div>
        {achLoading && !L.length ? <p className="sm">lendo…</p> : L.slice(0, 6).map(x => (
          <div key={x.id} className={`r ${x.unlockedAt != null ? '' : 'lock'}`}><span><Ic n={x.unlockedAt != null ? 'medal' : 'lock'} /> {x.name}</span><span>{x.unlockedAt != null ? fmtDate(x.unlockedAt) : 'bloqueada'}</span></div>
        ))}
        {L.length > 6 && <p className="sm">e mais {L.length - 6}… Enter abre a página do jogo</p>}
      </>
    );
  }
  if (tk === 'time') {
    if (!row.g) {
      const ses = lib.reduce((a, g) => a + (statsAll.get(g.key)?.sessions ?? 0), 0);
      const week = lib.reduce((a, g) => a + (statsAll.get(g.key)?.days.slice(7).reduce((p, q) => p + q, 0) ?? 0), 0) * 3600_000;
      return <><h3>neste console</h3><div className="big">{fmtPlay(playMs) || '0m'}</div><p className="sm">{plural(ses, 'sessão', 'sessões')} em {plural(lib.length, 'jogo', 'jogos')}<br />{fmtPlay(week) || '0m'} nesta semana</p></>;
    }
    const i = row.g.installed!, d = stats?.days ?? Array(14).fill(0), m = Math.max(...d, 0.01);
    return (
      <>
        <h3>{row.g.title}</h3>
        <div className="big">{fmtPlay(i.playMs) || '0m'}</div>
        <p className="sm">{plural(stats?.sessions ?? 0, 'sessão', 'sessões')}{stats?.sessions ? ` · média ${fmtPlay(i.playMs / stats.sessions) || '<1m'}` : ''}{i.lastPlayed ? ` · ${ago(i.lastPlayed)}` : ''}</p>
        <div className="bars">{d.map((v, j) => <i key={j} className={v ? '' : 'z'} style={{ height: `${v ? Math.max(3, (v / m) * 100) : 2}%` }} />)}</div>
        <p className="sm">últimos 14 dias</p>
      </>
    );
  }
  if (tk === 'cfg') {
    if (row.id === 'dir') return <><h3>{row.l}</h3><p className="sm">Onde o Cartucho instala o que você baixa. Jogos adicionados com “Escolher pasta” continuam onde estão.</p><div className="path"><PortsDir /></div></>;
    if (row.id === 'snd') return <><h3>{row.l}</h3><p className="sm">Sons de navegação da interface: {sndOn ? 'ligados' : 'desligados'}. Enter alterna.</p></>;
    if (row.id === 'radar') return <><h3>{row.l}</h3><p className="sm">O radar confere o catálogo do Recompendium e os releases do GitHub toda vez que o Cartucho abre, e avisa quando algo muda em {cname}.</p></>;
    return <><h3>{row.l}</h3><p className="sm">Desliga este console e volta para o palco do Cartucho.</p></>;
  }
  return null;
}

function PortsDir() {
  const trpc = useTRPC();
  const q = useQuery(trpc.settings.portsDir.queryOptions());
  return <>{q.data ?? '…'}</>;
}
