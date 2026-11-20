import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConsoleId } from '@shared/types';
import { isSelfInstall, SELF_INSTALL_NOTE, STATUS_LABEL } from '@shared/consoles';
import { useTRPC } from '../trpc';
import { Glyph, useKeys, type Key } from '../lib/input';
import { getSettings, setSettings, useSettings } from '../lib/settings';
import { setSfxProfile, sfx } from '../lib/sfx';
import { ago, fmtDate, fmtPlay, plural } from '../lib/format';
import { matchesQuery } from '../lib/search';
import { useArt, useShots } from '../lib/art';
import { useTranslated } from '../lib/translate';
import { GameArt } from '../components/GameArt';
import { SearchBox } from '../components/SearchBox';
import { CONSOLES } from '../stage/consoles';
import { BootOverlay, Fit, useClock, useHubToast } from './HubFrame';
import { Ic, type IconName } from './icons';
import { useGameProgress, useHubActions, useHubData, type HubGame } from './data';

type Page = 'home' | 'cat' | 'ach' | 'news' | 'cfg' | 'game';
type Zone = 'top' | 'row' | 'acts' | 'cards' | 'tabs' | 'shelf' | 'side' | 'main' | 'gacts' | 'gshots' | 'gtext';
interface St { page: Page; zone: Zone; di: number; idx: number; ai: number; ci: number; ti: number; si: number; gi: number; game: string | null; from: { page: Page; zone: Zone; si: number } | null }
type Opt = { k: string; l: string; ic: IconName };
type Hint = [Parameters<typeof Glyph>[0]['a'], string];

const TOP: [string, string | IconName][] = [['games', 'Jogos'], ['cat', 'Descobrir'], ['search', 'search'], ['news', 'bell'], ['cfg', 'gear'], ['ach', 'medal']];
const TABS = ['Todos', 'Novos', 'Em progresso', 'Instalados', 'Buscar'];
const TAB_TITLE = ['Tudo o que existe para este console', 'Novos no catálogo', 'Em progresso', 'Já instalados', 'Buscar'];
const TAGS = { new: 'Novo no catálogo', upd: 'Versão nova', up: 'Mudou de status' } as const;
const SHORT = { new: 'Novo', upd: 'Versão nova', up: 'Status' } as const;
const CFG: Opt[] = [{ k: 'dir', l: 'Pasta dos jogos', ic: 'folder' }, { k: 'snd', l: 'Sons da interface', ic: 'sound' }, { k: 'radar', l: 'Radar de novidades', ic: 'bell' }, { k: 'off', l: 'Voltar ao Cartucho', ic: 'power' }];

const Art = ({ g, v }: { g: HubGame; v: 'cover' | 'wide' | 'square' }) =>
  <GameArt title={g.title} console={g.console} platformName={g.platformName} fallback={g.coverUrl} variant={v} />;

export function PS5Hub({ id, game: game0, tab, onBack }: { id: ConsoleId; game?: string; tab?: 'lib' | 'cat'; onBack: () => void }) {
  const c = CONSOLES.find(x => x.id === id)!;
  const self = isSelfInstall(id);
  const data = useHubData(id);
  const act = useHubActions();
  const trpc = useTRPC(), qc = useQueryClient();
  const s = useSettings();
  const [toast, show] = useHubToast();
  const [st, set] = useState<St>(() => ({ page: tab === 'cat' ? 'cat' : 'home', zone: tab === 'cat' ? 'shelf' : 'row', di: 0, idx: 0, ai: 0, ci: 0, ti: 0, si: 0, gi: 0, game: null, from: null }));
  const up = (p: Partial<St>) => set(x => ({ ...x, ...p }));
  const [menu, setMenu] = useState<{ g: HubGame; mi: number } | null>(null);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const clock = useClock();
  const pickDir = useMutation(trpc.settings.pickPortsDir.mutationOptions({ onSuccess: d => { qc.setQueryData(trpc.settings.portsDir.queryKey(), d); show('Pasta dos jogos alterada'); } }));
  const chooseExe = useMutation(trpc.games.chooseExe.mutationOptions({ onSuccess: () => void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }) }));
  const openFolder = useMutation(trpc.games.openFolder.mutationOptions());

  useEffect(() => { setSfxProfile('soft'); const t = setTimeout(() => sfx.play('boot'), 150); return () => clearTimeout(t); }, []);
  useEffect(() => { if (act.error) { show(act.error); act.reset(); } }, [act.error]);
  useEffect(() => {
    const go = () => { sfx.play('ok'); setMenu(null); set(x => ({ ...x, page: 'cat', zone: 'tabs', ti: 4, si: 0 })); setTimeout(() => searchRef.current?.focus(), 50); };
    addEventListener('cartucho:search', go);
    return () => removeEventListener('cartucho:search', go);
  }, []);

  const row = data.lib;
  useEffect(() => {
    if (!game0) return;
    const i = row.findIndex(g => g.key === game0 || g.catalog?.id === game0);
    if (i >= 0) up({ idx: i });
  }, [game0, row.length]);
  const g = st.page === 'home' ? row[st.idx] ?? null : null;
  const all = useMemo(() => new Map([...data.lib, ...data.catalog].flatMap(x => [[x.key, x] as const, ...(x.installed && x.catalog ? [[x.catalog.id, x] as const] : [])])), [data.lib, data.catalog]);
  const game = st.page === 'game' && st.game ? all.get(st.game) ?? null : null;
  const shots = useShots(game?.console, game?.title ?? '', game?.platformName);
  const [view, setView] = useState<number | null>(null);
  const gScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = gScroll.current; if (!el || st.page !== 'game') return;
    if (st.zone === 'gacts') el.scrollTo({ top: 0, behavior: 'smooth' });
    else if (st.zone === 'gshots') el.querySelector('.p5-gshots')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    else if (st.zone === 'gtext') el.querySelector('.p5-gsec.text')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [st.zone, st.page]);

  const catList = useMemo(() => {
    const L = data.catalog;
    if (st.ti === 1) return L.filter(x => x.isNew);
    if (st.ti === 2) return L.filter(x => x.status === 'wip');
    if (st.ti === 3) return L.filter(x => x.installed);
    if (st.ti === 4) return query.trim() ? [...L, ...data.lib.filter(x => !x.catalog)].filter(x => matchesQuery(query, x.title, x.platformName, x.catalog?.developer)) : [];
    return L;
  }, [data.catalog, data.lib, st.ti, query]);
  const achGames = data.lib;
  const achGame = achGames[st.gi] ?? null;
  const ach = useQuery(trpc.achievements.forGame.queryOptions({ id: achGame?.installed?.id ?? '' }, { enabled: st.page === 'ach' && !!achGame?.installed?.adapter }));
  const achList = ach.data ? [...ach.data.list].sort((a, b) => (b.unlockedAt ?? -1) - (a.unlockedAt ?? -1)) : [];

  const options = (x: HubGame, home: boolean): Opt[] => {
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
      L.push({ k: 'folder', l: 'Abrir pasta', ic: 'folder' });
      if (inst.exe) L.push({ k: 'exe', l: 'Escolher o .exe', ic: 'folder' });
    } else {
      if (x.repo && !self) L.push({ k: 'install', l: 'Instalar', ic: 'dl' });
      L.push({ k: 'add', l: self ? 'Já instalei: adicionar pasta' : 'Escolher pasta', ic: 'folder' });
    }
    if (x.repo) L.push({ k: 'gh', l: 'Ver no GitHub', ic: 'link' });
    if (st.page !== 'game') L.push({ k: 'info', l: 'Página do jogo', ic: 'info' });
    if (home) L.push({ k: 'off', l: 'Voltar ao Cartucho', ic: 'power' });
    return L;
  };
  const run = (k: string, x: HubGame) => {
    setMenu(null);
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
    if (k === 'remove') { act.remove(x); if (st.page === 'game') up({ page: st.from?.page ?? 'home', zone: st.from?.zone ?? 'row', game: null, from: null }); return show(`${x.title} saiu da biblioteca · nenhum arquivo foi apagado`); }
    if (k === 'update') { act.update(x); return show(`Atualizando para ${x.update?.latest?.tag}… configurações e saves ficam`); }
    if (k === 'ach') { up({ page: 'ach', zone: 'side', gi: Math.max(0, achGames.indexOf(x)), si: 0 }); return; }
    if (k === 'folder') return openFolder.mutate({ id: x.installed!.id });
    if (k === 'exe') return chooseExe.mutate({ id: x.installed!.id });
    if (k === 'gh') return act.github(x);
    if (k === 'info') return openGame(x);
    if (k === 'off') return onBack();
  };
  const primaryOf = (x: HubGame) => options(x, false)[0]!;
  const openGame = (x: HubGame) => { setMenu(null); setView(null); up({ page: 'game', game: x.key, from: { page: st.page, zone: st.zone, si: st.si }, zone: 'gacts', ai: 0, si: 0 }); };
  const gameOpts = game ? options(game, false) : [];

  const open = (page: Page, extra: Partial<St> = {}) => { sfx.play('ok'); setMenu(null); up({ page, zone: page === 'cat' ? 'tabs' : page === 'ach' ? 'side' : 'main', si: 0, ti: 0, ...extra }); };
  const top = (j: number) => {
    const k = TOP[j]![0];
    if (k === 'games') { sfx.play('move'); return up({ zone: 'row' }); }
    if (k === 'search') { open('cat', { ti: 4 }); setTimeout(() => searchRef.current?.focus(), 50); return; }
    open(k as Page, k === 'ach' ? { gi: 0 } : {});
  };
  const enter = () => {
    if (menu) { const o = options(menu.g, st.page === 'home')[menu.mi]; if (o) run(o.k, menu.g); return; }
    const p = st.page, z = st.zone;
    if (p === 'home') {
      if (z === 'top') return top(st.di);
      if (!g) return open('cat', { zone: 'shelf' });
      if (z === 'acts' && st.ai === 1) { sfx.play('ok'); return setMenu({ g, mi: 0 }); }
      if (z === 'cards') {
        if (st.ci === 0 && g.installed?.adapter) return run('ach', g);
        if (st.ci === 2) return open('news');
        if (st.ci === 3 && g.update?.updateAvailable && !self) return run('update', g);
        return sfx.play('move');
      }
      return run(primaryOf(g).k, g);
    }
    if (p === 'cat') {
      if (z === 'tabs') {
        if (st.ti === 4) { sfx.play('ok'); searchRef.current?.focus(); return; }
        if (catList.length) { sfx.play('move'); return up({ zone: 'shelf', si: 0 }); }
        return sfx.play('move');
      }
      const x = catList[st.si]; if (x) { sfx.play('ok'); openGame(x); }
      return;
    }
    if (p === 'game' && game) {
      if (z === 'gacts') { const o = gameOpts[st.ai]; if (o) run(o.k, game); return; }
      if (shots[st.si]) { sfx.play('ok'); setView(st.si); }
      return;
    }
    if (p === 'ach') { if (z === 'side' && achList.length) { sfx.play('move'); up({ zone: 'main', si: 0 }); } return; }
    if (p === 'cfg') {
      const k = CFG[st.si]!.k; sfx.play('ok');
      if (k === 'dir') return pickDir.mutate();
      if (k === 'snd') return setSettings({ snd: !getSettings().snd });
      if (k === 'off') return onBack();
      return show('O radar confere o catálogo do Recompendium toda vez que o Cartucho abre');
    }
    if (p === 'news') { const f = data.feed[st.si]; const x = f && data.catalog.find(y => y.catalog?.id === f.gameId); if (x) { sfx.play('ok'); setMenu({ g: x, mi: 0 }); } }
  };
  const back = () => {
    if (view != null) { sfx.play('back'); return setView(null); }
    if (menu) { sfx.play('back'); return setMenu(null); }
    if (st.page === 'game') { sfx.play('back'); const f = st.from; return up({ page: f?.page ?? 'home', zone: f?.zone ?? 'row', si: f?.si ?? 0, game: null, from: null }); }
    const p = st.page, z = st.zone;
    if (p === 'home') { if (z !== 'row') { sfx.play('back'); return up({ zone: 'row' }); } sfx.play('back'); return onBack(); }
    sfx.play('back');
    if ((p === 'cat' && z === 'shelf') || (p === 'ach' && z === 'main')) return up({ zone: p === 'cat' ? 'tabs' : 'side' });
    up({ page: 'home', zone: 'row' });
  };

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
    if (st.page === 'game' && !menu) {
      const el = gScroll.current;
      if (st.zone === 'gacts') { if (R && st.ai < gameOpts.length - 1) mv({ ai: st.ai + 1 }); else if (L && st.ai > 0) mv({ ai: st.ai - 1 }); else if (D) mv({ zone: shots.length ? 'gshots' : 'gtext', si: 0 }); return; }
      if (st.zone === 'gshots') { if (R && st.si < shots.length - 1) mv({ si: st.si + 1 }); else if (L && st.si > 0) mv({ si: st.si - 1 }); else if (U) mv({ zone: 'gacts' }); else if (D) mv({ zone: 'gtext' }); return; }
      if (D) { sfx.play('move'); el?.scrollBy({ top: 260, behavior: 'smooth' }); }
      else if (U) { if (!el || el.scrollTop <= 4 || (shots.length && el.scrollTop <= 400)) mv({ zone: shots.length ? 'gshots' : 'gacts' }); else { sfx.play('move'); el.scrollBy({ top: -260, behavior: 'smooth' }); } }
      return;
    }
    if (menu) {
      const n = options(menu.g, st.page === 'home').length;
      if (D && menu.mi < n - 1) { sfx.play('move'); setMenu({ ...menu, mi: menu.mi + 1 }); }
      else if (U && menu.mi > 0) { sfx.play('move'); setMenu({ ...menu, mi: menu.mi - 1 }); }
      return;
    }
    if (k === 'X' || k === 'Y') {
      if (st.page === 'home' && g) { sfx.play('ok'); setMenu({ g, mi: 0 }); }
      else if (st.page === 'cat' && st.zone === 'shelf' && catList[st.si]) { sfx.play('ok'); setMenu({ g: catList[st.si]!, mi: 0 }); }
      return;
    }
    if ((k === 'LB' || k === 'RB' || k === 'Tab') && st.page === 'cat') return mv({ ti: (st.ti + (k === 'LB' ? TABS.length - 1 : 1)) % TABS.length, si: 0, zone: 'tabs' });
    const p = st.page, z = st.zone, n = row.length + 1;
    if (p === 'home') {
      if (z === 'top') { if (R && st.di < TOP.length - 1) mv({ di: st.di + 1 }); else if (L && st.di > 0) mv({ di: st.di - 1 }); else if (D) mv({ zone: 'row' }); return; }
      if (z === 'row') { if (R && st.idx < n - 1) mv({ idx: st.idx + 1 }); else if (L && st.idx > 0) mv({ idx: st.idx - 1 }); else if (U) mv({ zone: 'top', di: 0 }); else if (D) mv({ zone: 'acts', ai: 0 }); return; }
      if (z === 'acts') { if (R && g) mv({ ai: 1 }); else if (L) mv({ ai: 0 }); else if (U) mv({ zone: 'row' }); else if (D && g) mv({ zone: 'cards', ci: 0 }); return; }
      if (z === 'cards') { if (R && st.ci < 3) mv({ ci: st.ci + 1 }); else if (L && st.ci > 0) mv({ ci: st.ci - 1 }); else if (U) mv({ zone: 'acts' }); return; }
    }
    if (p === 'cat') {
      if (z === 'tabs') { if (R && st.ti < TABS.length - 1) mv({ ti: st.ti + 1, si: 0 }); else if (L && st.ti > 0) mv({ ti: st.ti - 1, si: 0 }); else if (D && catList.length) mv({ zone: 'shelf', si: 0 }); return; }
      if (R && st.si < catList.length - 1) mv({ si: st.si + 1 }); else if (L && st.si > 0) mv({ si: st.si - 1 }); else if (U) mv({ zone: 'tabs' });
      return;
    }
    if (p === 'ach') {
      if (z === 'side') { if (D && st.gi < achGames.length - 1) mv({ gi: st.gi + 1, si: 0 }); else if (U && st.gi > 0) mv({ gi: st.gi - 1, si: 0 }); else if (R && achList.length) mv({ zone: 'main', si: 0 }); return; }
      if (D && st.si < achList.length - 1) mv({ si: st.si + 1 }); else if (U && st.si > 0) mv({ si: st.si - 1 }); else if (L) mv({ zone: 'side' });
      return;
    }
    const total = p === 'cfg' ? CFG.length : data.feed.length;
    if (D && st.si < total - 1) mv({ si: st.si + 1 }); else if (U && st.si > 0) mv({ si: st.si - 1 });
  });

  const hints: Hint[] = menu ? [['ok', 'Confirmar'], ['back', 'Fechar']]
    : st.page === 'home' && st.zone === 'row' && g ? [['ok', primaryOf(g).l], ['x', 'Opções']]
    : st.page === 'cat' && st.zone === 'tabs' ? [['lb', 'Categoria'], ['ok', st.ti === 4 ? 'Digitar' : 'Confirmar'], ['back', 'Voltar']]
    : st.page === 'cat' ? [['ok', 'Ver jogo'], ['x', 'Opções'], ['back', 'Voltar']]
    : st.page === 'game' && st.zone === 'gshots' ? [['ok', 'Ampliar'], ['ud', 'Rolar'], ['back', 'Voltar']]
    : st.page === 'game' && st.zone === 'gtext' ? [['ud', 'Rolar'], ['back', 'Voltar']]
    : st.page === 'game' ? [['ok', 'Confirmar'], ['ud', 'Rolar'], ['back', 'Voltar']]
    : [['ok', 'Confirmar'], ['back', 'Voltar']];
  const H = ({ className }: { className: string }) => <div className={className}>{hints.map(([a, t]) => <span key={a + t}><Glyph a={a} />{t}</span>)}</div>;

  const setMenuIdx = (mi: number) => { if (menu) { if (menu.mi === mi) { const o = options(menu.g, st.page === 'home')[mi]; if (o) run(o.k, menu.g); } else setMenu({ ...menu, mi }); } };
  const menuNode = menu && (
    <div className="p5-menu">
      <h4>{menu.g.title}</h4>
      {options(menu.g, st.page === 'home').map((o, j) => <button key={o.k + j} className={j === menu.mi ? 'on' : ''} onClick={() => setMenuIdx(j)}><Ic n={o.ic} />{o.l}</button>)}
    </div>
  );

  return (
    <section className="view hub sk-p5" style={{ ['--cc' as string]: c.color }}>
      <Fit w={1920} h={1080} className="p5" style={{ ['--cc' as string]: c.color }}>
        {st.page === 'home' ? (
          <Home c={c.name} g={g} row={row} st={st} self={self} clock={clock} feedCount={data.feed.length} catCount={data.catalog.length}
            primary={g ? primaryOf(g).l : 'Descobrir'} feed={g ? data.feed.find(f => f.gameId === g.catalog?.id) ?? null : null}
            onTile={i => { if (st.zone === 'row' && st.idx === i) enter(); else { sfx.play('move'); setMenu(null); up({ zone: 'row', idx: i }); } }}
            onTop={j => { up({ zone: 'top', di: j }); top(j); }}
            onAct={j => { if (st.zone === 'acts' && st.ai === j) enter(); else { sfx.play('move'); up({ zone: 'acts', ai: j }); } }}
            onCard={j => { if (st.zone === 'cards' && st.ci === j) enter(); else { sfx.play('move'); up({ zone: 'cards', ci: j }); } }}
            hints={<H className="p5-hint" />} menu={menuNode} />
        ) : (
          <div className={`p5-pg ${st.page === 'game' ? 'p5-gpage' : ''}`} key={st.page}>
            {st.page === 'game' && game && <GamePage g={game} st={st} opts={gameOpts} shots={shots} self={self} scrollRef={gScroll}
              onAct={j => { if (st.zone === 'gacts' && st.ai === j) enter(); else { sfx.play('move'); up({ zone: 'gacts', ai: j }); } }}
              onShot={j => { sfx.play('ok'); up({ zone: 'gshots', si: j }); setView(j); }} />}
            {st.page === 'cat' && (
              <>
                <div className="p5-ph"><span className="ic"><Ic n="compass" /></span>Descobrir</div>
                <div className="p5-ptabs">{TABS.map((t, j) => (
                  <button key={t} className={j === st.ti ? `on ${st.zone === 'tabs' ? 'f' : ''}` : ''} onClick={() => { sfx.play('move'); up({ zone: 'tabs', ti: j, si: 0 }); if (j === 4) setTimeout(() => searchRef.current?.focus(), 30); }}>
                    {j === 4 ? <><Ic n="search" /> {t}</> : t}
                  </button>
                ))}</div>
                {st.ti === 4
                  ? <SearchBox ref={searchRef} value={query} onChange={setQuery} nav={false} className="p5-search" placeholder="Nome do jogo…"
                      onDone={() => { if (catList.length) up({ zone: 'shelf', si: 0 }); }} />
                  : <div className="p5-sec" style={{ top: 290 }}>{TAB_TITLE[st.ti]} · {plural(catList.length, 'jogo', 'jogos')}</div>}
                <div className="p5-shelf" style={{ top: 345, transform: `translateX(-${Math.max(0, st.si - 2) * 426}px)` }}>
                  {catList.length ? catList.map((x, j) => (
                    <button key={x.key} className={`p5-big ${st.zone === 'shelf' && j === st.si ? 'on' : ''}`}
                      onClick={() => { if (st.zone === 'shelf' && st.si === j) enter(); else { sfx.play('move'); up({ zone: 'shelf', si: j }); } }}>
                      <Art g={x} v="square" />
                      <div className="cap">{x.title}<small>{x.isNew ? 'NOVO · ' : ''}{x.installed ? 'Instalado' : x.status ? STATUS_LABEL[x.status] : ''}</small></div>
                    </button>
                  )) : <div className="p5-none">{st.ti === 4 ? (query.trim() ? `Nada encontrado para “${query.trim()}”.` : `Digite o nome de um jogo de ${c.name}.`) : data.catalog.length ? 'Nada nesta categoria.' : `O catálogo ainda não tem recomps para ${c.name}.`}</div>}
                </div>
                {catList[st.si] && <Focus g={catList[st.si]!} self={self} />}
              </>
            )}
            {st.page === 'ach' && (
              <>
                <div className="p5-ph"><span className="ic"><Ic n="medal" /></span>Conquistas</div>
                <div className="p5-gl">{achGames.map((x, j) => (
                  <button key={x.key} className={j === st.gi ? (st.zone === 'side' ? 'on' : 'sel') : ''} aria-label={x.title} onClick={() => { sfx.play('move'); up({ zone: 'side', gi: j, si: 0 }); }}><Art g={x} v="wide" /></button>
                ))}</div>
                <div className="p5-list">
                  {achGame && <div className="p5-lt">{achGame.title}</div>}
                  {!achGame ? <div className="p5-li">Nenhum jogo instalado neste console.</div>
                    : !achGame.installed?.adapter ? <div className="p5-li tall">O Cartucho ainda não sabe ler as conquistas de {achGame.title}.</div>
                    : !achList.length ? <div className="p5-li">{ach.isLoading ? 'Lendo…' : 'Nenhuma conquista encontrada.'}</div>
                    : <div style={{ transform: `translateY(-${Math.max(0, st.si - 5) * 100}px)`, transition: 'transform .25s' }}>{achList.map((a, j) => (
                        <button key={a.id} className={`p5-li ${st.zone === 'main' && j === st.si ? 'on' : ''}`} onClick={() => { sfx.play('move'); up({ zone: 'main', si: j }); }}>
                          <span className={`md ${a.unlockedAt != null ? 'got' : 'lock'}`}>{a.icon ? <img src={a.icon} alt="" /> : <Ic n={a.unlockedAt != null ? 'medal' : 'lock'} />}</span>
                          <span>{a.name}<small>{a.description}</small></span>
                          <span className="v">{a.points != null ? `${a.points} G · ` : ''}{a.unlockedAt != null ? fmtDate(a.unlockedAt) : 'bloqueada'}</span>
                        </button>
                      ))}</div>}
                </div>
                {achList.length > 0 && (() => { const got = achList.filter(a => a.unlockedAt != null).length; return <div className="p5-prog"><b>{Math.round((got / achList.length) * 100)}%</b>{got} de {achList.length}</div>; })()}
              </>
            )}
            {st.page === 'news' && (
              <>
                <div className="p5-ph"><span className="ic"><Ic n="bell" /></span>Novidades</div>
                <div className="p5-list wide">{data.feed.length ? data.feed.map((f, j) => {
                  const x = data.catalog.find(y => y.catalog?.id === f.gameId);
                  return (
                    <button key={f.id} className={`p5-li news ${j === st.si ? 'on' : ''}`} onClick={() => { sfx.play('move'); up({ si: j }); }}>
                      {x ? <span className="th"><Art g={x} v="square" /></span> : null}
                      <span>{f.title}<small>{f.kind === 'new' ? (x?.repo ?? '') : f.detail}</small></span>
                      <span className="v">{TAGS[f.kind]} · {ago(f.at)}</span>
                    </button>
                  );
                }) : <div className="p5-li">Nada novo por aqui. O Cartucho confere o Recompendium toda vez que abre.</div>}</div>
              </>
            )}
            {st.page === 'cfg' && (
              <>
                <div className="p5-ph"><span className="ic"><Ic n="gear" /></span>Ajustes</div>
                <div className="p5-list mid">{CFG.map((o, j) => (
                  <button key={o.k} className={`p5-li ${j === st.si ? 'on' : ''}`} onClick={() => { if (st.si === j) enter(); else { sfx.play('move'); up({ si: j }); } }}>
                    <Ic n={o.ic} />{o.l}<span className="v">{o.k === 'snd' ? (s.snd ? 'Ligados' : 'Desligados') : o.k === 'dir' ? <PortsDir /> : ''}</span>
                  </button>
                ))}</div>
              </>
            )}
            <H className="p5-ft" />
            {menuNode}
          </div>
        )}
        {view != null && shots[view] && (
          <div className="p5-view" onClick={() => setView(null)}>
            <img src={shots[view]} alt="" />
            <span className="cnt">{view + 1} / {shots.length}</span>
          </div>
        )}
        {toast}
      </Fit>
      <BootOverlay kind="soft" label={c.name.toUpperCase()} />
    </section>
  );
}

function PortsDir() {
  const trpc = useTRPC();
  const q = useQuery(trpc.settings.portsDir.queryOptions());
  return <>{q.data ?? '…'}</>;
}

function GamePage({ g, st, opts, shots, self, scrollRef, onAct, onShot }: { g: HubGame; st: St; opts: Opt[]; shots: string[]; self: boolean; scrollRef: RefObject<HTMLDivElement | null>; onAct: (j: number) => void; onShot: (j: number) => void }) {
  const art = useArt(g.console, g.title, g.platformName);
  const about = useTranslated(g.catalog?.description);
  const needs = useTranslated(g.catalog?.needs);
  const p = useGameProgress(g);
  const inst = g.installed;
  const bg = art.fanart ?? art.cover ?? g.coverUrl;
  const [more, setMore] = useState(false);
  const check = () => { const el = scrollRef.current; if (el) setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 8); };
  useEffect(() => { check(); const el = scrollRef.current; if (!el) return; const ro = new ResizeObserver(check); ro.observe(el); if (el.lastElementChild) ro.observe(el.lastElementChild); return () => ro.disconnect(); });
  return (
    <>
    <div className="p5-gscroll" ref={scrollRef} onScroll={check}>
      <div className="p5-ghero">
        <div className="p5-gp-art">{bg ? <img src={bg} alt="" /> : <div className="p5-glow" />}</div>
        <div className="p5-gp-head">
          {art.logo ? <img className="logo" src={art.logo} alt={g.title} /> : <h1>{g.title}</h1>}
          {inst?.missing && <p className="warn">A pasta do jogo não foi encontrada em {inst.installDir}. {g.catalog?.repo && !self ? 'Instale de novo ou mostre onde ele está agora.' : 'Mostre onde ele está agora.'}</p>}
          <p className="meta">
            {[g.status && STATUS_LABEL[g.status], g.catalog?.developer, g.catalog?.year, g.platformName,
              inst ? (inst.running ? 'jogando agora' : inst.playMs ? `${fmtPlay(inst.playMs)} jogadas` : 'ainda não jogado') : null,
              inst?.achievements?.total ? `${inst.achievements.unlocked}/${inst.achievements.total} conquistas` : null].filter(Boolean).join(' · ')}
          </p>
          {p && <p className="prog">{p.error ?? `${p.stage}${p.pct > 0 && p.pct < 1 ? ` · ${Math.round(p.pct * 100)}%` : ''}`}</p>}
          <div className="p5-acts">{opts.map((o, j) => (
            <button key={o.k + j} className={`p5-b ${j === 0 ? 'pri' : ''} ${st.zone === 'gacts' && st.ai === j ? 'on' : ''}`} onClick={() => onAct(j)}>
              {j === 0 ? o.l : <><Ic n={o.ic} />{o.l}</>}
            </button>
          ))}</div>
        </div>
      </div>
      <div className="p5-gbody">
        <section className="p5-gsec">
          <h4>Imagens</h4>
          {shots.length ? <div className="p5-gshots">{shots.map((u, j) => (
            <button key={u} className={st.zone === 'gshots' && st.si === j ? 'on' : ''} onClick={() => onShot(j)}><img src={u} alt="" /></button>
          ))}</div> : <p className="dim">Sem capturas de tela no LaunchBox para este jogo.</p>}
        </section>
        <section className={`p5-gsec text ${st.zone === 'gtext' ? 'on' : ''}`}>
          {about.text && <><h4>Sobre</h4><p>{about.text}</p></>}
          {needs.text && <><h4>O que você precisa</h4><p>{needs.text}</p></>}
          {self && !inst && <p className="dim">{SELF_INSTALL_NOTE}</p>}
          {!about.text && !needs.text && <p className="dim">O catálogo não traz descrição deste jogo.</p>}
          {(about.auto || needs.auto) && <small>Traduzido automaticamente do inglês</small>}
        </section>
      </div>
    </div>
    <div className={`p5-gmore ${more ? 'on' : ''}`}><Ic n="down" /></div>
    </>
  );
}

function Focus({ g, self }: { g: HubGame; self: boolean }) {
  const p = useGameProgress(g);
  const needs = useTranslated(g.catalog?.needs);
  return (
    <div className="p5-focus">
      <h3>{g.title}</h3>
      <p>
        {g.status ? STATUS_LABEL[g.status] : ''}{g.catalog?.developer ? ` · ${g.catalog.developer}` : ''}{g.catalog?.year ? ` · ${g.catalog.year}` : ''}
        {p ? ` · ${p.error ?? p.stage}` : ''}
      </p>
      {needs.text && <p className="dim">Precisa: {needs.text}</p>}
      {self && !g.installed && <p className="dim">{SELF_INSTALL_NOTE}</p>}
    </div>
  );
}

function Home({ c, g, row, st, self, clock, feedCount, catCount, primary, feed, onTile, onTop, onAct, onCard, hints, menu }: {
  c: string; g: HubGame | null; row: HubGame[]; st: St; self: boolean; clock: string; feedCount: number; catCount: number; primary: string;
  feed: { kind: 'new' | 'upd' | 'up'; detail: string; at: number } | null;
  onTile: (i: number) => void; onTop: (j: number) => void; onAct: (j: number) => void; onCard: (j: number) => void; hints: ReactNode; menu: ReactNode;
}) {
  const z = st.zone, i = st.idx, n = row.length;
  const art = useArt(g?.console, g?.title ?? '', g?.platformName);
  const bg = g ? art.fanart ?? art.cover ?? g.coverUrl : null;
  const p = useGameProgress(g);
  return (
    <>
      <div className="p5-art">{bg ? <img src={bg} alt="" /> : <div className="p5-glow" />}</div>
      <div className="p5-top">
        {TOP.map(([k, l], j) => {
          const on = z === 'top' && st.di === j;
          if (k === 'games' || k === 'cat') return <button key={k} className={`p5-tab ${k === 'games' ? 'cur' : ''} ${on ? 'on' : ''}`} onClick={() => onTop(j)}>{l}</button>;
          if (k === 'ach') return <button key={k} className={`p5-av ${on ? 'on' : ''}`} aria-label="Conquistas" onClick={() => onTop(j)}>G</button>;
          return <button key={k} className={`i ${on ? 'on' : ''}`} aria-label={k} onClick={() => onTop(j)}><Ic n={l as IconName} />{k === 'news' && feedCount > 0 && <span className="n">{feedCount}</span>}</button>;
        }).reduce<ReactNode[]>((a, x, j) => (j === 2 ? [...a, <span key="sp" className="sp" />, x] : [...a, x]), [])}
        <span className="p5-brand">Cartucho</span>
        <span className="p5-clock">{clock}</span>
      </div>
      <div className="p5-row" style={{ transform: `translateX(-${Math.max(0, i - 2) * 126}px)` }}>
        {row.map((x, k) => (
          <button key={x.key} className={`p5-t ${k === i ? 'on' : ''} ${x.installed?.missing ? 'missing' : ''}`} aria-label={x.title} onClick={() => onTile(k)}>
            <Art g={x} v="square" />
            {x.installed?.running && <span className="run"><Ic n="play" /></span>}
            {k === i && z === 'row' && <span className="p5-lab">{x.title}</span>}
          </button>
        ))}
        <button className={`p5-t add ${i === n ? 'on' : ''}`} aria-label="Descobrir" onClick={() => onTile(n)}>
          <Ic n="plus" />{i === n && z === 'row' && <span className="p5-lab">Descobrir</span>}
        </button>
      </div>
      {g ? (
        <div className="p5-hero">
          <h1>{g.title}</h1>
          <p>
            {g.status ? `${STATUS_LABEL[g.status]} · ` : ''}
            {g.installed?.missing ? 'pasta do jogo não encontrada' : g.installed?.running ? 'jogando agora' : g.installed?.playMs ? `${fmtPlay(g.installed.playMs)} jogadas${g.installed.lastPlayed ? ` · última vez ${ago(g.installed.lastPlayed)}` : ''}` : 'ainda não jogado'}
          </p>
          {p && <p className="prog">{p.error ?? `${p.stage}${p.pct > 0 && p.pct < 1 ? ` · ${Math.round(p.pct * 100)}%` : ''}`}</p>}
          <div className="p5-acts">
            <button className={`p5-b pri ${z === 'acts' && st.ai === 0 ? 'on' : ''}`} onClick={() => onAct(0)}>{primary}</button>
            <button className={`p5-b icon ${z === 'acts' && st.ai === 1 ? 'on' : ''}`} aria-label="Opções" onClick={() => onAct(1)}><Ic n="dots" /></button>
          </div>
        </div>
      ) : (
        <div className="p5-hero">
          <h1>{n ? 'Descobrir' : 'Nenhum jogo por aqui ainda'}</h1>
          <p>{catCount ? `${plural(catCount, 'recomp', 'recomps')} de ${c} no catálogo.${self ? ' Você instala por conta própria e adiciona a pasta aqui.' : ''}` : 'O radar avisa quando aparecer o primeiro.'}</p>
          <div className="p5-acts"><button className={`p5-b pri ${z === 'acts' ? 'on' : ''}`} onClick={() => onAct(0)}>Abrir Descobrir</button></div>
        </div>
      )}
      {g && <Cards g={g} st={st} self={self} feed={feed} onCard={onCard} />}
      {hints}
      {menu}
    </>
  );
}

function Cards({ g, st, self, feed, onCard }: { g: HubGame; st: St; self: boolean; feed: { kind: 'new' | 'upd' | 'up'; detail: string; at: number } | null; onCard: (j: number) => void }) {
  const trpc = useTRPC();
  const inst = g.installed;
  const stats = useQuery(trpc.play.stats.queryOptions({ id: inst?.id ?? '' }, { enabled: !!inst }));
  const d = stats.data?.days ?? [], m = Math.max(...d, 0.01), week = d.slice(7).reduce((a, b) => a + b, 0) * 3600_000;
  const a = inst?.achievements;
  const C = ({ k, children }: { k: number; children: ReactNode }) =>
    <button className={`p5-c ${st.zone === 'cards' && st.ci === k ? 'on' : ''}`} onClick={() => onCard(k)}>{children}</button>;
  return (
    <div className="p5-cards">
      <C k={0}>
        <small><Ic n="medal" /> Conquistas</small>
        {a?.total ? <><b>{a.unlocked}/{a.total}</b><span>{Math.round((a.unlocked / a.total) * 100)}% completo</span><div className="bar"><i style={{ width: `${(a.unlocked / a.total) * 100}%` }} /></div></>
          : <><b>—</b><span>{inst?.adapter ? 'Nenhuma ainda' : 'Sem conquistas para este jogo'}</span></>}
      </C>
      <C k={1}>
        <small><Ic n="clock" /> Tempo de jogo</small>
        <b>{inst ? fmtPlay(inst.playMs) || '0m' : '—'}</b>
        <span>{inst ? `${fmtPlay(week) || '0m'} nesta semana` : 'Ainda não jogado'}</span>
        {inst && d.length > 0 && <div className="mb">{d.map((v, j) => <i key={j} className={v ? '' : 'z'} style={{ height: `${v ? Math.max(6, (v / m) * 100) : 3}%` }} />)}</div>}
      </C>
      <C k={2}>
        <small><Ic n="bell" /> Novidades</small>
        <b>{feed ? SHORT[feed.kind] : '—'}</b>
        <span>{feed ? `${feed.detail ? feed.detail + ' · ' : ''}${ago(feed.at)}` : 'Nada novo para este jogo'}</span>
      </C>
      <C k={3}>
        <small><Ic n="dl" /> Versão</small>
        <b>{g.update?.installed ?? inst?.version ?? '—'}</b>
        <span>{self ? 'Atualizações por sua conta' : g.update?.updateAvailable ? `${g.update.latest?.tag} disponível` : inst ? (g.update?.updateAvailable === false ? 'Em dia' : 'Versão desconhecida') : 'Não instalado'}</span>
      </C>
    </div>
  );
}
