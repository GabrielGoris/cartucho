import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConsoleId } from '@shared/types';
import { isSelfInstall, SELF_INSTALL_NOTE, STATUS_LABEL } from '@shared/consoles';
import { useTRPC } from '../trpc';
import { Glyph, PAD_NAMES, useKeys, usePadKind, type Key } from '../lib/input';
import { getSettings, setSettings, useSettings } from '../lib/settings';
import { setSfxProfile, sfx } from '../lib/sfx';
import { ago, fmtDate, fmtPlay, plural } from '../lib/format';
import { GameArt } from '../components/GameArt';
import { SearchBox } from '../components/SearchBox';
import { Translated } from '../components/Translated';
import { matchesQuery } from '../lib/search';
import { CONSOLES } from '../stage/consoles';
import { BootOverlay, Fit, useClock, useHubToast } from './HubFrame';
import { Ic, type IconName } from './icons';
import { useGameProgress, useHubActions, useHubData, type HubGame } from './data';

type Page = 'home' | 'cat' | 'news' | 'time' | 'upd' | 'cfg' | 'game';
type Zone = 'row' | 'dock' | 'side' | 'main';
interface St { page: Page; zone: Zone; idx: number; di: number; si: number; mi: number; game: string | null; from: Page | null; fromSi?: number; lastZone: Zone }
type Side = { k: string; l: string; ic?: IconName; n?: number; gap?: boolean; v?: string };

const DOCK: [Page | 'off', string, IconName, string][] = [
  ['news', 'Novidades', 'bell', '#2f7de1'], ['cat', 'Descobrir', 'compass', '#ef7d22'], ['time', 'Tempo', 'clock', '#2fa45a'],
  ['upd', 'Atualizações', 'dl', '#8b5cf6'], ['cfg', 'Ajustes', 'gear', '#6b6b75'], ['off', 'Sair', 'power', '#6b6b75'],
];
const PAGES: Record<Exclude<Page, 'home' | 'game'>, [string, IconName]> = { cat: ['Descobrir', 'compass'], news: ['Novidades', 'bell'], time: ['Tempo de jogo', 'clock'], upd: ['Atualizações', 'dl'], cfg: ['Configurações', 'gear'] };
const TAGS = { new: 'NOVO', upd: 'VERSÃO', up: 'SUBIU' } as const;
const Art = ({ g, v }: { g: HubGame; v: 'cover' | 'wide' | 'square' }) =>
  <GameArt title={g.title} console={g.console} platformName={g.platformName} fallback={g.coverUrl} variant={v} />;

export function SwitchHub({ id, game: game0, tab, onBack }: { id: ConsoleId; game?: string; tab?: 'lib' | 'cat'; onBack: () => void }) {
  const v1 = id === 'switch';
  const self = isSelfInstall(id);
  const c = CONSOLES.find(x => x.id === id)!;
  const data = useHubData(id);
  const act = useHubActions();
  const trpc = useTRPC(), qc = useQueryClient();
  const [toast, show] = useHubToast();
  const [launch, setLaunch] = useState<HubGame | null>(null);
  const [st, set] = useState<St>(() => ({ page: game0 ? 'game' : tab === 'cat' ? 'cat' : 'home', zone: game0 ? 'side' : tab === 'cat' ? 'main' : 'row', idx: 0, di: 0, si: !game0 && tab === 'cat' ? 1 : 0, mi: 0, game: game0 ?? null, from: game0 ? 'home' : null, lastZone: 'row' }));
  const up = (p: Partial<St>) => set(s => ({ ...s, ...p }));
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const go = () => { sfx.play('ok'); set(s => ({ ...s, page: 'cat', si: 0, mi: 0, zone: 'side', game: null, from: null })); setTimeout(() => searchRef.current?.focus(), 50); };
    addEventListener('cartucho:search', go);
    return () => removeEventListener('cartucho:search', go);
  }, []);
  const s = useSettings();
  const pickDir = useMutation(trpc.settings.pickPortsDir.mutationOptions({ onSuccess: d => { qc.setQueryData(trpc.settings.portsDir.queryKey(), d); show('Pasta dos jogos alterada'); } }));
  const chooseExe = useMutation(trpc.games.chooseExe.mutationOptions({ onSuccess: () => void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }) }));
  const openFolder = useMutation(trpc.games.openFolder.mutationOptions());

  useEffect(() => { setSfxProfile('click'); const t = setTimeout(() => sfx.play('boot'), 150); return () => { clearTimeout(t); setSfxProfile('soft'); }; }, []);
  useEffect(() => { if (act.error) { show(act.error); act.reset(); } }, [act.error]);

  const row = data.lib;
  const all = useMemo(() => new Map([...data.lib, ...data.catalog].flatMap(g => [[g.key, g] as const, ...(g.installed && g.catalog ? [[g.catalog.id, g] as const] : [])])), [data.lib, data.catalog]);
  const game = st.game ? all.get(st.game) ?? null : null;
  const timeList = data.lib.filter(g => g.installed!.playMs > 0).sort((a, b) => b.installed!.playMs - a.installed!.playMs);

  const side: Side[] = (() => {
    const p = st.page;
    if (p === 'cat') {
      const cnt = (f: (g: HubGame) => boolean) => String(data.catalog.filter(f).length);
      return [{ k: 'search', l: 'Buscar', ic: 'search' }, { k: 'all', l: 'Todos', ic: 'grid', v: String(data.catalog.length) }, { k: 'new', l: 'Novos', ic: 'star', n: data.catalog.filter(g => g.isNew).length },
        { k: 'full', l: 'Totalmente jogáveis', ic: 'play', v: cnt(g => g.status === 'full') }, { k: 'play', l: 'Jogáveis', ic: 'pad', v: cnt(g => g.status === 'play') },
        { k: 'wip', l: 'Em progresso', ic: 'refresh', v: cnt(g => g.status === 'wip') }, { k: 'inst', l: 'Já instalados', ic: 'folder', gap: true, v: cnt(g => !!g.installed) }];
    }
    if (p === 'news') return [{ k: 'all', l: 'Tudo', n: data.feed.length }, { k: 'new', l: 'Novos no catálogo' }, { k: 'upd', l: 'Versões novas' }, { k: 'up', l: 'Mudou de status' }];
    if (p === 'time') return [{ k: 'sum', l: 'Resumo', ic: 'chart' }, ...timeList.map((g, i) => ({ k: 'g:' + g.key, l: g.title, gap: i === 0, v: fmtPlay(g.installed!.playMs) }))];
    if (p === 'upd') return self ? [{ k: 'all', l: 'Atualizações', ic: 'dl' }] : [{ k: 'all', l: 'Atualizações disponíveis', ic: 'dl', n: data.withUpdate.length }, { k: 'check', l: act.checking ? 'Verificando…' : 'Verificar agora', ic: 'refresh' }];
    if (p === 'cfg') return [{ k: 'dir', l: 'Pasta dos jogos', ic: 'folder' }, { k: 'snd', l: 'Sons da interface', ic: 'sound', v: s.snd ? 'Ligados' : 'Desligados' }, { k: 'radar', l: 'Radar de novidades', ic: 'bell' }, { k: 'about', l: 'Sobre o Cartucho', ic: 'info', gap: true }];
    if (p === 'game' && game) {
      const g = game, inst = g.installed;
      if (inst?.missing) return [
        ...(g.repo && !self ? [{ k: 'reinstall', l: 'Instalar de novo', ic: 'dl' as IconName }] : []),
        { k: 'relink', l: 'Procurar a pasta', ic: 'folder' }, { k: 'info', l: 'Informações', ic: 'info', gap: true },
        { k: 'remove', l: 'Tirar da biblioteca', ic: 'stop' },
      ];
      if (!inst && self) return [{ k: 'add', l: 'Já instalei: adicionar pasta', ic: 'folder' }, { k: 'info', l: 'Informações', ic: 'info', gap: true }];
      const first: Side = inst?.running ? { k: 'quit', l: 'Fechar o jogo', ic: 'stop' } : inst ? (inst.exe ? { k: 'play', l: 'Jogar', ic: 'play' } : { k: 'exe', l: 'Escolher o .exe', ic: 'folder' }) : { k: 'install', l: 'Instalar', ic: 'dl' };
      return [first, { k: 'info', l: 'Informações', ic: 'info', gap: true },
        ...(inst?.adapter ? [{ k: 'ach', l: 'Conquistas', ic: 'medal' as IconName, v: inst.achievements?.total ? `${inst.achievements.unlocked}/${inst.achievements.total}` : undefined }] : []),
        ...(inst ? [{ k: 'time', l: 'Tempo de jogo', ic: 'clock' as IconName }] : []),
        ...(inst && !self ? [{ k: 'ver', l: 'Versão e atualização', ic: 'dl' as IconName, n: g.update?.updateAvailable ? 1 : 0 }] : []),
        ...(g.repo ? [{ k: 'gh', l: 'Ver no GitHub', ic: 'link' as IconName }] : []),
        ...(inst ? [{ k: 'folder', l: 'Abrir pasta', ic: 'folder' as IconName }, ...(inst.exe ? [{ k: 'exe', l: 'Escolher o .exe', ic: 'folder' as IconName }] : [])] : []),
      ];
    }
    return [];
  })();
  const sk = side[st.si]?.k;
  const catList = (() => {
    const k = st.page === 'cat' ? sk : 'all';
    if (k === 'new') return data.catalog.filter(g => g.isNew);
    if (k === 'full' || k === 'play' || k === 'wip') return data.catalog.filter(g => g.status === k);
    if (k === 'inst') return data.catalog.filter(g => g.installed);
    if (k === 'search') return query.trim() ? [...data.catalog, ...data.lib.filter(g => !g.catalog)].filter(g => matchesQuery(query, g.title, g.platformName, g.catalog?.developer)) : [];
    return data.catalog;
  })();
  const mainList = st.page === 'cat' ? catList : st.page === 'upd' && sk === 'all' ? data.withUpdate : [];
  const wide = st.page === 'cat' && st.zone === 'main';
  const cols = st.page === 'cat' ? (wide ? 5 : 2) : 1;

  const open = (page: Page, extra: Partial<St> = {}) => { sfx.play('ok'); up({ page, si: page === 'cat' ? 1 : 0, mi: 0, zone: page === 'cat' ? 'main' : 'side', ...extra }); };
  const doPrimary = (g: HubGame) => {
    const r = act.primary(g);
    if (r === 'play') { sfx.play('ok'); setLaunch(g); setTimeout(() => setLaunch(null), 1600); show(`${g.title} aberto · o tempo de jogo começou a contar`); }
    else if (r === 'install') { sfx.play('ok'); show(`Baixando ${g.repo} do GitHub…`); }
    else if (r === 'add') { sfx.play('ok'); show('Escolha a pasta onde você instalou o jogo'); }
    else if (r === 'quit') { sfx.play('back'); show(`Fechando ${g.title}…`); }
    else if (r === 'pick') { show('Escolha qual programa abre o jogo'); chooseExe.mutate({ id: g.installed!.id }); }
    else if (r === 'relink') show('A pasta do jogo sumiu: escolha onde ele está agora');
  };
  const doUpdate = (g: HubGame) => { sfx.play('ok'); act.update(g); show(`Atualizando ${g.title} para ${g.update?.latest?.tag}… configurações e saves ficam`); };
  const enter = () => {
    const p = st.page;
    if (p === 'home') {
      if (st.zone === 'dock') { const k = DOCK[st.di]![0]; if (k === 'off') { sfx.play('back'); return onBack(); } return open(k); }
      const g = row[st.idx]; if (!g) return open('cat');
      return doPrimary(g);
    }
    if (p === 'cat' && st.zone === 'side' && sk === 'search') { sfx.play('ok'); searchRef.current?.focus(); return; }
    if (st.zone === 'side' && mainList.length && (p === 'cat' || (p === 'upd' && sk === 'all'))) { sfx.play('move'); return up({ zone: 'main', mi: 0 }); }
    if (st.zone === 'main') {
      const g = mainList[st.mi]; if (!g) return;
      if (p === 'cat') return open('game', { game: g.key, from: 'cat', fromSi: st.si });
      if (p === 'upd') return doUpdate(g);
    }
    if (p === 'upd' && sk === 'check') { sfx.play('ok'); return act.checkAll(data.lib); }
    if (p === 'cfg' && sk === 'dir') { sfx.play('ok'); return pickDir.mutate(); }
    if (p === 'cfg' && sk === 'snd') { setSettings({ snd: !getSettings().snd }); return sfx.play('ok'); }
    if (p === 'game' && game) {
      if (sk === 'play' || sk === 'install' || sk === 'quit' || sk === 'add') return doPrimary(game);
      if (sk === 'exe') { sfx.play('ok'); return chooseExe.mutate({ id: game.installed!.id }); }
      if (sk === 'reinstall') { sfx.play('ok'); act.reinstall(game); return show(`Baixando ${game.repo} de novo… o tempo de jogo continua`); }
      if (sk === 'relink') { sfx.play('ok'); act.relink(game); return show('Escolha onde o jogo está agora'); }
      if (sk === 'remove') { sfx.play('back'); act.remove(game); show(`${game.title} saiu da biblioteca · nenhum arquivo foi apagado`); return up({ page: 'home', zone: 'row', game: null, from: null }); }
      if (sk === 'folder') { sfx.play('ok'); return openFolder.mutate({ id: game.installed!.id }); }
      if (sk === 'gh') { sfx.play('ok'); return act.github(game); }
      if (sk === 'ver' && game.update?.updateAvailable) return doUpdate(game);
    }
    sfx.play('move');
  };
  const back = () => {
    if (st.page === 'home') { if (st.zone === 'dock') { sfx.play('back'); return up({ zone: 'row', lastZone: 'row' }); } sfx.play('back'); return onBack(); }
    sfx.play('back');
    if (st.zone === 'main') return up({ zone: 'side' });
    if (st.page === 'game' && st.from && st.from !== 'home') return up({ page: st.from, from: null, zone: 'main', si: st.fromSi ?? 0 });
    up({ page: 'home', zone: st.lastZone === 'dock' ? 'dock' : 'row' });
  };

  useKeys((k: Key) => {
    if (launch) return;
    if (k === 'Escape') return back();
    if (k === 'Enter') return enter();
    if (k === 'X' || k === 'Y') {
      if (st.page === 'home' && st.zone === 'row' && row[st.idx]) return open('game', { game: row[st.idx]!.key, from: 'home', lastZone: 'row' });
      return;
    }
    const mv = (p: Partial<St>) => { sfx.play('move'); up(p); };
    if (st.page === 'home') {
      const n = row.length + 1;
      if (st.zone === 'row') {
        if (k === 'ArrowRight' && st.idx < n - 1) mv({ idx: st.idx + 1 });
        else if (k === 'ArrowLeft' && st.idx > 0) mv({ idx: st.idx - 1 });
        else if (k === 'ArrowDown') mv({ zone: 'dock', lastZone: 'dock' });
      } else {
        if (k === 'ArrowRight' && st.di < DOCK.length - 1) mv({ di: st.di + 1 });
        else if (k === 'ArrowLeft' && st.di > 0) mv({ di: st.di - 1 });
        else if (k === 'ArrowUp') mv({ zone: 'row', lastZone: 'row' });
      }
      return;
    }
    if (st.zone === 'side') {
      if (k === 'ArrowDown' && st.si < side.length - 1) mv({ si: st.si + 1, mi: 0 });
      else if (k === 'ArrowUp' && st.si > 0) mv({ si: st.si - 1, mi: 0 });
      else if (k === 'ArrowRight' && mainList.length) mv({ zone: 'main', mi: 0 });
      return;
    }
    const n = mainList.length;
    if (k === 'ArrowLeft') { if (st.mi % cols === 0) mv({ zone: 'side' }); else mv({ mi: st.mi - 1 }); }
    else if (k === 'ArrowRight' && cols > 1 && st.mi < n - 1) mv({ mi: st.mi + 1 });
    else if (k === 'ArrowDown' && st.mi + cols < n) mv({ mi: st.mi + cols });
    else if (k === 'ArrowUp' && st.mi - cols >= 0) mv({ mi: st.mi - cols });
  });

  const hints: [Parameters<typeof Glyph>[0]['a'], string][] = (() => {
    if (st.page === 'home') {
      if (st.zone === 'dock') return [['ok', 'OK']];
      const g = row[st.idx];
      if (!g) return [['ok', 'Descobrir']];
      return [['x', 'Detalhes'], ['ok', g.installed?.missing ? (g.repo && !self ? 'Instalar de novo' : 'Procurar a pasta') : g.installed?.running ? 'Fechar' : g.installed ? (v1 ? 'Iniciar' : 'Jogar') : 'Instalar']];
    }
    if (st.zone === 'main') return [['back', 'Voltar'], ['ok', st.page === 'cat' ? 'Ver' : 'Atualizar']];
    if (st.page === 'cat' && sk === 'search') return [['back', 'Voltar'], ['ok', 'Digitar']];
    return [['back', 'Voltar'], ['ok', st.page === 'game' && sk === 'add' ? 'Escolher a pasta' : st.page === 'game' && st.si === 0 ? side[0]?.l ?? 'OK' : 'OK']];
  })();
  const Hints = () => <div className="s2h">{hints.map(([a, t]) => <span key={a + t}><Glyph a={a} />{t}</span>)}</div>;

  return (
    <section className="view hub sk-tiles2" style={{ ['--cc' as string]: c.color }}>
      <Fit w={1920} h={1080} className={`s2 ${v1 ? 'v1' : ''} ${wide ? 'wide' : ''}`} style={{ ['--cc' as string]: c.color }}>
        <div className="s2-in">
          {st.page === 'home'
            ? <Home v1={v1} row={row} st={st} feedCount={data.feed.length} updCount={data.withUpdate.length} newCount={data.catalog.filter(g => g.isNew).length}
                onTile={i => { if (st.zone === 'row' && st.idx === i) enter(); else { sfx.play('move'); up({ zone: 'row', idx: i }); } }}
                onDock={j => { const k = DOCK[j]![0]; if (k === 'off') { sfx.play('back'); onBack(); } else open(k); }} hints={<Hints />} />
            : (
              <>
                <div className="hd">
                  <Ic n={st.page === 'game' ? 'info' : PAGES[st.page as keyof typeof PAGES][1]} />
                  <span>{st.page === 'game' ? game?.title : PAGES[st.page as keyof typeof PAGES][0]}</span>
                  {st.page === 'cat' && <span className="crumb">{side[st.si]?.l} · {plural(catList.length, 'jogo', 'jogos')}</span>}
                  <span className="sp" /><div className="av">G</div>
                </div>
                <nav className="side">
                  <div className="side-in" style={{ transform: `translateY(-${Math.max(0, st.si - 6) * 92}px)` }}>
                    {side.map((x, j) => (
                      <button key={x.k} title={x.l} className={`si ${j === st.si ? (st.zone === 'side' ? 'on' : 'sel') : ''} ${x.gap ? 'gap' : ''}`}
                        onClick={() => { if (st.si === j && st.zone === 'side') enter(); else { sfx.play('move'); up({ zone: 'side', si: j, mi: 0 }); } }}>
                        {x.ic && <Ic n={x.ic} />}<span>{x.l}</span>{x.n ? <span className="n">{x.n}</span> : x.v ? <span className="v">{x.v}</span> : null}
                      </button>
                    ))}
                  </div>
                </nav>
                <div className="vr" />
                <div className="main">
                  <div className="page-in" key={st.page + sk}>
                    <Main page={st.page} k={sk} st={st} cols={cols} self={self} query={query} setQuery={setQuery} searchRef={searchRef}
                      onSearchDone={() => { if (catList.length) up({ zone: 'main', mi: 0 }); }} data={data} catList={catList} timeList={timeList} game={game} c={c.name}
                      onCard={i => { if (st.zone === 'main' && st.mi === i) enter(); else { sfx.play('move'); up({ zone: 'main', mi: i }); } }} />
                  </div>
                </div>
                <div className="ft"><PadIndicator v1={v1} /><Hints /></div>
              </>
            )}
          {launch && <div className="launch"><Art g={launch} v="square" /></div>}
          {toast}
        </div>
      </Fit>
      <BootOverlay kind="tiles" />
    </section>
  );
}

function Home({ v1, row, st, feedCount, updCount, newCount, onTile, onDock, hints }: {
  v1: boolean; row: HubGame[]; st: St; feedCount: number; updCount: number; newCount: number; onTile: (i: number) => void; onDock: (j: number) => void; hints: ReactNode;
}) {
  const clock = useClock();
  const P = v1 ? 392 : 394, X0 = v1 ? 104 : 150, n = row.length, inDock = st.zone === 'dock', i = st.idx;
  const shift = Math.max(0, i - 2) * P, x = X0 + i * P - shift, g = row[i];
  return (
    <>
      <div className="top">
        <div className="av">G</div>
        <span className="brand">Cartucho<small>{v1 ? 'Nintendo Switch' : 'Nintendo Switch 2'}</small></span>
        <div className="sp" />
        {feedCount > 0 && <span className="radar"><i />{plural(feedCount, 'novidade', 'novidades')}</span>}
        <span className="clock">{clock}</span>
      </div>
      {!inDock && n > 0 && <div className="tname" style={{ left: x }}>{g ? g.title : 'Descobrir mais'}</div>}
      <div className="row" style={{ transform: `translateX(-${shift}px)` }}>
        {row.map((t, k) => <Tile key={t.key} g={t} on={!inDock && k === i} first={k === 0} onClick={() => onTile(k)} />)}
        {n === 0
          ? <button className={`tile all empty ${!inDock ? 'on' : ''}`} onClick={() => onTile(0)}>
              <Ic n="compass" /><b>Nenhum jogo por aqui ainda</b><span>Descubra recomps para instalar em Descobrir</span>
            </button>
          : <button className={`tile all ${!inDock && i === n ? 'on' : ''}`} onClick={() => onTile(n)}><Ic n="compass" />Descobrir mais</button>}
      </div>
      {!inDock && g && <Meta g={g} x={x} />}
      <nav className="dock">
        {DOCK.map(([k, l, ic, col], j) => {
          const cnt = k === 'news' ? feedCount : k === 'upd' ? updCount : k === 'cat' ? newCount : 0;
          return (
            <button key={k} className={`dk ${inDock && j === st.di ? 'on' : ''}`} style={{ ['--ic' as string]: col }} aria-label={l} onClick={() => onDock(j)}>
              <Ic n={ic} /><span className="lb">{l}</span>{cnt > 0 && <span className="n">{cnt}</span>}
            </button>
          );
        })}
      </nav>
      <div className="foot"><PadIndicator v1={v1} label />{hints}</div>
    </>
  );
}

function Tile({ g, on, first, onClick }: { g: HubGame; on: boolean; first: boolean; onClick: () => void }) {
  const p = useGameProgress(g);
  return (
    <button className={`tile ${g.installed && !g.installed.missing ? '' : 'off'} ${on ? 'on' : ''}`} onClick={onClick} aria-label={g.title}>
      <Art g={g} v="square" />
      {!g.installed && !p && <span className="dlb"><Ic n="dl" /></span>}
      {first && g.installed?.lastPlayed && !g.installed.running && <span className="cont"><b>G</b>Continuar</span>}
      {g.installed?.running && <span className="cont run"><b>▶</b>Jogando</span>}
      {p && !p.error && <span className="tprog"><i style={{ width: `${Math.max(4, p.pct * 100)}%` }} /></span>}
    </button>
  );
}

function Meta({ g, x }: { g: HubGame; x: number }) {
  const p = useGameProgress(g), inst = g.installed;
  return (
    <div className="meta" style={{ left: x }}>
      {p ? <span>{p.error ?? `${p.stage}${p.pct > 0 && p.pct < 1 ? ` · ${Math.round(p.pct * 100)}%` : ''}`}</span>
        : inst?.missing ? <span>Pasta do jogo não encontrada</span>
        : inst ? (inst.playMs ? <><span>Jogado <strong>{fmtPlay(inst.playMs)}</strong></span><span>{inst.lastPlayed ? ago(inst.lastPlayed) : ''}</span></> : <span>Ainda não jogado</span>)
        : <span>{g.isNew ? <span className="pill new">NOVO</span> : 'Não instalado'}</span>}
      {g.status && <Chip s={g.status} />}
      {g.update?.updateAvailable && <span className="pill upd">UPDATE {g.update.latest?.tag}</span>}
    </div>
  );
}

const Chip = ({ s }: { s: NonNullable<HubGame['status']> }) => <span className={`chip ${s}`}>{STATUS_LABEL[s]}</span>;
const Pill = ({ g }: { g: HubGame }) => g.isNew ? <span className="pill new">NOVO</span> : g.update?.updateAvailable ? <span className="pill upd">UPDATE</span> : g.installed ? <span className="pill inst">INSTALADO</span> : null;
const Empty = ({ children }: { children: ReactNode }) => <div className="empty2">{children}</div>;

function Main({ page, k, st, cols, self, query, setQuery, searchRef, onSearchDone, data, catList, timeList, game, c, onCard }: {
  page: Page; k: string | undefined; st: St; cols: number; self: boolean; query: string; setQuery: (q: string) => void; searchRef: RefObject<HTMLInputElement | null>; onSearchDone: () => void; data: ReturnType<typeof useHubData>; catList: HubGame[]; timeList: HubGame[]; game: HubGame | null; c: string; onCard: (i: number) => void;
}) {
  const trpc = useTRPC();
  const portsDir = useQuery(trpc.settings.portsDir.queryOptions());
  const info = useQuery(trpc.catalog.info.queryOptions());
  const s = useSettings();

  if (page === 'cat' && k === 'search') {
    const r = Math.floor(st.mi / cols), pitch = cols > 2 ? 266 : 410;
    return (
      <div className="main-in" style={{ transform: `translateY(-${st.zone === 'main' ? Math.max(0, r - 1) * pitch : 0}px)` }}>
        <SearchBox ref={searchRef} value={query} onChange={setQuery} nav={false} className="sbox" placeholder="Nome do jogo…" onDone={onSearchDone} />
        {!query.trim() ? <Empty>Digite o nome de um jogo de {c}: aparecem os seus e os do catálogo.</Empty>
          : !catList.length ? <Empty>Nada encontrado para “{query.trim()}”.</Empty>
          : <div className="cards">{catList.map((g, i) => (
              <button key={g.key} className={`card ${st.zone === 'main' && i === st.mi ? 'on' : ''}`} onClick={() => onCard(i)}>
                <Art g={g} v="wide" /><div className="ttl"><span>{g.title}</span><Pill g={g} /></div>
              </button>
            ))}</div>}
      </div>
    );
  }
  if (page === 'cat') {
    if (!catList.length) return <Empty>{data.catalog.length ? 'Nada nessa categoria.' : `O catálogo ainda não tem recomps para ${c}. O radar avisa quando aparecer o primeiro.`}</Empty>;
    const r = Math.floor(st.mi / cols), pitch = cols > 2 ? 266 : 410;
    return (
      <div className="main-in" style={{ transform: `translateY(-${st.zone === 'main' ? Math.max(0, r - 1) * pitch : 0}px)` }}>
        <div className="cards">{catList.map((g, i) => (
          <button key={g.key} className={`card ${st.zone === 'main' && i === st.mi ? 'on' : ''}`} onClick={() => onCard(i)}>
            <Art g={g} v="wide" /><div className="ttl"><span>{g.title}</span><Pill g={g} /></div>
          </button>
        ))}</div>
      </div>
    );
  }
  if (page === 'news') {
    const L = data.feed.filter(f => k === 'all' || f.kind === k);
    if (!L.length) return <Empty>Nada novo por aqui. O Cartucho confere o Recompendium toda vez que abre.</Empty>;
    const byId = new Map(data.catalog.map(g => [g.catalog!.id, g]));
    return <>{L.map(f => { const g = byId.get(f.gameId); return (
      <div key={f.id} className="nr">{g ? <Art g={g} v="cover" /> : <div />}
        <div>{f.title}<small>{f.kind === 'new' ? (g?.repo ?? '') : f.detail}</small></div>
        <div className="r"><span className={`pill ${f.kind}`}>{TAGS[f.kind]}</span>{ago(f.at)}</div></div>); })}</>;
  }
  if (page === 'time') {
    if (!timeList.length) return <Empty>Nenhuma sessão ainda. O tempo começa a contar quando você abre um jogo por aqui.</Empty>;
    if (k === 'sum') {
      const max = Math.max(...timeList.map(g => g.installed!.playMs));
      return (
        <>
          <ConsoleBigs data={data} />
          {timeList.map(g => <div key={g.key} className="rank"><span>{g.title}</span><span>{fmtPlay(g.installed!.playMs)}</span><div className="bar"><i style={{ width: `${(g.installed!.playMs / max) * 100}%` }} /></div></div>)}
        </>
      );
    }
    const g = timeList.find(x => 'g:' + x.key === k);
    return g ? <GameTime g={g} /> : null;
  }
  if (page === 'upd') {
    if (k === 'check') return <div className="desc"><Ic n="refresh" /><div>Confere no GitHub se saiu versão nova dos seus jogos de {c}. O Cartucho já confere sozinho a cada 3 horas; aqui é para forçar agora.</div></div>;
    if (self) return <Empty>Neste console as atualizações são por sua conta: instale a versão nova do recomp por cima da pasta do jogo e o Cartucho continua contando o tempo e as conquistas.</Empty>;
    if (!data.withUpdate.length) return <Empty>Tudo em dia.{data.lib.some(g => g.installed?.sourceRepo) ? '' : ' (Nenhum jogo deste console tem projeto do GitHub ligado.)'}</Empty>;
    return <>{data.withUpdate.map((g, i) => (
      <button key={g.key} className={`nr nrb ${st.zone === 'main' && i === st.mi ? 'on' : ''}`} onClick={() => onCard(i)}>
        <Art g={g} v="cover" />
        <div>{g.title}<small>{g.repo} · {g.update?.installed ?? '?'} → {g.update?.latest?.tag}</small></div>
        <div className="r"><span className="pill upd">{g.update?.latest?.tag}</span><span><Glyph a="ok" />atualizar</span></div>
      </button>
    ))}</>;
  }
  if (page === 'cfg') {
    if (k === 'dir') return <><div className="desc"><Ic n="folder" /><div>Onde o Cartucho instala os jogos que você baixa. Os já instalados ficam onde estão. <Glyph a="ok" /> para escolher outra pasta.</div></div><dl className="kv2"><dt>Pasta</dt><dd>{portsDir.data ?? '…'}</dd></dl></>;
    if (k === 'snd') return <><div className="desc"><Ic n="sound" /><div>Os sons de navegação de cada console. <Glyph a="ok" /> liga ou desliga.</div></div><dl className="kv2"><dt>Sons</dt><dd>{s.snd ? 'Ligados' : 'Desligados'}</dd><dt>Volume</dt><dd>{s.vol}%</dd></dl></>;
    if (k === 'radar') return <><div className="desc"><Ic n="bell" /><div>O radar compara o catálogo do Recompendium com a última olhada e avisa jogos novos, mudanças de status e versões novas dos seus jogos.</div></div><dl className="kv2"><dt>Catálogo de</dt><dd>{info.data?.generatedAt ? fmtDate(Date.parse(info.data.generatedAt)) : '—'}</dd><dt>Conferido</dt><dd>{info.data?.checkedAt ? ago(info.data.checkedAt) : '—'}</dd></dl></>;
    return <div className="desc"><Ic n="info" /><div>Cartucho: hub de recomps, ports e emuladores. Catálogo do Recompendium; instalação adaptada do Harbour. Esta tela é inspirada no visual do {c}, sem nada copiado dele.</div></div>;
  }
  if (page === 'game' && game) {
    const g = game, inst = g.installed;
    if (k === 'ach' && inst) return <GameAch id={inst.id} />;
    if (k === 'time' && inst) return <GameTime g={g} />;
    if (k === 'ver' && inst) return (
      <dl className="kv2">
        <dt>Instalado</dt><dd>{g.update?.installed ?? inst.version ?? 'versão desconhecida'}</dd>
        <dt>Mais nova</dt><dd>{g.update?.latest ? `${g.update.latest.tag}${g.update.latest.date ? ` (${fmtDate(Date.parse(g.update.latest.date))})` : ''}` : '—'}</dd>
        <dt>Situação</dt><dd>{g.update?.updateAvailable ? <><Glyph a="ok" />atualizar agora</> : g.update?.updateAvailable === false ? 'Em dia' : g.repo ? 'Não deu para comparar' : 'Sem projeto do GitHub ligado'}</dd>
        <dt>Repositório</dt><dd>{g.repo ? `github.com/${g.repo}` : '—'}</dd>
      </dl>
    );
    return (
      <>
        <div className="hero"><Art g={g} v="wide" /></div>
        <h1 className="gt">{g.title}</h1>
        <div className="gsub">{g.catalog?.developer ?? ''}{g.catalog?.year ? ` · ${g.catalog.year}` : ''} {g.status && <> · <Chip s={g.status} /></>}{g.isNew && <> · <span className="pill new">NOVO</span></>}</div>
        <GameProgress g={g} />
        {self && !inst && <div className="desc"><Ic n="info" /><div>{SELF_INSTALL_NOTE}</div></div>}
        <dl className="kv2">
          {g.catalog?.needs && <><dt>Precisa</dt><dd><Translated text={g.catalog.needs} /></dd></>}
          {g.repo && <><dt>Projeto</dt><dd>github.com/{g.repo}</dd></>}
          {inst && <><dt>Jogado</dt><dd>{inst.playMs ? `${fmtPlay(inst.playMs)} · ${inst.lastPlayed ? ago(inst.lastPlayed) : ''}` : 'Ainda não'}</dd></>}
          {inst && <><dt>Pasta</dt><dd className="small">{inst.installDir}</dd></>}
          {g.catalog?.description && <><dt>Sobre</dt><dd className="small"><Translated text={g.catalog.description} /></dd></>}
        </dl>
      </>
    );
  }
  return null;
}

function GameProgress({ g }: { g: HubGame }) {
  const p = useGameProgress(g);
  if (!p) return null;
  return <div className="gprog"><span>{p.error ?? p.stage}{!p.error && p.pct > 0 && p.pct < 1 ? ` · ${Math.round(p.pct * 100)}%` : ''}</span>{!p.error && <div className="bar"><i style={{ width: `${Math.max(3, p.pct * 100)}%` }} /></div>}</div>;
}

function ConsoleBigs({ data }: { data: ReturnType<typeof useHubData> }) {
  const played = data.lib.filter(g => g.installed!.playMs > 0);
  const top = [...played].sort((a, b) => b.installed!.playMs - a.installed!.playMs)[0];
  const last = Math.max(0, ...data.lib.map(g => g.installed!.lastPlayed ?? 0));
  return (
    <div className="bigs">
      <div className="big"><b>{fmtPlay(data.playMs)}</b><span>neste console</span></div>
      <div className="big"><b>{played.length}/{data.lib.length}</b><span>jogos jogados</span></div>
      <div className="big"><b>{last ? ago(last) : '—'}</b><span>última vez</span></div>
      <div className="big"><b className="ell">{top ? top.title : '—'}</b><span>mais jogado</span></div>
    </div>
  );
}

function GameTime({ g }: { g: HubGame }) {
  const trpc = useTRPC();
  const st = useQuery(trpc.play.stats.queryOptions({ id: g.installed!.id }));
  const d = st.data;
  if (!d) return null;
  const max = Math.max(...d.days, 0.01), wk = d.days.slice(7).reduce((a, b) => a + b, 0) * 3600_000;
  return (
    <>
      <div className="bigs">
        <div className="big"><b>{fmtPlay(d.totalMs)}</b><span>tempo total</span></div>
        <div className="big"><b>{d.lastPlayed ? ago(d.lastPlayed) : '—'}</b><span>última vez</span></div>
        <div className="big"><b>{d.sessions}</b><span>sessões</span></div>
        <div className="big"><b>{d.sessions ? fmtPlay(d.totalMs / d.sessions) : '—'}</b><span>por sessão</span></div>
      </div>
      <div className="ch2">
        <h4>{g.title}<span>{fmtPlay(wk)} nesta semana</span></h4>
        <div className="b14">{d.days.map((v, i) => <i key={i} className={v ? '' : 'z'} style={{ height: `${v ? Math.max(3, (v / max) * 100) : 1}%` }} />)}</div>
        <div className="ax"><span>14 dias atrás</span><span>hoje</span></div>
      </div>
    </>
  );
}

function GameAch({ id }: { id: string }) {
  const trpc = useTRPC();
  const q = useQuery(trpc.achievements.forGame.queryOptions({ id }));
  const d = q.data;
  if (!d) return null;
  const got = d.list.filter(a => a.unlockedAt != null).length;
  const list = [...d.list].sort((x, y) => (y.unlockedAt ?? -1) - (x.unlockedAt ?? -1));
  return (
    <>
      <div className="bigs"><div className="big"><b>{got}/{d.list.length}</b><span>conquistas</span></div>
        {d.list.some(a => a.points) && <div className="big"><b>{list.filter(a => a.unlockedAt != null).reduce((s, a) => s + (a.points ?? 0), 0)}</b><span>pontos</span></div>}</div>
      {d.errors.map(e => <div key={e} className="desc"><Ic n="info" /><div>{e}</div></div>)}
      {list.map(a => (
        <div key={a.id} className={`nr ach ${a.unlockedAt == null ? 'locked' : ''}`}>
          <div className="aico">{a.icon ? <img src={a.icon} alt="" /> : <Ic n="medal" />}</div>
          <div>{a.name}<small>{a.description}</small></div>
          <div className="r">{a.points != null && <span className="pill inst">{a.points} G</span>}{a.unlockedAt != null ? fmtDate(a.unlockedAt) : 'Bloqueada'}</div>
        </div>
      ))}
    </>
  );
}

function PadIndicator({ label = false }: { v1?: boolean; label?: boolean }) {
  const kind = usePadKind();
  if (kind === 'kb') return (
    <span className="pad"><svg className="kbd" viewBox="0 0 64 40" aria-hidden="true">
      <rect x="3" y="7" width="58" height="28" rx="6" fill="currentColor" />
      {[0, 1, 2, 3, 4, 5, 6].map(i => <rect key={i} x={9 + i * 7} y="12" width="5" height="5" rx="1.2" fill="#ececef" />)}
      {[0, 1, 2, 3, 4, 5].map(i => <rect key={i} x={12 + i * 7} y="19" width="5" height="5" rx="1.2" fill="#ececef" />)}
      <rect x="16" y="26" width="32" height="4.5" rx="1.5" fill="#ececef" />
    </svg>{label && <small>Teclado</small>}</span>
  );
  return <span className="pad"><Ic n="pad" />{label && <small>Controle {PAD_NAMES[kind]}</small>}</span>;
}
