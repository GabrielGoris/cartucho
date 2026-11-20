import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AchievementView, ConsoleId, PlayStats } from '@shared/types';
import { isSelfInstall, SELF_INSTALL_NOTE, STATUS_LABEL } from '@shared/consoles';
import { useTRPC } from '../trpc';
import { Glyph, useKeys, type Key } from '../lib/input';
import { getSettings, reduceMotion, setSettings, useSettings } from '../lib/settings';
import { setSfxProfile, sfx } from '../lib/sfx';
import { ago, fmtDate, fmtPlay, hueOf, plural } from '../lib/format';
import { matchesQuery } from '../lib/search';
import { useShots } from '../lib/art';
import { useTranslated } from '../lib/translate';
import { SearchBox } from '../components/SearchBox';
import { CONSOLES } from '../stage/consoles';
import { BootOverlay, Fit, useClock, useHubToast } from './HubFrame';
import { useGameProgress, useHubActions, useHubData, type HubGame } from './data';
import { createShelf, type ShelfCfg } from './retro/shelf';

type Tab = 'games' | 'news' | 'ach' | 'time' | 'cfg';
type Zone = 'gacts' | 'gshots' | 'gtext';
interface Cfg extends Omit<ShelfCfg, 'aspect'> { res: [number, number]; sfx: string; boot: 'retro' | 'soft' | 'white'; dual?: boolean }
interface St { tab: number; idx: number; li: number; opt: boolean; oi: number; search: boolean; game: string | null; zone: Zone; ai: number; gs: number; achOpen: boolean; ai2: number }
type Opt = { k: string; l: string };
type Hint = [Parameters<typeof Glyph>[0]['a'], string];
interface Row { key: string; g?: HubGame; t: string; v?: string; s?: string; id?: string; bar?: number }

export const RETRO: Record<string, Cfg> = {
  snes: { res: [512, 448], low: [256, 224], smooth: false, item: 'cart16', layout: 'row', bg: 0x2a1868, env: 'mode7', texRes: 64, sfx: 'square', boot: 'retro' },
  n64: { res: [640, 480], low: [320, 240], smooth: true, item: 'cart64', layout: 'ring', bg: 0x0b2238, env: 'n64', texRes: 64, sfx: 'tri', boot: 'retro' },
  ps1: { res: [640, 480], low: [320, 240], smooth: false, item: 'cd', layout: 'grid', bg: 0x000000, env: 'stars', texRes: 64, sfx: 'deep', boot: 'soft' },
  gc: { res: [640, 480], low: [640, 480], smooth: true, item: 'mini', layout: 'ring', bg: 0x170f3a, env: 'bubbles', texRes: 128, sfx: 'bubble', boot: 'retro' },
  ps2: { res: [640, 480], low: [640, 480], smooth: true, item: 'case', layout: 'shelf', bg: 0x01030f, env: 'dust', texRes: 128, sfx: 'deep', boot: 'soft' },
  nes: { res: [512, 480], low: [256, 240], smooth: false, item: 'cart8', layout: 'row', bg: 0x0c0c0c, env: 'bricks', texRes: 48, sfx: 'square', boot: 'retro' },
  megadrive: { res: [640, 448], low: [320, 224], smooth: false, item: 'cartmd', layout: 'row', bg: 0x02040c, env: 'lines', texRes: 64, sfx: 'square', boot: 'retro' },
  nds: { res: [512, 784], low: [256, 192], smooth: false, item: 'cartds', layout: 'row', bg: 0xdfe5ee, env: 'dsgrid', texRes: 64, sfx: 'click', boot: 'white', dual: true },
  gb: { res: [480, 432], low: [160, 144], smooth: false, item: 'cartgb', layout: 'row', bg: 0x0f380f, env: 'none', texRes: 48, palette: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'], sfx: 'square', boot: 'retro' },
};
const TABS: [Tab, string][] = [['games', 'JOGOS'], ['news', 'NOVIDADES'], ['ach', 'CONQUISTAS'], ['time', 'TEMPO'], ['cfg', 'AJUSTES']];
const FEED = { new: 'NOVO NO CATÁLOGO', upd: 'VERSÃO NOVA', up: 'MUDOU DE STATUS' } as const;
const CFG_ROWS: Row[] = [{ key: 'dir', id: 'dir', t: 'PASTA DOS JOGOS' }, { key: 'snd', id: 'snd', t: 'SONS' }, { key: 'radar', id: 'radar', t: 'RADAR DE NOVIDADES' }, { key: 'off', id: 'off', t: 'VOLTAR AO CARTUCHO' }];
const VISIBLE = 6;

export function RetroHub({ id, game: game0, tab, onBack }: { id: ConsoleId; game?: string; tab?: 'lib' | 'cat'; onBack: () => void }) {
  const c = CONSOLES.find(x => x.id === id)!;
  const cfg = RETRO[id] ?? RETRO.snes!;
  const self = isSelfInstall(id);
  const data = useHubData(id);
  const act = useHubActions();
  const trpc = useTRPC(), qc = useQueryClient();
  const s = useSettings();
  const [toast, show] = useHubToast();
  const [st, set] = useState<St>({ tab: 0, idx: 0, li: 0, opt: false, oi: 0, search: false, game: null, zone: 'gacts', ai: 0, gs: 0, achOpen: false, ai2: 0 });
  const up = (p: Partial<St>) => set(x => ({ ...x, ...p }));
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const shelfRef = useRef<ReturnType<typeof createShelf> | null>(null);
  const gScroll = useRef<HTMLDivElement>(null);
  const clock = useClock();
  const pickDir = useMutation(trpc.settings.pickPortsDir.mutationOptions({ onSuccess: d => { qc.setQueryData(trpc.settings.portsDir.queryKey(), d); show('PASTA DOS JOGOS ALTERADA'); } }));
  const chooseExe = useMutation(trpc.games.chooseExe.mutationOptions({ onSuccess: () => void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }) }));
  const openFolder = useMutation(trpc.games.openFolder.mutationOptions());

  useEffect(() => { setSfxProfile(cfg.sfx); const t = setTimeout(() => sfx.play('boot'), 150); return () => clearTimeout(t); }, [cfg.sfx]);
  useEffect(() => { if (act.error) { show(act.error); act.reset(); } }, [act.error]);
  const focusSearch = () => setTimeout(() => searchRef.current?.focus(), 60);
  useEffect(() => {
    const go = () => { sfx.play('ok'); set(x => ({ ...x, tab: 0, search: true, game: null, opt: false, achOpen: false })); focusSearch(); };
    addEventListener('cartucho:search', go);
    return () => removeEventListener('cartucho:search', go);
  }, []);

  const allGames = useMemo(() => [...data.lib, ...[...data.notInstalled].sort((a, b) => Number(b.isNew) - Number(a.isNew))], [data.lib, data.notInstalled]);
  const list = useMemo(() => query.trim() ? allGames.filter(x => matchesQuery(query, x.title, x.platformName, x.catalog?.developer)) : allGames, [allGames, query]);
  const lookup = useMemo(() => new Map([...data.lib, ...data.catalog].flatMap(x => [[x.key, x] as const, ...(x.installed && x.catalog ? [[x.catalog.id, x] as const] : [])])), [data.lib, data.catalog]);
  useEffect(() => {
    if (!game0) return;
    const i = allGames.findIndex(g => g.key === game0 || g.catalog?.id === game0);
    if (i >= 0) up({ idx: i });
  }, [game0, allGames.length]);
  useEffect(() => { if (st.idx >= list.length && list.length) up({ idx: list.length - 1 }); }, [list.length]);
  const g = list[st.idx] ?? null;
  const tk = TABS[st.tab]![0];

  const arts = useQueries({ queries: list.map(x => ({ ...trpc.art.get.queryOptions({ console: x.console, platformName: x.platformName, title: x.title }), staleTime: Infinity })) });
  const covers = arts.map(a => a.data?.cover ?? null);
  useEffect(() => {
    const cv = cvRef.current; if (!cv) return;
    const sh = createShelf(cv, { ...cfg, aspect: cfg.dual ? 4 / 3 : cfg.res[0] / cfg.res[1] }, reduceMotion());
    shelfRef.current = sh;
    return () => { sh.dispose(); shelfRef.current = null; };
  }, [id]);
  const coverKey = covers.join('|');
  useEffect(() => {
    shelfRef.current?.setGames(list.map((x, i) => ({ key: x.key, title: x.title, ghost: !x.installed, hue: hueOf(x.title), cover: covers[i] ?? x.coverUrl ?? null })));
  }, [list, coverKey]);
  useEffect(() => { shelfRef.current?.setSel(st.idx); }, [st.idx]);

  const byPlay = useMemo(() => [...data.lib].sort((a, b) => (b.installed?.playMs ?? 0) - (a.installed?.playMs ?? 0)), [data.lib]);
  const maxPlay = Math.max(1, ...byPlay.map(x => x.installed?.playMs ?? 0));
  const rows: Row[] = tk === 'news' ? data.feed.map(f => ({ key: String(f.id), g: data.catalog.find(y => y.catalog?.id === f.gameId), t: f.title, s: `${FEED[f.kind]}${f.detail && !(self && f.kind === 'new') ? ` · ${f.detail}` : ''}`, v: ago(f.at).toUpperCase() }))
    : tk === 'ach' ? data.lib.map(x => ({ key: x.key, g: x, t: x.title, v: x.installed?.achievements?.total ? `${x.installed.achievements.unlocked}/${x.installed.achievements.total}` : '—' }))
    : tk === 'time' ? byPlay.map(x => ({ key: x.key, g: x, t: x.title, v: fmtPlay(x.installed?.playMs ?? 0) || '0m', bar: (x.installed?.playMs ?? 0) / maxPlay }))
    : tk === 'cfg' ? CFG_ROWS.map(r => ({ ...r, v: r.id === 'snd' ? (s.snd ? 'LIGADOS' : 'DESLIGADOS') : '' }))
    : [];
  const row = rows[st.li];
  const achGame = tk === 'ach' ? row?.g ?? null : null;
  const ach = useQuery(trpc.achievements.forGame.queryOptions({ id: achGame?.installed?.id ?? '' }, { enabled: !!achGame?.installed?.adapter }));
  const achList = ach.data ? [...ach.data.list].sort((a, b) => (b.unlockedAt ?? -1) - (a.unlockedAt ?? -1)) : [];
  const stats = useQuery(trpc.play.stats.queryOptions({ id: g?.installed?.id ?? '' }, { enabled: tk === 'games' && !!g?.installed }));
  const statsAll = useQueries({ queries: (tk === 'time' ? byPlay : []).map(x => trpc.play.stats.queryOptions({ id: x.installed!.id })) });

  const game = st.game ? lookup.get(st.game) ?? null : null;
  const shots = useShots(game?.console, game?.title ?? '', game?.platformName);
  const [view, setView] = useState<number | null>(null);
  useEffect(() => {
    const el = gScroll.current; if (!el || !game) return;
    if (st.zone === 'gacts') el.scrollTo({ top: 0, behavior: 'smooth' });
    else if (st.zone === 'gshots') el.querySelector('.rt-gshots')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    else el.querySelector('.rt-gtext')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [st.zone, !!game]);

  const options = (x: HubGame, page = false): Opt[] => {
    const inst = x.installed;
    const L: Opt[] = [];
    if (inst?.missing) {
      if (x.catalog?.repo && !self) L.push({ k: 'reinstall', l: 'INSTALAR DE NOVO' });
      L.push({ k: 'relink', l: 'PROCURAR A PASTA' });
      L.push({ k: 'remove', l: 'TIRAR DA BIBLIOTECA' });
    } else if (inst) {
      L.push(inst.running ? { k: 'quit', l: 'FECHAR O JOGO' } : inst.exe ? { k: 'play', l: 'JOGAR' } : { k: 'exe', l: 'ESCOLHER O .EXE' });
      if (x.update?.updateAvailable && !self) L.push({ k: 'update', l: `ATUALIZAR P/ ${x.update.latest?.tag}` });
      if (inst.adapter) L.push({ k: 'ach', l: 'CONQUISTAS' });
      L.push({ k: 'folder', l: 'ABRIR PASTA' });
      if (inst.exe) L.push({ k: 'exe', l: 'ESCOLHER O .EXE' });
    } else {
      if (x.repo && !self) L.push({ k: 'install', l: 'INSTALAR' });
      L.push({ k: 'add', l: self ? 'JÁ INSTALEI: ADICIONAR' : 'ESCOLHER PASTA' });
    }
    if (x.repo) L.push({ k: 'gh', l: 'VER NO GITHUB' });
    if (!page) L.push({ k: 'info', l: 'PÁGINA DO JOGO' });
    return L;
  };
  const gameOpts = game ? options(game, true) : [];
  const openGame = (x: HubGame) => { setView(null); up({ game: x.key, opt: false, zone: 'gacts', ai: 0, gs: 0 }); };

  const run = (k: string, x: HubGame) => {
    up({ opt: false });
    if (k === 'play' || k === 'quit' || k === 'install') {
      const r = act.primary(x);
      sfx.play(r === 'quit' ? 'back' : 'ok');
      if (r === 'play') show(`${x.title.toUpperCase()} ABERTO`);
      else if (r === 'install') show(`BAIXANDO ${x.repo}…`);
      else if (r === 'quit') show('FECHANDO…');
      else if (r === 'pick') chooseExe.mutate({ id: x.installed!.id });
      else if (r === 'relink') show('ESCOLHA ONDE O JOGO ESTÁ AGORA');
      return;
    }
    sfx.play('ok');
    if (k === 'add') { act.addFolder(x); return show('ESCOLHA A PASTA DO JOGO'); }
    if (k === 'reinstall') { act.reinstall(x); return show(`BAIXANDO ${x.repo} DE NOVO…`); }
    if (k === 'relink') { act.relink(x); return show('ESCOLHA ONDE O JOGO ESTÁ AGORA'); }
    if (k === 'remove') { act.remove(x); up({ game: null }); return show('JOGO TIRADO DA BIBLIOTECA · NENHUM ARQUIVO APAGADO'); }
    if (k === 'update') { act.update(x); return show(`ATUALIZANDO PARA ${x.update?.latest?.tag}…`); }
    if (k === 'ach') return up({ game: null, tab: 2, li: Math.max(0, data.lib.indexOf(x)), achOpen: true, ai2: 0 });
    if (k === 'folder') return openFolder.mutate({ id: x.installed!.id });
    if (k === 'exe') return chooseExe.mutate({ id: x.installed!.id });
    if (k === 'gh') return act.github(x);
    if (k === 'info') return openGame(x);
  };

  const enter = () => {
    if (game) {
      if (st.zone === 'gacts') { const o = gameOpts[st.ai]; if (o) run(o.k, game); return; }
      if (st.zone === 'gshots' && shots[st.gs]) { sfx.play('ok'); setView(st.gs); }
      return;
    }
    if (st.opt && g) { const o = options(g)[st.oi]; if (o) run(o.k, g); return; }
    if (tk === 'games') { if (g) run(options(g)[0]!.k, g); return; }
    if (!row) return;
    if (tk === 'cfg') {
      sfx.play('ok');
      if (row.id === 'dir') return pickDir.mutate();
      if (row.id === 'snd') return setSettings({ snd: !getSettings().snd });
      if (row.id === 'off') return onBack();
      return show('O RADAR CONFERE O CATÁLOGO TODA VEZ QUE O CARTUCHO ABRE');
    }
    if (tk === 'ach') { if (achList.length) { sfx.play('ok'); up({ achOpen: !st.achOpen, ai2: 0 }); } return; }
    if (row.g) { sfx.play('ok'); openGame(row.g); }
  };
  const back = () => {
    sfx.play('back');
    if (view != null) return setView(null);
    if (game) return up({ game: null });
    if (st.opt) return up({ opt: false });
    if (st.achOpen) return up({ achOpen: false });
    if (st.search || query) { setQuery(''); return up({ search: false }); }
    if (st.tab !== 0) return up({ tab: 0 });
    onBack();
  };
  const goTab = (d: number) => { sfx.play('move'); set(x => ({ ...x, tab: (x.tab + d + TABS.length) % TABS.length, li: 0, opt: false, achOpen: false, search: false })); };

  useKeys((k: Key) => {
    if (k === 'Escape') return back();
    const R = k === 'ArrowRight', L = k === 'ArrowLeft', U = k === 'ArrowUp', D = k === 'ArrowDown';
    const mv = (p: Partial<St>) => { sfx.play('move'); up(p); };
    if (view != null) {
      if (k === 'Enter') return back();
      if (R && view < shots.length - 1) { sfx.play('move'); setView(view + 1); } else if (L && view > 0) { sfx.play('move'); setView(view - 1); }
      return;
    }
    if (k === 'Enter') return enter();
    if (game) {
      const el = gScroll.current, z = st.zone;
      if (z === 'gacts') { if (R && st.ai < gameOpts.length - 1) mv({ ai: st.ai + 1 }); else if (L && st.ai > 0) mv({ ai: st.ai - 1 }); else if (D) mv({ zone: shots.length ? 'gshots' : 'gtext', gs: 0 }); return; }
      if (z === 'gshots') { if (R && st.gs < shots.length - 1) mv({ gs: st.gs + 1 }); else if (L && st.gs > 0) mv({ gs: st.gs - 1 }); else if (U) mv({ zone: 'gacts' }); else if (D) mv({ zone: 'gtext' }); return; }
      if (D) { sfx.play('move'); el?.scrollBy({ top: 120, behavior: 'smooth' }); }
      else if (U) { if (!el || el.scrollTop <= 4) mv({ zone: shots.length ? 'gshots' : 'gacts' }); else { sfx.play('move'); el.scrollBy({ top: -120, behavior: 'smooth' }); } }
      return;
    }
    if (st.opt && g) {
      const n = options(g).length;
      if (D && st.oi < n - 1) mv({ oi: st.oi + 1 }); else if (U && st.oi > 0) mv({ oi: st.oi - 1 });
      return;
    }
    if (k === 'LB' || k === 'RB' || k === 'Tab') return goTab(k === 'LB' ? -1 : 1);
    if (st.achOpen) { if (D && st.ai2 < achList.length - 1) mv({ ai2: st.ai2 + 1 }); else if (U && st.ai2 > 0) mv({ ai2: st.ai2 - 1 }); return; }
    if (tk === 'games') {
      if (k === 'X') { if (g) { sfx.play('ok'); up({ opt: true, oi: 0 }); } return; }
      if (k === 'Y') { sfx.play('ok'); up({ search: true }); return focusSearch(); }
      if (R && st.idx < list.length - 1) mv({ idx: st.idx + 1 }); else if (L && st.idx > 0) mv({ idx: st.idx - 1 });
      else if (U) goTab(-1); else if (D) goTab(1);
      return;
    }
    if (D && st.li < rows.length - 1) mv({ li: st.li + 1 }); else if (U && st.li > 0) mv({ li: st.li - 1 });
    else if (L) goTab(-1); else if (R) goTab(1);
  });

  const hints: Hint[] = view != null ? [['lr', 'IMAGEM'], ['back', 'FECHAR']]
    : game ? (st.zone === 'gacts' ? [['ok', 'OK'], ['ud', 'ROLAR'], ['back', 'VOLTAR']] : st.zone === 'gshots' ? [['ok', 'AMPLIAR'], ['back', 'VOLTAR']] : [['ud', 'ROLAR'], ['back', 'VOLTAR']])
    : st.opt ? [['ok', 'OK'], ['back', 'FECHAR']]
    : tk === 'games' ? (g ? [['ok', options(g)[0]!.l], ['x', 'OPÇÕES'], ['y', 'BUSCAR'], ['rb', 'SEÇÃO']] : [['y', 'BUSCAR'], ['rb', 'SEÇÃO'], ['back', 'SAIR']])
    : [['ok', tk === 'cfg' ? 'OK' : tk === 'ach' ? (st.achOpen ? 'FECHAR' : 'LISTA') : 'ABRIR'], ['rb', 'SEÇÃO'], ['back', 'VOLTAR']];
  const H = ({ cls }: { cls: string }) => <div className={cls}>{hints.map(([a, t]) => <span key={a + t}><Glyph a={a} />{t}</span>)}</div>;
  const off = Math.max(0, Math.min(st.li - 2, rows.length - VISIBLE));

  return (
    <section className={`view hub sk-rt t-${id}`} style={{ ['--cc' as string]: c.color }}>
      <Fit w={cfg.res[0]} h={cfg.res[1]} className={`rt ${cfg.smooth ? '' : 'px'}`} style={{ ['--cc' as string]: c.color }}>
        <canvas ref={cvRef} className="rt-cv" />
        <div className={`rt-ui ${game ? 'gone' : tk !== 'games' ? 'dim' : ''}`}>
          <div className="rt-head">
            <div className="rt-tabs"><span className="ar">◀</span><b>{TABS[st.tab]![1]}</b><span className="ar">▶</span>
              <span className="dots">{TABS.map((_, j) => <i key={j} className={j === st.tab ? 'on' : ''} />)}</span>
              {data.feed.length > 0 && st.tab !== 1 && <span className="nw">{data.feed.length} NOVO{data.feed.length > 1 ? 'S' : ''}</span>}
            </div>
            <span>{c.short} · {clock}</span>
          </div>

          {tk === 'games' && !game && (
            <>
              {list.length > 0 && <div className="rt-count">{st.idx + 1}/{list.length}</div>}
              {st.search && (
                <div className="rt-win rt-q">
                  <span>BUSCAR:</span>
                  <SearchBox ref={searchRef} value={query} onChange={v => { setQuery(v); up({ idx: 0 }); }} nav={false} className="rt-qi" placeholder="NOME DO JOGO"
                    onDone={() => { sfx.play('ok'); up({ search: !!query.trim() }); }} />
                </div>
              )}
              {g ? <Card g={g} stats={stats.data} self={self} hints={<H cls="rt-ga" />} />
                : <div className="rt-win rt-card"><div className="rt-gt">{query.trim() ? `NADA PARA “${query.trim().toUpperCase()}”` : data.catalog.length ? 'NADA AQUI' : 'NENHUM RECOMP AINDA'}</div>
                  <div className="rt-gs">{query.trim() ? 'ESC LIMPA A BUSCA' : `O RADAR AVISA QUANDO APARECER UM RECOMP DE ${c.name.toUpperCase()}`}</div><H cls="rt-ga" /></div>}
              {st.opt && g && (
                <div className="rt-win rt-opt">{options(g).map((o, j) => (
                  <button key={o.k + j} className={j === st.oi ? 'on' : ''} onClick={() => { if (st.oi === j) enter(); else { sfx.play('move'); up({ oi: j }); } }}>{j === st.oi ? '▶ ' : '  '}{o.l}</button>
                ))}</div>
              )}
            </>
          )}

          {tk !== 'games' && !game && (
            <div className="rt-win rt-list">
              {tk === 'time' && <div className="rt-sum">{fmtPlay(data.playMs) || '0m'} NESTE CONSOLE · {statsAll.reduce((a, q) => a + (q.data?.sessions ?? 0), 0)} SESSÕES</div>}
              {st.achOpen && achGame ? (
                <>
                  <div className="rt-sum">{achGame.title.toUpperCase()} · {achList.filter(a => a.unlockedAt != null).length}/{achList.length}</div>
                  <AchList list={achList} sel={st.ai2} />
                </>
              ) : rows.length ? (
                <div className="rt-rows">{rows.slice(off, off + VISIBLE).map((r, j) => (
                  <button key={r.key} className={`rt-r ${off + j === st.li ? 'on' : ''}`} onClick={() => { if (st.li === off + j) enter(); else { sfx.play('move'); up({ li: off + j }); } }}>
                    <span className="t">{off + j === st.li ? '▶ ' : ''}{r.t}</span>{r.v && <span className="v">{r.v}</span>}
                    {r.s && <span className="s">{r.s}</span>}
                    {r.bar != null && <span className="bar"><i style={{ width: `${r.bar * 100}%` }} /></span>}
                  </button>
                ))}</div>
              ) : <div className="rt-empty">{tk === 'news' ? 'NADA NOVO POR AQUI.' : 'NENHUM JOGO INSTALADO.'}</div>}
              {tk === 'cfg' && row && <div className="rt-note">{row.id === 'dir' ? <PortsDir /> : row.id === 'snd' ? 'SONS DE NAVEGAÇÃO DA INTERFACE.' : row.id === 'radar' ? 'CONFERE O CATÁLOGO TODA VEZ QUE O CARTUCHO ABRE.' : 'DESLIGA ESTE CONSOLE.'}</div>}
              {tk === 'ach' && !st.achOpen && achGame && !achGame.installed?.adapter && <div className="rt-note">O CARTUCHO AINDA NÃO LÊ AS CONQUISTAS DESTE PORT.</div>}
              <H cls="rt-ga" />
            </div>
          )}
        </div>

        {game && <GamePage g={game} st={st} opts={gameOpts} shots={shots} self={self} scrollRef={gScroll} hints={<H cls="rt-ga" />}
          onAct={j => { if (st.zone === 'gacts' && st.ai === j) enter(); else { sfx.play('move'); up({ zone: 'gacts', ai: j }); } }}
          onShot={j => { sfx.play('ok'); up({ zone: 'gshots', gs: j }); setView(j); }} />}
        {view != null && shots[view] && (
          <div className="rt-view" onClick={() => setView(null)}><img src={shots[view]} alt="" /><span>{view + 1}/{shots.length}</span></div>
        )}
        {toast}
      </Fit>
      <BootOverlay kind={cfg.boot} label={c.short} />
    </section>
  );
}

function Card({ g, stats, self, hints }: { g: HubGame; stats: PlayStats | undefined; self: boolean; hints: React.ReactNode }) {
  const p = useGameProgress(g);
  const i = g.installed, d = stats?.days ?? [], m = Math.max(...d, 0.01);
  return (
    <div className="rt-win rt-card">
      <div className="rt-gt">{g.title}</div>
      <div className="rt-gs">
        {g.status && <span>{STATUS_LABEL[g.status].toUpperCase()}</span>}
        {i ? (i.missing ? <span className="ghost">PASTA NÃO ENCONTRADA</span> : <span>{fmtPlay(i.playMs) || '0m'}{i.lastPlayed ? ` · ${ago(i.lastPlayed).toUpperCase()}` : ''}</span>)
          : <span className="ghost">{g.isNew ? 'NOVO NO CATÁLOGO' : self ? 'VOCÊ INSTALA' : 'NÃO INSTALADO'}</span>}
        {g.update?.updateAvailable && !self && <span className="ghost">UPDATE {g.update.latest?.tag}</span>}
        {p && <span className="ghost">{(p.error ?? p.stage).toUpperCase()}{p.pct > 0 && p.pct < 1 ? ` ${Math.round(p.pct * 100)}%` : ''}</span>}
      </div>
      {i && d.length ? <div className="rt-mini">{d.map((v, j) => <i key={j} className={v ? '' : 'z'} style={{ height: `${v ? Math.max(8, (v / m) * 100) : 8}%` }} />)}</div> : <div />}
      {hints}
    </div>
  );
}

function AchList({ list, sel }: { list: AchievementView[]; sel: number }) {
  const off = Math.max(0, Math.min(sel - 2, list.length - 5));
  return (
    <div className="rt-rows">{list.slice(off, off + 5).map((a, j) => (
      <div key={a.id} className={`rt-r ach ${off + j === sel ? 'on' : ''} ${a.unlockedAt != null ? '' : 'lock'}`}>
        <span className="t">{a.unlockedAt != null ? '★ ' : '· '}{a.name}</span><span className="v">{a.unlockedAt != null ? fmtDate(a.unlockedAt).split(',')[0] : 'BLOQ.'}</span>
        {a.description && <span className="s">{a.description}</span>}
      </div>
    ))}</div>
  );
}

function GamePage({ g, st, opts, shots, self, scrollRef, hints, onAct, onShot }: { g: HubGame; st: St; opts: Opt[]; shots: string[]; self: boolean; scrollRef: RefObject<HTMLDivElement | null>; hints: React.ReactNode; onAct: (j: number) => void; onShot: (j: number) => void }) {
  const about = useTranslated(g.catalog?.description);
  const needs = useTranslated(g.catalog?.needs);
  const p = useGameProgress(g);
  const i = g.installed;
  return (
    <div className="rt-win rt-page">
      <div className="rt-pscroll" ref={scrollRef}>
        <div className="rt-gt">{g.title}</div>
        <div className="rt-gs">
          {[g.status && STATUS_LABEL[g.status], g.catalog?.developer, g.catalog?.year].filter(Boolean).join(' · ').toUpperCase()}
        </div>
        <div className="rt-gs">
          {(i ? `${fmtPlay(i.playMs) || '0m'} JOGADAS${i.achievements?.total ? ` · ${i.achievements.unlocked}/${i.achievements.total} CONQUISTAS` : ''}` : 'NÃO INSTALADO')}
        </div>
        {i?.missing && <div className="rt-gs ghost">PASTA NÃO ENCONTRADA: {i.installDir}</div>}
        {p && <div className="rt-gs ghost">{(p.error ?? p.stage).toUpperCase()}</div>}
        <div className="rt-acts">{opts.map((o, j) => (
          <button key={o.k + j} className={st.zone === 'gacts' && st.ai === j ? 'on' : ''} onClick={() => onAct(j)}>{o.l}</button>
        ))}</div>
        <div className="rt-h">IMAGENS</div>
        {shots.length ? <div className="rt-gshots">{shots.map((u, j) => (
          <button key={u} className={st.zone === 'gshots' && st.gs === j ? 'on' : ''} onClick={() => onShot(j)}><img src={u} alt="" /></button>
        ))}</div> : <div className="rt-p dim">SEM CAPTURAS NO LAUNCHBOX.</div>}
        <div className={`rt-gtext ${st.zone === 'gtext' ? 'on' : ''}`}>
          {about.text && <><div className="rt-h">SOBRE</div><div className="rt-p">{about.text}</div></>}
          {needs.text && <><div className="rt-h">O QUE VOCÊ PRECISA</div><div className="rt-p">{needs.text}</div></>}
          {self && !i && <div className="rt-p">{SELF_INSTALL_NOTE}</div>}
          {!about.text && !needs.text && <div className="rt-p dim">O CATÁLOGO NÃO TRAZ DESCRIÇÃO DESTE JOGO.</div>}
          {(about.auto || needs.auto) && <div className="rt-p dim small">TRADUZIDO AUTOMATICAMENTE DO INGLÊS</div>}
        </div>
      </div>
      {hints}
    </div>
  );
}

function PortsDir() {
  const trpc = useTRPC();
  const q = useQuery(trpc.settings.portsDir.queryOptions());
  return <>{q.data ?? '…'}</>;
}
