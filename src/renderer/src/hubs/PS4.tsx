import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConsoleId, RadarEvent } from '@shared/types';
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

type Page = 'home' | 'cat' | 'news' | 'ach' | 'time' | 'cfg' | 'game';
type Zone = 'fn' | 'row' | 'cards' | 'side' | 'main' | 'gacts' | 'gshots' | 'gtext';
interface From { page: Page; zone: Zone; si: number; mi: number }
interface St { page: Page; zone: Zone; di: number; idx: number; ci: number; si: number; mi: number; ai: number; gs: number; game: string | null; from: From | null }
type Opt = { k: string; l: string; ic: IconName };
type Hint = [Parameters<typeof Glyph>[0]['a'], string];
type Side = { k: string; l: string; ic?: IconName; g?: HubGame; v?: string | number };
type Row = { key: string; g?: HubGame; md?: 'got' | 'lock'; icon?: string | null; t: string; s: string; rt: ReactNode; isNew?: boolean };

const FN: [string, string, IconName][] = [
  ['news', 'Novidades', 'bell'], ['ach', 'Conquistas', 'medal'], ['time', 'Tempo de jogo', 'clock'], ['cat', 'Descobrir', 'compass'],
  ['search', 'Buscar', 'search'], ['cfg', 'Ajustes', 'gear'], ['off', 'Voltar ao Cartucho', 'power'],
];
const TITLE: Record<string, string> = { cat: 'Descobrir', news: 'Novidades', ach: 'Conquistas', time: 'Tempo de jogo', cfg: 'Ajustes' };
const TAGS = { new: 'Novo no catálogo', upd: 'Versão nova', up: 'Mudou de status' } as const;
const SHORT = { new: 'Novo', upd: 'Versão nova', up: 'Status' } as const;
const CAT_SIDE: Side[] = [
  { k: 'all', l: 'Todos', ic: 'grid' }, { k: 'new', l: 'Novos', ic: 'star' }, { k: 'play', l: 'Jogáveis', ic: 'play' },
  { k: 'wip', l: 'Em progresso', ic: 'chart' }, { k: 'inst', l: 'Instalados', ic: 'dl' }, { k: 'search', l: 'Buscar', ic: 'search' },
];
const NEWS_SIDE: Side[] = [{ k: 'all', l: 'Tudo', ic: 'bell' }, { k: 'new', l: 'Novos no catálogo', ic: 'star' }, { k: 'upd', l: 'Versões novas', ic: 'dl' }, { k: 'up', l: 'Mudou de status', ic: 'chart' }];
const CFG_SIDE: Side[] = [{ k: 'dir', l: 'Pasta dos jogos', ic: 'folder' }, { k: 'snd', l: 'Sons da interface', ic: 'sound' }, { k: 'radar', l: 'Radar de novidades', ic: 'bell' }, { k: 'off', l: 'Voltar ao Cartucho', ic: 'power' }];
const ROW_H = 132, SIDE_H = 78, TILE = 220, GAP = 14;

const Art = ({ g, v }: { g: HubGame; v: 'cover' | 'wide' | 'square' }) =>
  <GameArt title={g.title} console={g.console} platformName={g.platformName} fallback={g.coverUrl} variant={v} />;

const Ribbons = () => (
  <svg className="p4-rib" viewBox="0 0 1920 1080" preserveAspectRatio="none" aria-hidden="true">
    <path d="M-200 820 C 300 600, 700 1000, 1200 760 S 1900 420, 2200 560 L 2200 700 C 1800 600, 1500 900, 1100 900 S 300 820, -200 980 Z" fill="rgba(255,255,255,.07)" />
    <path d="M-100 300 C 400 120, 900 420, 1400 260 S 2000 120, 2200 200 L 2200 260 C 1900 220, 1500 380, 1100 380 S 300 260, -100 380 Z" fill="rgba(255,255,255,.05)" />
    <path d="M1300 -100 C 1500 300, 1300 700, 1700 1180 L 1820 1180 C 1500 700, 1650 300, 1460 -100 Z" fill="rgba(255,255,255,.06)" />
  </svg>
);

export function PS4Hub({ id, game: game0, tab, onBack }: { id: ConsoleId; game?: string; tab?: 'lib' | 'cat'; onBack: () => void }) {
  const c = CONSOLES.find(x => x.id === id)!;
  const self = isSelfInstall(id);
  const data = useHubData(id);
  const act = useHubActions();
  const trpc = useTRPC(), qc = useQueryClient();
  const s = useSettings();
  const [toast, show] = useHubToast();
  const [st, set] = useState<St>(() => ({ page: tab === 'cat' ? 'cat' : 'home', zone: tab === 'cat' ? 'side' : 'row', di: 0, idx: 0, ci: 0, si: 0, mi: 0, ai: 0, gs: 0, game: null, from: null }));
  const up = (p: Partial<St>) => set(x => ({ ...x, ...p }));
  const [menu, setMenu] = useState<{ g: HubGame; mi: number } | null>(null);
  const [query, setQuery] = useState('');
  const [pop, setPop] = useState<RadarEvent | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const gScroll = useRef<HTMLDivElement>(null);
  const clock = useClock();
  const pickDir = useMutation(trpc.settings.pickPortsDir.mutationOptions({ onSuccess: d => { qc.setQueryData(trpc.settings.portsDir.queryKey(), d); show('Pasta dos jogos alterada'); } }));
  const chooseExe = useMutation(trpc.games.chooseExe.mutationOptions({ onSuccess: () => void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }) }));
  const openFolder = useMutation(trpc.games.openFolder.mutationOptions());

  useEffect(() => { setSfxProfile('soft'); const t = setTimeout(() => sfx.play('boot'), 150); return () => clearTimeout(t); }, []);
  useEffect(() => { if (act.error) { show(act.error); act.reset(); } }, [act.error]);
  const focusSearch = () => setTimeout(() => searchRef.current?.focus(), 50);
  useEffect(() => {
    const go = () => { sfx.play('ok'); setMenu(null); set(x => ({ ...x, page: 'cat', zone: 'side', si: CAT_SIDE.length - 1, mi: 0 })); focusSearch(); };
    addEventListener('cartucho:search', go);
    return () => removeEventListener('cartucho:search', go);
  }, []);
  const firstFeed = data.feed[0];
  useEffect(() => {
    if (!firstFeed) return;
    const a = setTimeout(() => setPop(firstFeed), 1800), b = setTimeout(() => setPop(null), 8000);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [firstFeed?.id]);

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
  useEffect(() => {
    const el = gScroll.current; if (!el || st.page !== 'game') return;
    if (st.zone === 'gacts') el.scrollTo({ top: 0, behavior: 'smooth' });
    else if (st.zone === 'gshots') el.querySelector('.p4-gshots')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    else if (st.zone === 'gtext') el.querySelector('.p4-gsec.text')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [st.zone, st.page]);

  const byPlay = useMemo(() => [...data.lib].sort((a, b) => (b.installed?.playMs ?? 0) - (a.installed?.playMs ?? 0)), [data.lib]);
  const statQ = useQueries({ queries: (st.page === 'time' ? byPlay : []).map(x => trpc.play.stats.queryOptions({ id: x.installed!.id })) });
  const stats = new Map(byPlay.map((x, i) => [x.key, statQ[i]?.data] as const));

  const side: Side[] = st.page === 'cat' ? CAT_SIDE.map(x => ({ ...x, v: x.k === 'new' ? data.catalog.filter(y => y.isNew).length || undefined : undefined }))
    : st.page === 'news' ? NEWS_SIDE.map(x => ({ ...x, v: (x.k === 'all' ? data.feed.length : data.feed.filter(f => f.kind === x.k).length) || undefined }))
    : st.page === 'ach' ? data.lib.map(x => ({ k: x.key, l: x.title, g: x, v: x.installed?.achievements?.total ? `${x.installed.achievements.unlocked}/${x.installed.achievements.total}` : undefined }))
    : st.page === 'time' ? [{ k: 'sum', l: 'Resumo', ic: 'chart' as IconName }, ...byPlay.map(x => ({ k: x.key, l: x.title, g: x, v: fmtPlay(x.installed?.playMs ?? 0) || '0m' }))]
    : st.page === 'cfg' ? CFG_SIDE
    : [];
  const sk = side[st.si]?.k;
  const achGame = st.page === 'ach' ? side[st.si]?.g ?? null : null;
  const ach = useQuery(trpc.achievements.forGame.queryOptions({ id: achGame?.installed?.id ?? '' }, { enabled: !!achGame?.installed?.adapter }));
  const achList = ach.data ? [...ach.data.list].sort((a, b) => (b.unlockedAt ?? -1) - (a.unlockedAt ?? -1)) : [];

  const catList = useMemo(() => {
    const L = data.catalog;
    if (sk === 'new') return L.filter(x => x.isNew);
    if (sk === 'play') return L.filter(x => x.status === 'full' || x.status === 'play');
    if (sk === 'wip') return L.filter(x => x.status === 'wip');
    if (sk === 'inst') return L.filter(x => x.installed);
    if (sk === 'search') return query.trim() ? [...L, ...data.lib.filter(x => !x.catalog)].filter(x => matchesQuery(query, x.title, x.platformName, x.catalog?.developer)) : [];
    return L;
  }, [data.catalog, data.lib, sk, query]);
  const feedGame = (f: RadarEvent) => data.catalog.find(y => y.catalog?.id === f.gameId) ?? null;
  const feedList = st.page === 'news' ? data.feed.filter(f => sk === 'all' || f.kind === sk) : [];
  const rows: Row[] = st.page === 'cat' ? catList.map(x => ({
      key: x.key, g: x, t: x.title, isNew: x.isNew,
      s: [x.catalog?.developer, x.catalog?.year, x.platformName].filter(Boolean).join(' · ') || (x.repo ?? ''),
      rt: <>{x.status ? STATUS_LABEL[x.status] : ''}<br />{x.installed ? 'Instalado' : self ? 'Você instala' : x.repo ? 'Disponível' : ''}</>,
    }))
    : st.page === 'news' ? feedList.map(f => { const x = feedGame(f); return { key: String(f.id), g: x ?? undefined, t: f.title, s: f.kind === 'new' ? (self ? '' : x?.repo ?? '') : f.detail, rt: <>{TAGS[f.kind]}<br />{ago(f.at)}</>, isNew: f.kind === 'new' }; })
    : st.page === 'ach' ? achList.map((a): Row => ({ key: String(a.id), md: a.unlockedAt != null ? 'got' : 'lock', icon: a.icon, t: a.name, s: a.description ?? '', rt: <>{a.points != null ? `${a.points} pontos` : ''}<br />{a.unlockedAt != null ? fmtDate(a.unlockedAt) : 'Bloqueada'}</> }))
    : [];

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
  const primaryOf = (x: HubGame) => options(x, false)[0]!;
  const openGame = (x: HubGame) => { setMenu(null); setView(null); up({ page: 'game', game: x.key, from: { page: st.page, zone: st.zone, si: st.si, mi: st.mi }, zone: 'gacts', ai: 0, gs: 0 }); };
  const gameOpts = game ? options(game, false) : [];
  const open = (page: Page, extra: Partial<St> = {}) => { sfx.play('ok'); setMenu(null); up({ page, zone: 'side', si: 0, mi: 0, ...extra }); };

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
    if (k === 'remove') { act.remove(x); if (st.page === 'game') back(true); return show(`${x.title} saiu da biblioteca · nenhum arquivo foi apagado`); }
    if (k === 'update') { act.update(x); return show(`Atualizando para ${x.update?.latest?.tag}… configurações e saves ficam`); }
    if (k === 'ach') return up({ page: 'ach', zone: 'side', si: Math.max(0, data.lib.indexOf(x)), mi: 0 });
    if (k === 'folder') return openFolder.mutate({ id: x.installed!.id });
    if (k === 'exe') return chooseExe.mutate({ id: x.installed!.id });
    if (k === 'gh') return act.github(x);
    if (k === 'info') return openGame(x);
    if (k === 'off') return onBack();
  };

  const fn = (j: number) => {
    const k = FN[j]![0];
    if (k === 'off') { sfx.play('back'); return onBack(); }
    if (k === 'search') { open('cat', { si: CAT_SIDE.length - 1 }); return focusSearch(); }
    open(k as Page);
  };
  const toMain = () => { if (rows.length) { sfx.play('move'); up({ zone: 'main', mi: 0 }); } };
  const enter = () => {
    if (menu) { const o = options(menu.g, st.page === 'home')[menu.mi]; if (o) run(o.k, menu.g); return; }
    const p = st.page, z = st.zone;
    if (p === 'home') {
      if (z === 'fn') return fn(st.di);
      if (!g) return open('cat');
      if (z === 'cards') {
        if (st.ci === 0) return open('time', { si: Math.max(0, byPlay.indexOf(g) + 1) });
        if (st.ci === 1) return g.installed?.adapter ? run('ach', g) : open('ach', { si: Math.max(0, data.lib.indexOf(g)) });
        if (st.ci === 3 && g.update?.updateAvailable && !self) return run('update', g);
        return open('news', { si: st.ci === 3 ? 2 : 0 });
      }
      return run(primaryOf(g).k, g);
    }
    if (p === 'game' && game) {
      if (z === 'gacts') { const o = gameOpts[st.ai]; if (o) run(o.k, game); return; }
      if (z === 'gshots' && shots[st.gs]) { sfx.play('ok'); setView(st.gs); }
      return;
    }
    if (z === 'side') {
      if (p === 'cat' && sk === 'search') { sfx.play('ok'); searchRef.current?.focus(); return; }
      if (p === 'cfg') {
        sfx.play('ok');
        if (sk === 'dir') return pickDir.mutate();
        if (sk === 'snd') return setSettings({ snd: !getSettings().snd });
        if (sk === 'off') return onBack();
        return show('O radar confere o catálogo do Recompendium toda vez que o Cartucho abre');
      }
      return toMain();
    }
    const r = rows[st.mi];
    if (r?.g && (p === 'cat' || p === 'news')) { sfx.play('ok'); openGame(r.g); return; }
    sfx.play('move');
  };
  function back(silent = false) {
    if (!silent) sfx.play('back');
    if (view != null) return setView(null);
    if (menu) return setMenu(null);
    if (st.page === 'game') { const f = st.from; return up({ page: f?.page ?? 'home', zone: f?.zone ?? 'row', si: f?.si ?? 0, mi: f?.mi ?? 0, game: null, from: null }); }
    if (st.page === 'home') { if (st.zone !== 'row') return up({ zone: 'row' }); return onBack(); }
    if (st.zone === 'main') return up({ zone: 'side' });
    up({ page: 'home', zone: 'row' });
  }

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
    if (menu) {
      const n = options(menu.g, st.page === 'home').length;
      if (D && menu.mi < n - 1) { sfx.play('move'); setMenu({ ...menu, mi: menu.mi + 1 }); }
      else if (U && menu.mi > 0) { sfx.play('move'); setMenu({ ...menu, mi: menu.mi - 1 }); }
      return;
    }
    const p = st.page, z = st.zone;
    if (p === 'game') {
      const el = gScroll.current;
      if (z === 'gacts') { if (R && st.ai < gameOpts.length - 1) mv({ ai: st.ai + 1 }); else if (L && st.ai > 0) mv({ ai: st.ai - 1 }); else if (D) mv({ zone: shots.length ? 'gshots' : 'gtext', gs: 0 }); return; }
      if (z === 'gshots') { if (R && st.gs < shots.length - 1) mv({ gs: st.gs + 1 }); else if (L && st.gs > 0) mv({ gs: st.gs - 1 }); else if (U) mv({ zone: 'gacts' }); else if (D) mv({ zone: 'gtext' }); return; }
      if (D) { sfx.play('move'); el?.scrollBy({ top: 260, behavior: 'smooth' }); }
      else if (U) { if (!el || el.scrollTop <= 4 || (shots.length && el.scrollTop <= 400)) mv({ zone: shots.length ? 'gshots' : 'gacts' }); else { sfx.play('move'); el.scrollBy({ top: -260, behavior: 'smooth' }); } }
      return;
    }
    if (k === 'X' || k === 'Y') {
      if (p === 'home' && g) { sfx.play('ok'); setMenu({ g, mi: 0 }); }
      else if (z === 'main' && rows[st.mi]?.g && (p === 'cat' || p === 'news')) { sfx.play('ok'); setMenu({ g: rows[st.mi]!.g!, mi: 0 }); }
      return;
    }
    if (k === 'Tab' || k === 'LB' || k === 'RB') return;
    if (p === 'home') {
      const n = row.length + 1;
      if (z === 'fn') { if (R && st.di < FN.length - 1) mv({ di: st.di + 1 }); else if (L && st.di > 0) mv({ di: st.di - 1 }); else if (D) mv({ zone: 'row' }); return; }
      if (z === 'row') { if (R && st.idx < n - 1) mv({ idx: st.idx + 1 }); else if (L && st.idx > 0) mv({ idx: st.idx - 1 }); else if (U) mv({ zone: 'fn' }); else if (D && g) mv({ zone: 'cards', ci: 0 }); return; }
      if (R && st.ci < 3) mv({ ci: st.ci + 1 }); else if (L && st.ci > 0) mv({ ci: st.ci - 1 }); else if (U) mv({ zone: 'row' });
      return;
    }
    if (z === 'side') {
      if (D && st.si < side.length - 1) mv({ si: st.si + 1, mi: 0 }); else if (U && st.si > 0) mv({ si: st.si - 1, mi: 0 });
      else if (R) { if (p === 'cat' && sk === 'search' && !query.trim()) { sfx.play('ok'); searchRef.current?.focus(); } else toMain(); }
      return;
    }
    if (D && st.mi < rows.length - 1) mv({ mi: st.mi + 1 }); else if (U && st.mi > 0) mv({ mi: st.mi - 1 });
    else if (U && p === 'cat' && sk === 'search') { sfx.play('ok'); searchRef.current?.focus(); }
    else if (L) mv({ zone: 'side' });
  });

  const hints: Hint[] = menu ? [['ok', 'Confirmar'], ['back', 'Fechar']]
    : st.page === 'home' ? (st.zone === 'row' && g ? [['ok', primaryOf(g).l], ['x', 'Opções'], ['back', 'Sair']] : st.zone === 'cards' ? [['ok', 'Abrir'], ['back', 'Voltar']] : [['ok', 'Confirmar'], ['back', st.zone === 'row' ? 'Sair' : 'Voltar']])
    : st.page === 'game' ? (st.zone === 'gshots' ? [['ok', 'Ampliar'], ['ud', 'Rolar'], ['back', 'Voltar']] : st.zone === 'gtext' ? [['ud', 'Rolar'], ['back', 'Voltar']] : [['ok', 'Confirmar'], ['ud', 'Rolar'], ['back', 'Voltar']])
    : st.zone === 'main' && (st.page === 'cat' || st.page === 'news') ? [['ok', 'Ver jogo'], ['x', 'Opções'], ['back', 'Voltar']]
    : st.page === 'cat' && sk === 'search' && st.zone === 'side' ? [['ok', 'Digitar'], ['back', 'Voltar']]
    : st.page === 'time' || (st.page === 'ach' && (st.zone === 'main' || !rows.length)) ? [['ud', 'Escolher'], ['back', 'Voltar']]
    : st.page === 'cfg' ? [['ok', sk === 'dir' ? 'Trocar pasta' : sk === 'snd' ? (s.snd ? 'Desligar' : 'Ligar') : sk === 'off' ? 'Sair' : 'Confirmar'], ['back', 'Voltar']]
    : [['ok', 'Confirmar'], ['back', 'Voltar']];
  const Hints = ({ className }: { className: string }) => <div className={className}>{hints.map(([a, t]) => <span key={a + t}><Glyph a={a} />{t}</span>)}</div>;

  const setMenuIdx = (mi: number) => { if (menu) { if (menu.mi === mi) { const o = options(menu.g, st.page === 'home')[mi]; if (o) run(o.k, menu.g); } else { sfx.play('move'); setMenu({ ...menu, mi }); } } };
  const menuNode = menu && (
    <div className="p4-menu">
      <h4>{menu.g.title}</h4>
      {options(menu.g, st.page === 'home').map((o, j) => <button key={o.k + j} className={j === menu.mi ? 'on' : ''} onClick={() => setMenuIdx(j)}><Ic n={o.ic} />{o.l}</button>)}
    </div>
  );
  const click = (zone: Zone, p: Partial<St>, same: boolean) => { if (same) enter(); else { sfx.play('move'); setMenu(null); up({ zone, ...p }); } };

  return (
    <section className="view hub sk-p4" style={{ ['--cc' as string]: c.color }}>
      <Fit w={1920} h={1080} className="p4" style={{ ['--cc' as string]: c.color }}>
        <Ribbons />
        {st.page === 'home' ? (
          <Home row={row} g={g} st={st} self={self} clock={clock} catCount={data.catalog.length} cname={c.name} feed={data.feed}
            primary={g ? primaryOf(g).l : 'Abrir'}
            onFn={j => { up({ zone: 'fn', di: j }); fn(j); }}
            onTile={i => click('row', { idx: i }, st.zone === 'row' && st.idx === i)}
            onCard={j => click('cards', { ci: j }, st.zone === 'cards' && st.ci === j)} />
        ) : st.page === 'game' && game ? (
          <GamePage g={game} st={st} opts={gameOpts} shots={shots} self={self} scrollRef={gScroll}
            onAct={j => click('gacts', { ai: j }, st.zone === 'gacts' && st.ai === j)}
            onShot={j => { sfx.play('ok'); up({ zone: 'gshots', gs: j }); setView(j); }} />
        ) : (
          <div className="p4-pgw" key={st.page}>
            <div className="p4-h">{TITLE[st.page]}</div>
            <div className="p4-clock p4-hc">{clock}</div>
            <div className="p4-hr" />
            <nav className="p4-side">
              <div style={{ transform: `translateY(-${Math.max(0, st.si - 7) * SIDE_H}px)` }}>
                {side.length ? side.map((x, j) => (
                  <button key={x.k} className={`p4-si ${j === st.si ? (st.zone === 'side' ? 'on' : 'sel') : ''}`}
                    onClick={() => click('side', { si: j, mi: 0 }, st.zone === 'side' && st.si === j)}>
                    {x.g ? <span className="th"><Art g={x.g} v="square" /></span> : x.ic ? <Ic n={x.ic} /> : null}
                    <span className="l">{x.l}</span>{x.v != null && <span className="v">{x.v}</span>}
                  </button>
                )) : <div className="p4-si dim">Nenhum jogo instalado</div>}
              </div>
            </nav>
            <div className="p4-main">
              <div className="p4-pg" key={`${st.page}-${sk}`}>
                <Main page={st.page} sk={sk} st={st} rows={rows} cname={c.name} self={self} catalogCount={data.catalog.length}
                  query={query} setQuery={setQuery} searchRef={searchRef} onSearchDone={() => { if (rows.length) up({ zone: 'main', mi: 0 }); }}
                  achGame={achGame} achLoading={ach.isLoading} sideGame={side[st.si]?.g ?? null} lib={byPlay} stats={stats} sndOn={s.snd}
                  onRow={j => click('main', { mi: j }, st.zone === 'main' && st.mi === j)} />
              </div>
            </div>
          </div>
        )}
        <Hints className={`p4-ft ${st.page === 'home' ? '' : st.page === 'game' ? 'p4-fg' : 'rl'}`} />
        {menuNode}
        {pop && st.page === 'home' && (
          <div className="p4-pop"><i><Ic n="bell" /></i><div>{pop.title}<small>{TAGS[pop.kind]}{pop.detail ? ` · ${pop.detail}` : ''}</small></div></div>
        )}
        {view != null && shots[view] && (
          <div className="p4-view" onClick={() => setView(null)}>
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

function Home({ row, g, st, self, clock, catCount, cname, feed, primary, onFn, onTile, onCard }: {
  row: HubGame[]; g: HubGame | null; st: St; self: boolean; clock: string; catCount: number; cname: string; feed: RadarEvent[]; primary: string;
  onFn: (j: number) => void; onTile: (i: number) => void; onCard: (j: number) => void;
}) {
  const z = st.zone, i = st.idx, n = row.length;
  const p = useGameProgress(g);
  const f = feed[0];
  const gf = g ? feed.find(x => x.gameId === g.catalog?.id) ?? null : null;
  return (
    <>
      <div className="p4-top">
        <span className="p4-me"><i><Ic n="pad" /></i>Cartucho</span>
        {f && <span className="p4-ntf"><Ic n="info" /><b>{f.title}</b>{TAGS[f.kind].toLowerCase()}</span>}
        <span className="sp" />
        <nav className="p4-fn">{FN.map(([k, l, ic], j) => {
          const on = z === 'fn' && st.di === j;
          return (
            <button key={k} className={on ? 'on' : ''} aria-label={l} onClick={() => onFn(j)}>
              <Ic n={ic} />{k === 'news' && feed.length > 0 && <span className="n">{feed.length}</span>}
              {on && <span className="lb">{l}</span>}
            </button>
          );
        })}</nav>
        <span className="p4-clock">{clock}</span>
      </div>
      <div className="p4-rule" />
      <div className="p4-row" style={{ transform: `translateX(-${Math.max(0, i - 1) * (TILE + GAP)}px)` }}>
        {row.map((x, k) => (
          <button key={x.key} className={`p4-t ${k === i && z !== 'fn' ? 'on' : ''} ${x.installed?.missing ? 'missing' : ''}`} aria-label={x.title} onClick={() => onTile(k)}>
            <Art g={x} v="square" />
            {x.installed?.running && <span className="run"><Ic n="play" /></span>}
            <span className="band">{k === i ? primary : ''}</span>
          </button>
        ))}
        <button className={`p4-t add ${i === n && z !== 'fn' ? 'on' : ''}`} onClick={() => onTile(n)}><Ic n="compass" />Descobrir</button>
      </div>
      {g ? (
        <>
          <div className="p4-ti">
            <span className="t">{g.title}</span>
            <small>{p ? p.error ?? `${p.stage}${p.pct > 0 && p.pct < 1 ? ` · ${Math.round(p.pct * 100)}%` : ''}` : g.installed?.missing ? 'pasta do jogo não encontrada' : g.status ? STATUS_LABEL[g.status] : ''}</small>
          </div>
          <Cards g={g} st={st} self={self} feed={gf} onCard={onCard} />
        </>
      ) : (
        <div className="p4-ti">
          <span className="t">{n ? 'Descobrir' : 'Nenhum jogo por aqui ainda'}</span>
          <small>{catCount ? `${plural(catCount, 'recomp', 'recomps')} de ${cname} no catálogo` : 'O radar avisa quando aparecer o primeiro'}</small>
        </div>
      )}
    </>
  );
}

function Ring({ p }: { p: number }) {
  const r = 40, C = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 96 96"><circle cx="48" cy="48" r={r} stroke="rgba(255,255,255,.2)" />{p > 0 && <circle cx="48" cy="48" r={r} stroke="#fff" strokeDasharray={`${C * p} ${C}`} strokeLinecap="round" />}</svg>
  );
}

function Bars({ d, cls }: { d: number[]; cls: string }) {
  const m = Math.max(...d, 0.01);
  return <div className={cls}>{d.map((v, j) => <i key={j} className={v ? '' : 'z'} style={{ height: `${v ? Math.max(4, (v / m) * 100) : 2}%` }} />)}</div>;
}

function Cards({ g, st, self, feed, onCard }: { g: HubGame; st: St; self: boolean; feed: RadarEvent | null; onCard: (j: number) => void }) {
  const trpc = useTRPC();
  const inst = g.installed;
  const stats = useQuery(trpc.play.stats.queryOptions({ id: inst?.id ?? '' }, { enabled: !!inst }));
  const d = stats.data?.days ?? [];
  const a = inst?.achievements;
  const C = ({ k, children }: { k: number; children: ReactNode }) =>
    <button className={`p4-c ${st.zone === 'cards' && st.ci === k ? 'on' : ''}`} onClick={() => onCard(k)}>{children}</button>;
  return (
    <div className="p4-cards">
      <C k={0}>
        <small><Ic n="clock" /> Seu tempo</small>
        <b>{inst ? fmtPlay(inst.playMs) || '0m' : '—'}</b>
        <span>{inst ? `${plural(stats.data?.sessions ?? 0, 'sessão', 'sessões')}${inst.lastPlayed ? ` · ${ago(inst.lastPlayed)}` : ''}` : 'Ainda não jogado'}</span>
        {inst && d.length > 0 && <Bars d={d} cls="p4-mb" />}
      </C>
      <C k={1}>
        <small><Ic n="medal" /> Conquistas</small>
        <div className="p4-ring">
          <Ring p={a?.total ? a.unlocked / a.total : 0} />
          <div><b>{a?.total ? `${a.unlocked}/${a.total}` : '—'}</b><span>{a?.total ? `${Math.round((a.unlocked / a.total) * 100)}% completo` : inst?.adapter ? 'Nenhuma ainda' : 'Sem conquistas'}</span></div>
        </div>
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

function Main({ page, sk, st, rows, cname, self, catalogCount, query, setQuery, searchRef, onSearchDone, achGame, achLoading, sideGame, lib, stats, sndOn, onRow }: {
  page: Page; sk: string | undefined; st: St; rows: Row[]; cname: string; self: boolean; catalogCount: number;
  query: string; setQuery: (v: string) => void; searchRef: RefObject<HTMLInputElement | null>; onSearchDone: () => void;
  achGame: HubGame | null; achLoading: boolean; sideGame: HubGame | null; lib: HubGame[];
  stats: Map<string, { totalMs: number; sessions: number; lastPlayed: number | null; days: number[] } | undefined>; sndOn: boolean;
  onRow: (j: number) => void;
}) {
  const list = (empty: string, top = 0) => rows.length ? (
    <div className="p4-rows" style={{ height: `calc(100% - ${top}px)` }}>
      <div className="p4-mi" style={{ transform: `translateY(-${Math.max(0, st.mi - 3) * ROW_H}px)` }}>
        {rows.map((r, j) => (
          <button key={r.key} className={`p4-r ${st.zone === 'main' && j === st.mi ? 'on' : ''}`} onClick={() => onRow(j)}>
            {r.md ? <span className={`p4-md ${r.md}`}>{r.icon ? <img src={r.icon} alt="" /> : <Ic n={r.md === 'got' ? 'medal' : 'lock'} />}</span>
              : r.g ? <span className="th"><Art g={r.g} v="square" /></span> : <span />}
            <span className="tx"><span className="t">{r.t}{r.isNew && <span className="new">NOVO</span>}</span>{r.s && <span className="s">{r.s}</span>}</span>
            <span className="rt">{r.rt}</span>
          </button>
        ))}
      </div>
    </div>
  ) : <div className="p4-note">{empty}</div>;

  if (page === 'cat') {
    if (sk === 'search') return (
      <>
        <SearchBox ref={searchRef} value={query} onChange={setQuery} nav={false} className="p4-search" placeholder="Nome do jogo…" onDone={onSearchDone} />
        {query.trim() ? list(`Nada encontrado para “${query.trim()}”.`, 100) : <div className="p4-note">Digite o nome de um jogo de {cname}.</div>}
      </>
    );
    return list(catalogCount ? 'Nada nesta categoria.' : `O catálogo ainda não tem recomps para ${cname}.${self ? '' : ' O radar avisa quando aparecer o primeiro.'}`);
  }
  if (page === 'news') return list('Nada novo por aqui. O Cartucho confere o Recompendium toda vez que abre.');
  if (page === 'ach') {
    if (!achGame) return <div className="p4-note">Nenhum jogo instalado em {cname}. As conquistas aparecem aqui quando você instalar ou adicionar um jogo.</div>;
    if (!achGame.installed?.adapter) return <div className="p4-note">O Cartucho ainda não sabe ler as conquistas de {achGame.title}. Quando houver um leitor para este port, elas aparecem aqui sozinhas.</div>;
    if (!rows.length) return <div className="p4-note">{achLoading ? 'Lendo as conquistas…' : 'Nenhuma conquista encontrada.'}</div>;
    const got = rows.filter(r => r.md === 'got').length;
    return (
      <>
        <div className="p4-ah"><b>{got}/{rows.length}</b><span>{Math.round((got / rows.length) * 100)}% completo</span><div className="p4-pb"><i style={{ width: `${(got / rows.length) * 100}%` }} /></div></div>
        {list('', 110)}
      </>
    );
  }
  if (page === 'time') {
    if (!lib.length) return <div className="p4-note">Nenhum jogo instalado ainda. O tempo começa a contar quando você abre um jogo por aqui.</div>;
    if (!sideGame) {
      const total = lib.reduce((a, x) => a + (x.installed?.playMs ?? 0), 0);
      const week = lib.reduce((a, x) => a + (stats.get(x.key)?.days.slice(7).reduce((p, q) => p + q, 0) ?? 0), 0) * 3600_000;
      const ses = lib.reduce((a, x) => a + (stats.get(x.key)?.sessions ?? 0), 0);
      const mx = Math.max(...lib.map(x => x.installed?.playMs ?? 0), 1);
      return (
        <>
          <div className="p4-big">
            <div className="p4-bg"><b>{fmtPlay(total) || '0m'}</b><span>neste console</span></div>
            <div className="p4-bg"><b>{fmtPlay(week) || '0m'}</b><span>nesta semana</span></div>
            <div className="p4-bg"><b>{ses}</b><span>{ses === 1 ? 'sessão' : 'sessões'}</span></div>
            <div className="p4-bg"><b>{lib.length}</b><span>{lib.length === 1 ? 'jogo' : 'jogos'}</span></div>
          </div>
          <div className="p4-tl">{lib.slice(0, 5).map(x => (
            <div key={x.key} className="p4-r flat">
              <span className="th"><Art g={x} v="square" /></span>
              <span className="tx"><span className="t">{x.title}</span><span className="p4-pb"><i style={{ width: `${((x.installed?.playMs ?? 0) / mx) * 100}%` }} /></span></span>
              <span className="rt">{fmtPlay(x.installed?.playMs ?? 0) || '0m'}</span>
            </div>
          ))}</div>
        </>
      );
    }
    const t = stats.get(sideGame.key), inst = sideGame.installed!;
    const d = t?.days ?? Array(14).fill(0), week = d.slice(7).reduce((a, b) => a + b, 0) * 3600_000;
    return (
      <>
        <div className="p4-big">
          <div className="p4-bg"><b>{fmtPlay(inst.playMs) || '0m'}</b><span>tempo total</span></div>
          <div className="p4-bg"><b>{inst.lastPlayed ? ago(inst.lastPlayed) : '—'}</b><span>última vez</span></div>
          <div className="p4-bg"><b>{t?.sessions ?? 0}</b><span>sessões</span></div>
          <div className="p4-bg"><b>{t?.sessions ? fmtPlay(inst.playMs / t.sessions) || '<1m' : '—'}</b><span>por sessão</span></div>
        </div>
        <div className="p4-ch"><Bars d={d} cls="b" /><div className="a"><span>14 dias atrás</span><span>{fmtPlay(week) || '0m'} nesta semana</span><span>hoje</span></div></div>
      </>
    );
  }
  if (page === 'cfg') {
    if (sk === 'dir') return <><div className="p4-note">Onde o Cartucho instala os jogos que você baixa por aqui. Jogos que você adiciona com “Escolher pasta” continuam onde estão.</div><div className="p4-form"><label>Pasta atual</label><div><PortsDir /></div></div></>;
    if (sk === 'snd') return <div className="p4-note">Sons da interface: {sndOn ? 'ligados' : 'desligados'}. Confirme para {sndOn ? 'desligar' : 'ligar'}.</div>;
    if (sk === 'radar') return <div className="p4-note">O radar confere o catálogo do Recompendium e os releases do GitHub toda vez que o Cartucho abre e avisa quando algo muda em {cname}.</div>;
    return <div className="p4-note">Sai deste console e volta para o palco do Cartucho.</div>;
  }
  return null;
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
    <div className="p4-gpage">
      <div className="p4-gscroll" ref={scrollRef} onScroll={check}>
        <div className="p4-ghero">
          {bg && <div className="p4-gbg"><img src={bg} alt="" /></div>}
          <div className="p4-gcv"><Art g={g} v="square" /></div>
          <div className="p4-ghead">
            <h1>{g.title}</h1>
            <p className="meta">
              {[g.status && STATUS_LABEL[g.status], g.catalog?.developer, g.catalog?.year, g.platformName].filter(Boolean).join(' · ')}
            </p>
            <p className="meta dim">
              {[inst ? (inst.running ? 'jogando agora' : inst.playMs ? `${fmtPlay(inst.playMs)} jogadas` : 'ainda não jogado') : 'não instalado',
                inst?.achievements?.total ? `${inst.achievements.unlocked}/${inst.achievements.total} conquistas` : null].filter(Boolean).join(' · ')}
            </p>
            {inst?.missing && <p className="warn">A pasta do jogo não foi encontrada em {inst.installDir}. {g.catalog?.repo && !self ? 'Instale de novo ou mostre onde ele está agora.' : 'Mostre onde ele está agora.'}</p>}
            {p && <p className="prog">{p.error ?? `${p.stage}${p.pct > 0 && p.pct < 1 ? ` · ${Math.round(p.pct * 100)}%` : ''}`}</p>}
            <div className="p4-acts">{opts.map((o, j) => (
              <button key={o.k + j} className={`p4-b ${j === 0 ? 'pri' : ''} ${st.zone === 'gacts' && st.ai === j ? 'on' : ''}`} onClick={() => onAct(j)}>
                <Ic n={o.ic} />{o.l}
              </button>
            ))}</div>
          </div>
        </div>
        <div className="p4-gbody">
          <section className="p4-gsec">
            <h4>Imagens</h4>
            {shots.length ? <div className="p4-gshots">{shots.map((u, j) => (
              <button key={u} className={st.zone === 'gshots' && st.gs === j ? 'on' : ''} onClick={() => onShot(j)}><img src={u} alt="" /></button>
            ))}</div> : <p className="dim">Sem capturas de tela no LaunchBox para este jogo.</p>}
          </section>
          <section className={`p4-gsec text ${st.zone === 'gtext' ? 'on' : ''}`}>
            {about.text && <><h4>Sobre</h4><p>{about.text}</p></>}
            {needs.text && <><h4>O que você precisa</h4><p>{needs.text}</p></>}
            {self && !inst && <p className="dim">{SELF_INSTALL_NOTE}</p>}
            {!about.text && !needs.text && <p className="dim">O catálogo não traz descrição deste jogo.</p>}
            {(about.auto || needs.auto) && <small>Traduzido automaticamente do inglês</small>}
          </section>
        </div>
      </div>
      <div className={`p4-gmore ${more ? 'on' : ''}`}><Ic n="down" /></div>
    </div>
  );
}

function PortsDir() {
  const trpc = useTRPC();
  const q = useQuery(trpc.settings.portsDir.queryOptions());
  return <>{q.data ?? '…'}</>;
}
