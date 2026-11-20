import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AchievementView, ConsoleId, PlayStats, RadarEvent } from '@shared/types';
import { isSelfInstall, SELF_INSTALL_NOTE, STATUS_LABEL } from '@shared/consoles';
import { useTRPC } from '../trpc';
import { Glyph, useKeys, type Key } from '../lib/input';
import { getSettings, reduceMotion, setSettings, useSettings } from '../lib/settings';
import { setSfxProfile, sfx } from '../lib/sfx';
import { ago, fmtDate, fmtPlay, plural } from '../lib/format';
import { matchesQuery } from '../lib/search';
import { useArt, useShots } from '../lib/art';
import { useTranslated } from '../lib/translate';
import { GameArt } from '../components/GameArt';
import { SearchBox } from '../components/SearchBox';
import { CONSOLES } from '../stage/consoles';
import { BootOverlay, Fit, useClock, useDeviceStatus, useHubToast } from './HubFrame';
import { Ic, type IconName } from './icons';
import { useGameProgress, useHubActions, useHubData, type HubGame } from './data';

type Cat = 'games' | 'cat' | 'news' | 'ach' | 'time' | 'cfg';
type Kind = 'game' | 'search' | 'empty' | 'ach' | 'sum' | 'time' | 'theme' | 'dir' | 'snd' | 'radar' | 'off';
type Tag = 'new' | 'upd' | 'up';
interface It { key: string; kind: Kind; g?: HubGame; ic?: IconName; t: string; s: string; tag?: Tag }
type Zone = 'gacts' | 'gshots' | 'gtext';
interface St { ci: number; ii: number[]; opt: boolean; oi: number; list: boolean; li: number; dir: 'up' | 'down'; game: string | null; zone: Zone; ai: number; gs: number }
type Opt = { k: string; l: string; ic: IconName };
type Hint = [Parameters<typeof Glyph>[0]['a'], string];

const CATS: [Cat, string, IconName][] = [
  ['games', 'Jogos', 'pad'], ['cat', 'Descobrir', 'compass'], ['news', 'Novidades', 'bell'],
  ['ach', 'Conquistas', 'medal'], ['time', 'Tempo de jogo', 'clock'], ['cfg', 'Ajustes', 'gear'],
];
const THEMES: [string, number, boolean?][] = [['Violeta', 255], ['Azul', 215], ['Verde-água', 175], ['Vinho', 335], ['Âmbar', 30], ['Grafite', 240, true]];
const TAGS = { new: 'Novo', upd: 'Versão nova', up: 'Mudou de status' } as const;
const FEED = { new: 'Novo no catálogo', upd: 'Versão nova', up: 'Mudou de status' } as const;
const W = 1920, H = 1080;
const waveY = (x: number) => 600 + Math.sin(x / 420 + 0.6) * 46;
const TEXT_TOP = Math.round(waveY(420) - 160);
function place(d: number): [number, number, number] {
  if (d === 0) return [300, waveY(420) - 120, 1];
  const x = d < 0 ? 300 + d * 190 - 40 : 1240 + (d - 1) * 190;
  return [x, waveY(x + 70) - 60, 0.52];
}

const Art = ({ g, v }: { g: HubGame; v: 'cover' | 'wide' | 'square' }) =>
  <GameArt title={g.title} console={g.console} platformName={g.platformName} fallback={g.coverUrl} variant={v} />;

function Waves({ psp }: { psp: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cvs = ref.current; if (!cvs) return;
    const x = cvs.getContext('2d'); if (!x) return;
    cvs.width = W; cvs.height = H;
    if (psp) {
      const still = reduceMotion();
      const yA = (px: number, t: number) => H * 0.64 + Math.sin(px / 560 + t * 0.16 + 0.8) * 95 + Math.sin(px / 230 + t * 0.27) * 16;
      const yB = (px: number, t: number) => H * 0.72 + Math.sin(px / 470 - t * 0.12 + 2.1) * 70 + Math.sin(px / 190 + t * 0.2) * 12;
      const fill = (f: (px: number, t: number) => number, t: number, g: CanvasGradient) => {
        x.beginPath(); x.moveTo(0, H);
        for (let px = 0; px <= W; px += 12) x.lineTo(px, f(px, t));
        x.lineTo(W, H); x.closePath(); x.fillStyle = g; x.fill();
      };
      let raf = 0;
      const frame = (ms: number) => {
        const t = ms / 1000;
        x.clearRect(0, 0, W, H);
        let g = x.createLinearGradient(0, H * 0.5, 0, H); g.addColorStop(0, 'rgba(110,225,255,.55)'); g.addColorStop(1, 'rgba(70,235,255,.9)'); fill(yA, t, g);
        g = x.createLinearGradient(0, H * 0.6, 0, H); g.addColorStop(0, 'rgba(255,255,255,.14)'); g.addColorStop(1, 'rgba(255,255,255,.05)'); fill(yB, t, g);
        x.beginPath();
        for (let px = 0; px <= W; px += 10) { const y = yA(px, t); if (px) x.lineTo(px, y); else x.moveTo(px, y); }
        x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = 3; x.shadowColor = 'rgba(255,255,255,.8)'; x.shadowBlur = 18; x.stroke(); x.shadowBlur = 0;
        if (!still) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      return () => cancelAnimationFrame(raf);
    }
    const P = Array.from({ length: 150 }, () => ({ x: Math.random() * W, o: (Math.random() - 0.5) * 220, v: 8 + Math.random() * 26, r: 0.6 + Math.random() * 2.2, p: Math.random() * 6 }));
    const still = reduceMotion();
    const band = (t: number, k: number) => (px: number) => waveY(px) + 40 + Math.sin(px / (300 + k * 90) + t * (0.18 + k * 0.05) + k * 1.7) * (70 - k * 10) + Math.sin(px / 140 + t * 0.4 + k) * 10;
    let raf = 0;
    const frame = (ms: number) => {
      const t = ms / 1000;
      x.clearRect(0, 0, W, H);
      for (let k = 0; k < 4; k++) {
        const a = band(t, k), b = band(t * 1.1 + 2, k + 0.5);
        x.beginPath();
        for (let px = 0; px <= W; px += 16) x.lineTo(px, a(px));
        for (let px = W; px >= 0; px -= 16) x.lineTo(px, b(px) + 30 + k * 12);
        const gr = x.createLinearGradient(0, 0, W, 0);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.35, `rgba(255,255,255,${0.07 + k * 0.02})`); gr.addColorStop(1, `rgba(255,255,255,${0.03 + k * 0.01})`);
        x.fillStyle = gr; x.fill();
      }
      for (let k = 0; k < 7; k++) {
        const f = band(t * (1 + k * 0.07), k * 0.6);
        x.beginPath(); x.strokeStyle = `rgba(255,255,255,${0.12 + (k % 3) * 0.1})`; x.lineWidth = k % 3 === 0 ? 2 : 1;
        for (let px = 0; px <= W; px += 12) { const y = f(px) + k * 7; if (px) x.lineTo(px, y); else x.moveTo(px, y); }
        x.stroke();
      }
      const base = band(t, 1);
      for (const p of P) {
        if (!still) p.x = (p.x + p.v / 60) % W;
        const y = base(p.x) + p.o * (0.4 + 0.6 * Math.abs(Math.sin(p.x / 500)));
        x.beginPath(); x.fillStyle = `rgba(255,255,255,${0.25 + 0.55 * Math.abs(Math.sin(t * 1.4 + p.p))})`; x.arc(p.x, y, p.r, 0, 7); x.fill();
      }
      if (!still) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [psp]);
  return <canvas ref={ref} className="p3-cv" />;
}

export function PS3Hub({ id, game: game0, tab, onBack }: { id: ConsoleId; game?: string; tab?: 'lib' | 'cat'; onBack: () => void }) {
  const c = CONSOLES.find(x => x.id === id)!;
  const psp = id === 'psp';
  const dev = useDeviceStatus();
  const self = isSelfInstall(id);
  const data = useHubData(id);
  const act = useHubActions();
  const trpc = useTRPC(), qc = useQueryClient();
  const s = useSettings();
  const [toast, show] = useHubToast();
  const [st, set] = useState<St>(() => ({ ci: tab === 'cat' ? 1 : 0, ii: CATS.map(() => 0), opt: false, oi: 0, list: false, li: 0, dir: 'down', game: null, zone: 'gacts', ai: 0, gs: 0 }));
  const up = (p: Partial<St>) => set(x => ({ ...x, ...p }));
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const gScroll = useRef<HTMLDivElement>(null);
  const clock = useClock();
  const pickDir = useMutation(trpc.settings.pickPortsDir.mutationOptions({ onSuccess: d => { qc.setQueryData(trpc.settings.portsDir.queryKey(), d); show('Pasta dos jogos alterada'); } }));
  const chooseExe = useMutation(trpc.games.chooseExe.mutationOptions({ onSuccess: () => void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }) }));
  const openFolder = useMutation(trpc.games.openFolder.mutationOptions());

  useEffect(() => { setSfxProfile('soft'); const t = setTimeout(() => sfx.play('boot'), 150); return () => clearTimeout(t); }, []);
  useEffect(() => { if (act.error) { show(act.error); act.reset(); } }, [act.error]);
  const focusSearch = () => setTimeout(() => searchRef.current?.focus(), 60);
  useEffect(() => {
    const go = () => { sfx.play('ok'); set(x => ({ ...x, game: null, opt: false, list: false, dir: x.ci > 1 ? 'up' : 'down', ci: 1, ii: x.ii.map((v, i) => (i === 1 ? 0 : v)) })); focusSearch(); };
    addEventListener('cartucho:search', go);
    return () => removeEventListener('cartucho:search', go);
  }, []);

  const lib = data.lib;
  useEffect(() => {
    if (!game0) return;
    const i = lib.findIndex(g => g.key === game0 || g.catalog?.id === game0);
    if (i >= 0) set(x => ({ ...x, ii: x.ii.map((v, j) => (j === 0 ? i : v)) }));
  }, [game0, lib.length]);
  const byPlay = useMemo(() => [...lib].sort((a, b) => (b.installed?.playMs ?? 0) - (a.installed?.playMs ?? 0)), [lib]);
  const all = useMemo(() => new Map([...data.lib, ...data.catalog].flatMap(x => [[x.key, x] as const, ...(x.installed && x.catalog ? [[x.catalog.id, x] as const] : [])])), [data.lib, data.catalog]);
  const feedGame = (f: RadarEvent) => data.catalog.find(y => y.catalog?.id === f.gameId) ?? null;
  const found = useMemo(() => query.trim() ? [...data.catalog, ...data.lib.filter(x => !x.catalog)].filter(x => matchesQuery(query, x.title, x.platformName, x.catalog?.developer)) : data.catalog, [data.catalog, data.lib, query]);

  const playLine = (g: HubGame) => {
    const i = g.installed;
    if (!i) return g.isNew ? 'Novo no catálogo · não instalado' : 'Não instalado';
    if (i.missing) return 'Pasta do jogo não encontrada';
    if (i.running) return 'Jogando agora';
    return i.playMs ? `${fmtPlay(i.playMs)} jogadas${i.lastPlayed ? ` · ${ago(i.lastPlayed)}` : ''}` : 'Ainda não jogado';
  };
  const itemsOf = (k: Cat): It[] => {
    let L: It[] = [];
    if (k === 'games') {
      L = lib.map(g => ({ key: g.key, kind: 'game', g, t: g.title, s: playLine(g), tag: g.update?.updateAvailable && !self ? 'upd' : g.isNew ? 'new' : undefined }));
      if (!L.length) L = [{ key: 'empty', kind: 'empty', ic: 'compass', t: 'Nenhum jogo instalado', s: data.catalog.length ? `${plural(data.catalog.length, 'recomp', 'recomps')} de ${c.name} em Descobrir` : `Ainda não há recomps de ${c.name} no catálogo` }];
    }
    if (k === 'cat') {
      L = [{ key: 'search', kind: 'search', ic: 'search', t: 'Buscar', s: query.trim() ? `“${query.trim()}” · ${plural(found.length, 'resultado', 'resultados')}` : 'Procure um jogo pelo nome' },
        ...found.map(g => ({ key: g.key, kind: 'game' as Kind, g, t: g.title, s: `${g.status ? STATUS_LABEL[g.status] : ''}${g.installed ? ' · Instalado' : self ? ' · Você instala' : ''}`, tag: g.isNew ? 'new' as Tag : undefined }))];
    }
    if (k === 'news') {
      L = data.feed.map(f => { const g = feedGame(f); return { key: String(f.id), kind: 'game' as Kind, g: g ?? undefined, ic: 'bell' as IconName, t: f.title, s: `${FEED[f.kind]}${f.detail && !(self && f.kind === 'new') ? ` · ${f.detail}` : ''} · ${ago(f.at)}`, tag: f.kind }; });
      if (!L.length) L = [{ key: 'empty', kind: 'empty', ic: 'bell', t: 'Nada novo por aqui', s: 'O Cartucho confere o Recompendium toda vez que abre' }];
    }
    if (k === 'ach') {
      L = lib.map(g => { const a = g.installed?.achievements; return { key: g.key, kind: 'ach' as Kind, g, t: g.title, s: a?.total ? `${a.unlocked}/${a.total} conquistas · ${Math.round((a.unlocked / a.total) * 100)}%` : g.installed?.adapter ? 'Nenhuma conquista ainda' : 'O Cartucho ainda não lê as conquistas deste port' }; });
      if (!L.length) L = [{ key: 'empty', kind: 'empty', ic: 'medal', t: 'Nenhum jogo instalado', s: 'As conquistas aparecem aqui quando você instalar ou adicionar um jogo' }];
    }
    if (k === 'time') {
      const tot = lib.reduce((a, g) => a + (g.installed?.playMs ?? 0), 0);
      L = lib.length ? [{ key: 'sum', kind: 'sum', ic: 'chart', t: 'Resumo', s: `${fmtPlay(tot) || '0m'} neste console · ${plural(lib.length, 'jogo', 'jogos')}` },
        ...byPlay.map(g => ({ key: g.key, kind: 'time' as Kind, g, t: g.title, s: playLine(g) }))]
        : [{ key: 'empty', kind: 'empty', ic: 'clock', t: 'Nenhuma sessão ainda', s: 'O tempo começa a contar quando você abre um jogo por aqui' }];
    }
    if (k === 'cfg') L = [
      { key: 'theme', kind: 'theme', ic: 'star', t: 'Tema de cor', s: THEMES[themeIdx]![0] },
      { key: 'dir', kind: 'dir', ic: 'folder', t: 'Pasta dos jogos', s: 'Onde o Cartucho instala o que você baixa' },
      { key: 'snd', kind: 'snd', ic: 'sound', t: 'Sons da interface', s: s.snd ? 'Ligados' : 'Desligados' },
      { key: 'radar', kind: 'radar', ic: 'bell', t: 'Radar de novidades', s: 'Confere o catálogo toda vez que o Cartucho abre' },
      { key: 'off', kind: 'off', ic: 'power', t: 'Voltar ao Cartucho', s: 'Desliga este console' },
    ];
    return L;
  };
  const cat = CATS[st.ci]![0];
  const themeIdx = (s.xmbTheme[id] ?? (psp ? 1 : 0)) % THEMES.length;
  const items = itemsOf(cat);
  const sel = Math.min(st.ii[st.ci] ?? 0, items.length - 1);
  const it = items[sel]!;
  const g = it.g ?? null;

  const ach = useQuery(trpc.achievements.forGame.queryOptions({ id: g?.installed?.id ?? '' }, { enabled: cat === 'ach' && !!g?.installed?.adapter }));
  const achList = ach.data ? [...ach.data.list].sort((a, b) => (b.unlockedAt ?? -1) - (a.unlockedAt ?? -1)) : [];
  const statQ = useQueries({ queries: (cat === 'time' || cat === 'games' ? lib : []).map(x => trpc.play.stats.queryOptions({ id: x.installed!.id })) });
  const stats = new Map(lib.map((x, i) => [x.key, statQ[i]?.data] as const));

  const game = st.game ? all.get(st.game) ?? null : null;
  const shots = useShots(game?.console, game?.title ?? '', game?.platformName);
  const [view, setView] = useState<number | null>(null);
  useEffect(() => {
    const el = gScroll.current; if (!el || !game) return;
    if (st.zone === 'gacts') el.scrollTo({ top: 0, behavior: 'smooth' });
    else if (st.zone === 'gshots') el.querySelector('.p3-gshots')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    else el.querySelector('.p3-gsec.text')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [st.zone, !!game]);

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
  const goCat = (ci: number, ii?: number) => {
    if (ci === st.ci && ii == null) return;
    sfx.play('move');
    set(x => ({ ...x, dir: ci > x.ci ? 'down' : 'up', ci, opt: false, list: false, li: 0, ii: ii == null ? x.ii : x.ii.map((v, j) => (j === ci ? ii : v)) }));
  };
  const openGame = (x: HubGame) => { setView(null); up({ game: x.key, opt: false, zone: 'gacts', ai: 0, gs: 0 }); };

  const run = (k: string, x: HubGame) => {
    up({ opt: false });
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
    if (k === 'ach') { up({ game: null }); return goCat(3, Math.max(0, lib.indexOf(x))); }
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
    switch (it.kind) {
      case 'game': if (g) run(primaryOf(g).k, g); return;
      case 'search': sfx.play('ok'); searchRef.current?.focus(); return;
      case 'empty': if (cat === 'games' && data.catalog.length) goCat(1); return;
      case 'ach': if (achList.length) { sfx.play('ok'); up({ list: !st.list, li: 0 }); } return;
      case 'time': if (g) { sfx.play('ok'); openGame(g); } return;
      case 'theme': sfx.play('ok'); return setSettings({ xmbTheme: { ...getSettings().xmbTheme, [id]: (themeIdx + 1) % THEMES.length } });
      case 'dir': sfx.play('ok'); return pickDir.mutate();
      case 'snd': sfx.play('ok'); return setSettings({ snd: !getSettings().snd });
      case 'radar': sfx.play('ok'); return show('O radar confere o catálogo do Recompendium toda vez que o Cartucho abre');
      case 'off': sfx.play('back'); return onBack();
    }
  };
  const back = () => {
    sfx.play('back');
    if (view != null) return setView(null);
    if (game) return up({ game: null });
    if (st.opt) return up({ opt: false });
    if (st.list) return up({ list: false });
    if (query && cat === 'cat') { setQuery(''); return; }
    onBack();
  };

  useKeys((k: Key) => {
    if (k === 'Escape') return back();
    const R = k === 'ArrowRight', L = k === 'ArrowLeft', U = k === 'ArrowUp', D = k === 'ArrowDown';
    const mv = (p: Partial<St>) => { sfx.play('move'); up(p); };
    if (view != null) {
      if (k === 'Enter') { sfx.play('back'); return setView(null); }
      if (R && view < shots.length - 1) { sfx.play('move'); setView(view + 1); } else if (L && view > 0) { sfx.play('move'); setView(view - 1); }
      return;
    }
    if (k === 'Enter') return enter();
    if (game) {
      const el = gScroll.current, z = st.zone;
      if (z === 'gacts') { if (R && st.ai < gameOpts.length - 1) mv({ ai: st.ai + 1 }); else if (L && st.ai > 0) mv({ ai: st.ai - 1 }); else if (D) mv({ zone: shots.length ? 'gshots' : 'gtext', gs: 0 }); return; }
      if (z === 'gshots') { if (R && st.gs < shots.length - 1) mv({ gs: st.gs + 1 }); else if (L && st.gs > 0) mv({ gs: st.gs - 1 }); else if (U) mv({ zone: 'gacts' }); else if (D) mv({ zone: 'gtext' }); return; }
      if (D) { sfx.play('move'); el?.scrollBy({ top: 260, behavior: 'smooth' }); }
      else if (U) { if (!el || el.scrollTop <= 4 || (shots.length && el.scrollTop <= 400)) mv({ zone: shots.length ? 'gshots' : 'gacts' }); else { sfx.play('move'); el.scrollBy({ top: -260, behavior: 'smooth' }); } }
      return;
    }
    if (st.opt && g) {
      const n = options(g).length;
      if (D && st.oi < n - 1) mv({ oi: st.oi + 1 }); else if (U && st.oi > 0) mv({ oi: st.oi - 1 });
      return;
    }
    if (st.list) {
      if (D && st.li < achList.length - 1) mv({ li: st.li + 1 }); else if (U && st.li > 0) mv({ li: st.li - 1 });
      return;
    }
    if (k === 'X' || k === 'Y') { if (g && it.kind !== 'ach') { sfx.play('ok'); up({ opt: true, oi: 0 }); } return; }
    if (R && sel < items.length - 1) return mv({ ii: st.ii.map((v, j) => (j === st.ci ? sel + 1 : v)) });
    if (L && sel > 0) return mv({ ii: st.ii.map((v, j) => (j === st.ci ? sel - 1 : v)) });
    if ((D || k === 'RB' || k === 'Tab') && st.ci < CATS.length - 1) return goCat(st.ci + 1);
    if ((U || k === 'LB') && st.ci > 0) return goCat(st.ci - 1);
  });

  const hints: Hint[] = game
    ? (st.zone === 'gshots' ? [['ok', 'Ampliar'], ['ud', 'Rolar'], ['back', 'Voltar']] : st.zone === 'gtext' ? [['ud', 'Rolar'], ['back', 'Voltar']] : [['ok', 'Confirmar'], ['ud', 'Rolar'], ['back', 'Voltar']])
    : st.opt || st.list ? [['ud', 'Escolher'], ['ok', st.list ? 'Fechar lista' : 'Confirmar'], ['back', 'Fechar']]
    : [['lr', 'Item'], ['ud', 'Categoria'], ['back', 'Sair']];
  const theme = THEMES[themeIdx]!;
  const date = new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'numeric' });

  return (
    <section className="view hub sk-p3" style={{ ['--cc' as string]: c.color }}>
      <Fit w={1920} h={1080} className={`p3 ${psp ? 'psp' : ''}`} style={{ ['--cc' as string]: c.color, ['--h' as string]: theme[1], filter: theme[2] ? 'saturate(.15)' : undefined }}>
        <div className={`p3-wv ${game ? 'dim' : ''}`}><Waves psp={psp} /></div>
        {game ? (
          <GamePage g={game} st={st} opts={gameOpts} shots={shots} self={self} scrollRef={gScroll}
            onAct={j => { if (st.zone === 'gacts' && st.ai === j) enter(); else { sfx.play('move'); up({ zone: 'gacts', ai: j }); } }}
            onShot={j => { sfx.play('ok'); up({ zone: 'gshots', gs: j }); setView(j); }} />
        ) : (
          <>
            <nav className="p3-cats">{CATS.map(([k, l, ic], i) => (
              <button key={k} className={i === st.ci ? 'on' : ''} onClick={() => goCat(i)}>
                <Ic n={ic} />{l}{k === 'news' && data.feed.length > 0 && <span className="n">{data.feed.length}</span>}
              </button>
            ))}</nav>
            {psp ? (
              <div className="p3-st psp">
                {data.feed.length > 0 && <span className="r"><i />{data.feed.length}</span>}
                <span>{date} {clock}</span>
                {dev.batt && <span className="bt"><Ic n="batt" /><i style={{ width: Math.round(dev.batt.level * 33) }} /></span>}
              </div>
            ) : (
              <div className="p3-st">
                <span className="av"><Ic n="pad" /></span><span>Cartucho</span>
                {data.feed.length > 0 && <span className="r"><i />{data.feed.length}</span>}
                <span className="sp" /><span>{date} {clock}</span>
              </div>
            )}
            <div className={`p3-rib in-${st.dir}`} key={cat}>
              {items.map((x, i) => {
                const d = i - sel, [px, py, sc] = place(d), on = d === 0;
                const off = cat === 'games' && x.g && !x.g.installed;
                return (
                  <button key={x.key} className={`p3-it ${on ? 'on' : ''} ${x.g?.installed?.missing ? 'missing' : ''}`} aria-label={x.t}
                    style={{ transform: `translate(${px}px, ${py}px) scale(${sc})`, opacity: d < -2 || d > 4 ? 0 : d < 0 ? 0.4 : on ? 1 : 0.8 }}
                    onClick={() => { if (on) enter(); else { sfx.play('move'); up({ opt: false, list: false, ii: st.ii.map((v, j) => (j === st.ci ? i : v)) }); } }}>
                    <div className={`p3-gl ${x.g ? '' : 'icon'}`}>{x.g ? <Art g={x.g} v="square" /> : <Ic n={x.ic ?? 'info'} />}</div>
                    {off && <span className="dl"><Ic n="dl" /></span>}
                    {x.g?.installed?.running && <span className="dl run"><Ic n="play" /></span>}
                    {x.tag && <span className={`tg ${x.tag}`}>{TAGS[x.tag]}</span>}
                  </button>
                );
              })}
            </div>
            <div className="p3-tx" key={`${cat}-${it.key}`} style={{ top: TEXT_TOP }}>
              <h1>{it.t}</h1>
              <p>{it.s}</p>
              <Detail it={it} cat={cat} st={st} self={self} opts={g ? options(g) : []} primary={g ? primaryOf(g).l : ''}
                stats={g ? stats.get(g.key) : undefined} lib={byPlay} achList={achList} achLoading={ach.isLoading} theme={theme[0]} sndOn={s.snd}
                query={query} setQuery={setQuery} searchRef={searchRef}
                onSearchDone={() => { if (found.length) { sfx.play('move'); up({ ii: st.ii.map((v, j) => (j === 1 ? 1 : v)) }); } }}
                onOpt={j => { if (st.opt && st.oi === j) enter(); else { sfx.play('move'); up({ opt: true, oi: j }); } }} />
            </div>
          </>
        )}
        <div className={`p3-hn ${game ? 'top' : ''}`}>{hints.map(([a, t]) => <span key={a + t}><Glyph a={a} />{t}</span>)}</div>
        {view != null && shots[view] && (
          <div className="p3-view" onClick={() => setView(null)}>
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

function Bars({ d, week }: { d: number[]; week: number }) {
  const m = Math.max(...d, 0.01);
  return (
    <div className="p3-ch">
      <div className="b">{d.map((v, j) => <i key={j} className={v ? '' : 'z'} style={{ height: `${v ? Math.max(4, (v / m) * 100) : 2}%` }} />)}</div>
      <div className="a"><span>14 dias atrás</span><span>{fmtPlay(week) || '0m'} nesta semana</span><span>hoje</span></div>
    </div>
  );
}

function Detail({ it, cat, st, self, opts, primary, stats, lib, achList, achLoading, theme, sndOn, query, setQuery, searchRef, onSearchDone, onOpt }: {
  it: It; cat: Cat; st: St; self: boolean; opts: Opt[]; primary: string;
  stats: PlayStats | undefined; lib: HubGame[]; achList: AchievementView[]; achLoading: boolean;
  theme: string; sndOn: boolean; query: string; setQuery: (v: string) => void; searchRef: RefObject<HTMLInputElement | null>; onSearchDone: () => void; onOpt: (j: number) => void;
}) {
  const g = it.g;
  const needs = useTranslated(cat === 'cat' || cat === 'news' ? g?.catalog?.needs : undefined);
  const p = useGameProgress(g ?? null);
  if (it.kind === 'search') return (
    <>
      <SearchBox ref={searchRef} value={query} onChange={setQuery} nav={false} className="p3-search" placeholder="Nome do jogo…" onDone={onSearchDone} />
      <div className="hint"><span><Glyph a="ok" />Digitar</span>{query && <span><Glyph a="back" />Limpar</span>}</div>
    </>
  );
  if (it.kind === 'game' && g) return (
    <>
      {p && <p className="prog">{p.error ?? `${p.stage}${p.pct > 0 && p.pct < 1 ? ` · ${Math.round(p.pct * 100)}%` : ''}`}</p>}
      <div className="hint"><span><Glyph a="ok" />{primary}</span><span><Glyph a="x" />Opções</span></div>
      {st.opt ? (
        <div className="p3-opt">{opts.map((o, j) => <button key={o.k + j} className={j === st.oi ? 'on' : ''} onClick={() => onOpt(j)}><Ic n={o.ic} />{o.l}</button>)}</div>
      ) : g.installed && stats && cat === 'games' ? (
        <Bars d={stats.days} week={stats.days.slice(7).reduce((a, b) => a + b, 0) * 3600_000} />
      ) : (cat === 'cat' || cat === 'news') ? (
        <dl className="p3-kv">
          {g.catalog?.developer && <><dt>Estúdio</dt><dd>{g.catalog.developer}{g.catalog.year ? ` · ${g.catalog.year}` : ''}</dd></>}
          <dt>Status</dt><dd>{g.status ? STATUS_LABEL[g.status] : '—'}</dd>
          {needs.text && <><dt>Precisa</dt><dd className="clamp">{needs.text}</dd></>}
          {self && !g.installed && <><dt>Instalação</dt><dd className="clamp">{SELF_INSTALL_NOTE}</dd></>}
        </dl>
      ) : null}
    </>
  );
  if (it.kind === 'ach' && g) {
    if (!g.installed?.adapter) return null;
    if (!achList.length) return <p className="dim">{achLoading ? 'Lendo as conquistas…' : 'Nenhuma conquista encontrada.'}</p>;
    const got = achList.filter(x => x.unlockedAt != null).length, off = Math.max(0, Math.min(st.li - 2, achList.length - 5));
    return (
      <>
        <div className="p3-pb"><i style={{ width: `${(got / achList.length) * 100}%` }} /></div>
        {!st.list && <div className="hint"><span><Glyph a="ok" />Ver lista</span></div>}
        <div className={`p3-al ${st.list ? 'open' : ''}`}>{achList.slice(off, off + 5).map((x, j) => (
          <div key={x.id} className={`p3-a ${st.list && off + j === st.li ? 'on' : ''} ${x.unlockedAt != null ? 'got' : 'lock'}`}>
            <span className="md">{x.icon ? <img src={x.icon} alt="" /> : <Ic n={x.unlockedAt != null ? 'medal' : 'lock'} />}</span>
            <span className="tx"><b>{x.name}</b><small>{x.description}</small></span>
            <span className="v">{x.unlockedAt != null ? fmtDate(x.unlockedAt) : 'Bloqueada'}</span>
          </div>
        ))}</div>
      </>
    );
  }
  if (it.kind === 'time' && g) {
    if (!stats) return null;
    return (
      <>
        <dl className="p3-kv">
          <dt>Sessões</dt><dd>{stats.sessions}{stats.sessions ? ` · ${fmtPlay(g.installed!.playMs / stats.sessions) || '<1m'} por sessão` : ''}</dd>
        </dl>
        <Bars d={stats.days} week={stats.days.slice(7).reduce((a, b) => a + b, 0) * 3600_000} />
        <div className="hint"><span><Glyph a="ok" />Página do jogo</span></div>
      </>
    );
  }
  if (it.kind === 'sum') {
    const mx = Math.max(...lib.map(x => x.installed?.playMs ?? 0), 1);
    return (
      <div className="p3-tl">{lib.slice(0, 6).map(x => (
        <div key={x.key}><span className="t">{x.title}</span><span className="bar"><i style={{ width: `${((x.installed?.playMs ?? 0) / mx) * 100}%` }} /></span><span className="v">{fmtPlay(x.installed?.playMs ?? 0) || '0m'}</span></div>
      ))}</div>
    );
  }
  if (it.kind === 'theme') return <div className="hint"><span><Glyph a="ok" />Trocar · {theme}</span></div>;
  if (it.kind === 'snd') return <div className="hint"><span><Glyph a="ok" />{sndOn ? 'Desligar' : 'Ligar'}</span></div>;
  if (it.kind === 'dir') return <><dl className="p3-kv"><dt>Pasta</dt><dd className="path"><PortsDir /></dd></dl><div className="hint"><span><Glyph a="ok" />Trocar pasta</span></div></>;
  if (it.kind === 'off') return <div className="hint"><span><Glyph a="ok" />Desligar</span></div>;
  if (it.kind === 'empty' && cat === 'games') return <div className="hint"><span><Glyph a="ok" />Abrir Descobrir</span></div>;
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
    <div className="p3-gpage">
      <div className="p3-gscroll" ref={scrollRef} onScroll={check}>
        <div className="p3-ghero">
          {bg && <div className="p3-gbg"><img src={bg} alt="" /></div>}
          <div className="p3-gcv"><div className="p3-gl"><Art g={g} v="square" /></div></div>
          <div className="p3-ghead">
            <h1>{g.title}</h1>
            <p className="meta">{[g.status && STATUS_LABEL[g.status], g.catalog?.developer, g.catalog?.year, g.platformName].filter(Boolean).join(' · ')}</p>
            <p className="meta soft">
              {[inst ? (inst.running ? 'jogando agora' : inst.playMs ? `${fmtPlay(inst.playMs)} jogadas` : 'ainda não jogado') : 'não instalado',
                inst?.achievements?.total ? `${inst.achievements.unlocked}/${inst.achievements.total} conquistas` : null].filter(Boolean).join(' · ')}
            </p>
            {inst?.missing && <p className="warn">A pasta do jogo não foi encontrada em {inst.installDir}. {g.catalog?.repo && !self ? 'Instale de novo ou mostre onde ele está agora.' : 'Mostre onde ele está agora.'}</p>}
            {p && <p className="prog">{p.error ?? `${p.stage}${p.pct > 0 && p.pct < 1 ? ` · ${Math.round(p.pct * 100)}%` : ''}`}</p>}
            <div className="p3-acts">{opts.map((o, j) => (
              <button key={o.k + j} className={`p3-b ${st.zone === 'gacts' && st.ai === j ? 'on' : ''}`} onClick={() => onAct(j)}><Ic n={o.ic} />{o.l}</button>
            ))}</div>
          </div>
        </div>
        <div className="p3-gbody">
          <section className="p3-gsec">
            <h4>Imagens</h4>
            {shots.length ? <div className="p3-gshots">{shots.map((u, j) => (
              <button key={u} className={st.zone === 'gshots' && st.gs === j ? 'on' : ''} onClick={() => onShot(j)}><img src={u} alt="" /></button>
            ))}</div> : <p className="soft">Sem capturas de tela no LaunchBox para este jogo.</p>}
          </section>
          <section className={`p3-gsec text ${st.zone === 'gtext' ? 'on' : ''}`}>
            {about.text && <><h4>Sobre</h4><p>{about.text}</p></>}
            {needs.text && <><h4>O que você precisa</h4><p>{needs.text}</p></>}
            {self && !inst && <p className="soft">{SELF_INSTALL_NOTE}</p>}
            {!about.text && !needs.text && <p className="soft">O catálogo não traz descrição deste jogo.</p>}
            {(about.auto || needs.auto) && <small>Traduzido automaticamente do inglês</small>}
          </section>
        </div>
      </div>
      <div className={`p3-gmore ${more ? 'on' : ''}`}><Ic n="down" /></div>
    </div>
  );
}

function PortsDir() {
  const trpc = useTRPC();
  const q = useQuery(trpc.settings.portsDir.queryOptions());
  return <>{q.data ?? '…'}</>;
}
