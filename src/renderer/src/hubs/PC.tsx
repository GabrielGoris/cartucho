import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AchievementView, ConsoleId, PlayStats } from '@shared/types';
import { isSelfInstall, STATUS_LABEL } from '@shared/consoles';
import { useTRPC } from '../trpc';
import { Glyph, useKeys, type Key } from '../lib/input';
import { getSettings, setSettings, useSettings } from '../lib/settings';
import { setSfxProfile, sfx } from '../lib/sfx';
import { ago, fmtDate, fmtPlay, plural } from '../lib/format';
import { focusSearch as focusAny, matchesQuery } from '../lib/search';
import { GameView } from '../components/GameView';
import { Discover, initialDiscover } from '../components/Discover';
import { useArt } from '../lib/art';
import { GameArt } from '../components/GameArt';
import { SearchBox } from '../components/SearchBox';
import { CONSOLES } from '../stage/consoles';
import { BootOverlay, Fit, useClock, useHubToast } from './HubFrame';
import { Ic, type IconName } from './icons';
import { useHubActions, useHubData, type HubGame } from './data';

type Sec = 'lib' | 'cat' | 'news' | 'ach' | 'time' | 'cfg';
type Zone = 'side' | 'search' | 'main' | 'gacts' | 'gshots' | 'gtext';
interface St { si: number; zone: Zone; fi: number; li: number; game: string | null; ai: number; gs: number; menu: boolean; mi: number }
interface Row { key: string; g?: HubGame; ic?: IconName; t: string; s?: string; v?: string; id?: string }
type Opt = { k: string; l: string; ic: IconName };
type Hint = [Parameters<typeof Glyph>[0]['a'], string];

const SIDE: [Sec, string, IconName][] = [['lib', 'Biblioteca', 'grid'], ['cat', 'Descobrir', 'compass'], ['news', 'Novidades', 'bell'], ['ach', 'Conquistas', 'medal'], ['time', 'Tempo de jogo', 'clock'], ['cfg', 'Ajustes', 'gear']];
const FEED = { new: 'Novo no catálogo', upd: 'Versão nova', up: 'Mudou de status' } as const;
const CFG: Row[] = [
  { key: 'dir', id: 'dir', t: 'Pasta dos jogos', ic: 'folder' }, { key: 'snd', id: 'snd', t: 'Sons da interface', ic: 'sound' },
  { key: 'radar', id: 'radar', t: 'Radar de novidades', ic: 'bell' }, { key: 'off', id: 'off', t: 'Voltar ao Cartucho', ic: 'power' },
];
const COLS = 6;

const Art = ({ g, v }: { g: HubGame; v: 'cover' | 'wide' | 'square' }) =>
  <GameArt title={g.title} console={g.console} platformName={g.platformName} fallback={g.coverUrl} variant={v} />;

export function PCHub({ id, game: game0, tab, onBack }: { id: ConsoleId; game?: string; tab?: 'lib' | 'cat'; onBack: () => void }) {
  const c = CONSOLES.find(x => x.id === id)!;
  const self = isSelfInstall(id);
  const data = useHubData(id);
  const act = useHubActions();
  const trpc = useTRPC(), qc = useQueryClient();
  const s = useSettings();
  const [toast, show] = useHubToast();
  const [st, set] = useState<St>({ si: tab === 'cat' ? 1 : 0, zone: 'main', fi: 0, li: 0, game: null, ai: 0, gs: 0, menu: false, mi: 0 });
  const up = (p: Partial<St>) => set(x => ({ ...x, ...p }));
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const clock = useClock();
  const pickDir = useMutation(trpc.settings.pickPortsDir.mutationOptions({ onSuccess: d => { qc.setQueryData(trpc.settings.portsDir.queryKey(), d); show('Pasta dos jogos alterada'); } }));
  const chooseExe = useMutation(trpc.games.chooseExe.mutationOptions({ onSuccess: () => void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }) }));
  const openFolder = useMutation(trpc.games.openFolder.mutationOptions());

  useEffect(() => { setSfxProfile('click'); const t = setTimeout(() => sfx.play('boot'), 150); return () => clearTimeout(t); }, []);
  useEffect(() => { if (act.error) { show(act.error); act.reset(); } }, [act.error]);
  const [dst, setDst] = useState(initialDiscover);
  const focusSearch = () => { setDst(d => ({ ...d, zone: 'search' })); setTimeout(focusAny, 80); };
  useEffect(() => {
    const go = () => { sfx.play('ok'); set(x => ({ ...x, si: 1, zone: 'search', game: null, menu: false, fi: 0 })); focusSearch(); };
    addEventListener('cartucho:search', go);
    return () => removeEventListener('cartucho:search', go);
  }, []);

  const lib = data.lib;
  const shown = useRef(false);
  useEffect(() => {
    if (!game0 || shown.current) return;
    const i = lib.findIndex(g => g.key === game0 || g.catalog?.id === game0);
    if (i >= 0) { shown.current = true; up({ si: 0, fi: i }); openGame(lib[i]!); }
  }, [game0, lib.length]);
  const sec = SIDE[st.si]![0];
  const byPlay = useMemo(() => [...lib].sort((a, b) => (b.installed?.playMs ?? 0) - (a.installed?.playMs ?? 0)), [lib]);
  const all = useMemo(() => new Map([...data.lib, ...data.catalog].flatMap(x => [[x.key, x] as const, ...(x.installed && x.catalog ? [[x.catalog.id, x] as const] : [])])), [data.lib, data.catalog]);
  const q = query.trim();
  const grid = useMemo(() => {
    const base = sec === 'lib' ? lib : sec === 'cat' ? [...data.catalog, ...(q ? data.lib.filter(x => !x.catalog) : [])] : [];
    return q ? base.filter(x => matchesQuery(query, x.title, x.platformName, x.catalog?.developer)) : base;
  }, [sec, lib, data.catalog, data.lib, query]);
  const cur = grid[st.fi] ?? null;
  const rows: Row[] = sec === 'news' ? data.feed.map(f => ({ key: String(f.id), g: data.catalog.find(y => y.catalog?.id === f.gameId), t: f.title, s: `${FEED[f.kind]}${f.detail && !(self && f.kind === 'new') ? ` · ${f.detail}` : ''}`, v: ago(f.at) }))
    : sec === 'ach' ? lib.map(g => ({ key: g.key, g, t: g.title, v: g.installed?.achievements?.total ? `${g.installed.achievements.unlocked}/${g.installed.achievements.total}` : '—' }))
    : sec === 'time' ? [{ key: 'sum', ic: 'chart' as IconName, t: 'Resumo', v: fmtPlay(data.playMs) || '0m' }, ...byPlay.map(g => ({ key: g.key, g, t: g.title, v: fmtPlay(g.installed?.playMs ?? 0) || '0m' }))]
    : sec === 'cfg' ? CFG.map(r => ({ ...r, v: r.id === 'snd' ? (s.snd ? 'Ligados' : 'Desligados') : '' }))
    : [];
  const row = rows[st.li];
  const ach = useQuery(trpc.achievements.forGame.queryOptions({ id: row?.g?.installed?.id ?? '' }, { enabled: sec === 'ach' && !!row?.g?.installed?.adapter }));
  const statQ = useQueries({ queries: (sec === 'time' ? byPlay : []).map(x => trpc.play.stats.queryOptions({ id: x.installed!.id })) });
  const stats = new Map(byPlay.map((x, i) => [x.key, statQ[i]?.data] as const));

  const game = st.game ? all.get(st.game) ?? null : null;
  useEffect(() => {
    if (st.zone !== 'main' || game) return;
    mainRef.current?.querySelector('.pc-cap.on, .pc-r.on')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [st.fi, st.li, st.zone, sec]);

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
  const gameOpts = game ? options(game) : [];
  const openGame = (x: HubGame) => { up({ game: x.key, menu: false, zone: 'gacts', ai: 0, gs: 0 }); };
  const goSec = (i: number, extra: Partial<St> = {}) => { sfx.play('move'); set(x => ({ ...x, si: i, fi: 0, li: 0, menu: false, game: null, ...extra })); };

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
    if (k === 'ach') return goSec(3, { zone: 'main', li: Math.max(0, lib.indexOf(x)) });
    if (k === 'folder') return openFolder.mutate({ id: x.installed!.id });
    if (k === 'exe') return chooseExe.mutate({ id: x.installed!.id });
    if (k === 'gh') return act.github(x);
    if (k === 'info') return openGame(x);
  };

  const enter = () => {
    if (st.menu && cur) { const o = options(cur)[st.mi]; if (o) run(o.k, cur); return; }
    if (st.zone === 'side') { sfx.play('ok'); return up({ zone: 'main' }); }
    if (sec === 'lib' || sec === 'cat') { if (cur) { sfx.play('ok'); openGame(cur); } return; }
    if (!row) return;
    if (sec === 'cfg') {
      sfx.play('ok');
      if (row.id === 'dir') return pickDir.mutate();
      if (row.id === 'snd') return setSettings({ snd: !getSettings().snd });
      if (row.id === 'off') return onBack();
      return show('O radar confere o catálogo do Recompendium toda vez que o Cartucho abre');
    }
    if (row.g) { sfx.play('ok'); openGame(row.g); }
  };
  const back = () => {
    sfx.play('back');
    if (game) return up({ game: null });
    if (st.menu) return up({ menu: false });
    if (query) { setQuery(''); return up({ fi: 0 }); }
    if (st.zone !== 'side') return up({ zone: 'side' });
    onBack();
  };

  useKeys((k: Key) => {
    if ((sec === 'cat' && !game && !st.menu) || game) return;
    if (k === 'Escape') return back();
    const R = k === 'ArrowRight', L = k === 'ArrowLeft', U = k === 'ArrowUp', D = k === 'ArrowDown';
    const mv = (p: Partial<St>) => { sfx.play('move'); up(p); };
    if (k === 'Enter') return enter();
    if (st.menu && cur) {
      const n = options(cur).length;
      if (D && st.mi < n - 1) mv({ mi: st.mi + 1 }); else if (U && st.mi > 0) mv({ mi: st.mi - 1 });
      return;
    }
    if (k === 'LB' || k === 'RB' || k === 'Tab') return goSec((st.si + (k === 'LB' ? SIDE.length - 1 : 1)) % SIDE.length, { zone: 'main' });
    if (k === 'Y') { sfx.play('ok'); if (sec !== 'lib' && sec !== 'cat') goSec(1); up({ zone: 'search' }); return focusSearch(); }
    if (k === 'X') { if ((sec === 'lib' || sec === 'cat') && cur) { sfx.play('ok'); up({ menu: true, mi: 0 }); } return; }
    if (st.zone === 'side') {
      if (D && st.si < SIDE.length - 1) goSec(st.si + 1, { zone: 'side' }); else if (U && st.si > 0) goSec(st.si - 1, { zone: 'side' });
      else if (R) mv({ zone: 'main' });
      return;
    }
    if (st.zone === 'search') { if (D) mv({ zone: 'main' }); else if (L) mv({ zone: 'side' }); return; }
    if (sec === 'lib' || sec === 'cat') {
      const col = st.fi % COLS;
      if (R && st.fi < grid.length - 1 && col < COLS - 1) mv({ fi: st.fi + 1 });
      else if (L) { if (col > 0) mv({ fi: st.fi - 1 }); else mv({ zone: 'side' }); }
      else if (D && st.fi + COLS < grid.length) mv({ fi: st.fi + COLS });
      else if (D && Math.floor(st.fi / COLS) < Math.floor((grid.length - 1) / COLS)) mv({ fi: grid.length - 1 });
      else if (U) { if (st.fi >= COLS) mv({ fi: st.fi - COLS }); else { sfx.play('move'); up({ zone: 'search' }); focusSearch(); } }
      return;
    }
    if (D && st.li < rows.length - 1) mv({ li: st.li + 1 }); else if (U && st.li > 0) mv({ li: st.li - 1 }); else if (L) mv({ zone: 'side' });
  });

  const hints: Hint[] = st.menu ? [['ok', 'Confirmar'], ['back', 'Fechar']]
    : st.zone === 'side' ? [['ud', 'Seção'], ['ok', 'Abrir'], ['back', 'Sair']]
    : (sec === 'lib' || sec === 'cat') ? [['ok', 'Ver jogo'], ['x', 'Opções'], ['y', 'Buscar'], ['rb', 'Seção'], ['back', 'Voltar']]
    : [['ok', sec === 'cfg' ? 'Confirmar' : 'Abrir'], ['rb', 'Seção'], ['back', 'Voltar']];
  const hero = sec === 'lib' ? cur ?? lib[0] ?? null : null;

  return (
    <section className="view hub sk-pc" style={{ ['--cc' as string]: c.color }}>
      <Fit w={1920} h={1080} className="pc" style={{ ['--cc' as string]: c.color }}>
        {sec === 'cat' && !game && (
          <Discover theme="d-pc" cname={c.name} games={data.catalog} extra={data.lib.filter(x => !x.catalog)} self={self} st={dst} set={setDst}
            options={x => options(x).filter(o => o.k !== 'info').map(o => ({ k: o.k, l: o.l, icon: <Ic n={o.ic} /> }))}
            run={run} onOpen={openGame} onBack={() => goSec(0, { zone: 'side' })} />
        )}
        <aside className="pc-side">
          <div className="brand"><i><Ic n="pad" /></i>{c.name}</div>
          {SIDE.map(([k, l, ic], i) => {
            const n = k === 'news' ? data.feed.length : k === 'cat' ? data.catalog.filter(x => x.isNew).length : 0;
            return (
              <button key={k} className={`${i === st.si ? 'cur' : ''} ${st.zone === 'side' && i === st.si && !game ? 'on' : ''}`} onClick={() => goSec(i, { zone: 'main' })}>
                <Ic n={ic} />{l}{n > 0 && <span className="n">{n}</span>}
              </button>
            );
          })}
          <div className="sp" />
          <button onClick={() => { sfx.play('back'); onBack(); }}><Ic n="back" />Voltar ao Cartucho</button>
          <div className="me"><i><Ic n="clock" /></i><span>{fmtPlay(data.playMs) || '0m'} jogados<br />{clock}</span></div>
        </aside>
        <main className="pc-main" ref={mainRef}>
          {game ? null : (
            <div className="pc-pg" key={sec}>
              {(sec === 'lib' || sec === 'cat') && (
                <>
                  {sec === 'lib' && hero && <Hero g={hero} />}
                  <div className={`pc-bar ${st.zone === 'search' ? 'on' : ''}`}>
                    <Ic n="search" />
                    <SearchBox ref={searchRef} value={query} onChange={v => { setQuery(v); up({ fi: 0 }); }} nav={false} className="pc-q" placeholder={sec === 'lib' ? 'Buscar na biblioteca' : 'Buscar no catálogo'}
                      onDone={() => up({ zone: 'main', fi: 0 })} />
                    <span className="cnt">{plural(grid.length, 'jogo', 'jogos')}{sec === 'lib' ? ` · ${fmtPlay(data.playMs) || '0m'} no total` : ''}</span>
                  </div>
                  {grid.length ? (
                    <div className="pc-grid">{grid.map((x, j) => (
                      <button key={x.key} className={`pc-cap ${st.zone === 'main' && j === st.fi ? 'on' : ''} ${x.installed ? '' : 'ghost'} ${x.installed?.missing ? 'missing' : ''}`}
                        onClick={() => { if (st.zone === 'main' && st.fi === j) enter(); else { sfx.play('move'); up({ zone: 'main', fi: j }); } }}>
                        <span className="cv-w"><Art g={x} v="cover" />{x.isNew && <span className="pc-tag new">NOVO</span>}{x.installed?.running && <span className="run"><Ic n="play" /></span>}</span>
                        <span className="t">{x.title}</span>
                        <span className="s">{x.installed ? (x.installed.missing ? 'pasta não encontrada' : fmtPlay(x.installed.playMs) || 'não jogado') : x.status ? STATUS_LABEL[x.status] : ''}</span>
                      </button>
                    ))}</div>
                  ) : <div className="pc-empty">{q ? `Nada encontrado para “${q}”.` : sec === 'lib' ? `Nenhum jogo instalado. ${plural(data.catalog.length, 'jogo', 'jogos')} em Descobrir.` : 'O catálogo ainda não tem nada aqui.'}</div>}
                </>
              )}
              {sec !== 'lib' && sec !== 'cat' && (
                <div className="pc-panel">
                  <h2>{SIDE[st.si]![1]}</h2>
                  <div className={sec === 'news' ? '' : 'pc-split'}>
                    <div className="pc-list">{rows.length ? rows.map((r, j) => (
                      <button key={r.key} className={`pc-r ${st.zone === 'main' && j === st.li ? 'on' : ''}`} onClick={() => { if (st.zone === 'main' && st.li === j) enter(); else { sfx.play('move'); up({ zone: 'main', li: j }); } }}>
                        {r.g ? <span className="th"><Art g={r.g} v="square" /></span> : r.ic ? <span className="th ic"><Ic n={r.ic} /></span> : null}
                        <span className="tx"><b>{r.t}</b>{r.s && <small>{r.s}</small>}</span>{r.v && <span className="v">{r.v}</span>}
                      </button>
                    )) : <div className="pc-empty">{sec === 'news' ? 'Nada novo por aqui. O Cartucho confere o Recompendium toda vez que abre.' : 'Nenhum jogo instalado ainda.'}</div>}</div>
                    {sec !== 'news' && <div className="pc-det"><Detail sec={sec} row={row} achList={ach.data?.list ?? []} achLoading={ach.isLoading} stats={row?.g ? stats.get(row.g.key) : undefined} statsAll={stats} lib={byPlay} playMs={data.playMs} sndOn={s.snd} /></div>}
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
        {st.menu && cur && !game && (
          <div className="pc-menu" onClick={() => up({ menu: false })}>
            <div className="w" onClick={e => e.stopPropagation()}>
              <h4>{cur.title}</h4>
              {options(cur).map((o, j) => <button key={o.k + j} className={j === st.mi ? 'on' : ''} onClick={() => { if (st.mi === j) enter(); else { sfx.play('move'); up({ mi: j }); } }}><Ic n={o.ic} />{o.l}</button>)}
            </div>
          </div>
        )}
        {game && <GameView theme="d-pc" g={game} self={self} run={run} onBack={() => up({ game: null })}
          opts={gameOpts.map(o => ({ k: o.k, l: o.l, icon: <Ic n={o.ic} /> }))} />}
        {sec !== 'cat' && !game && <div className="pc-ft">{hints.map(([a, t]) => <span key={a + t}><Glyph a={a} />{t}</span>)}</div>}
        {toast}
      </Fit>
      <BootOverlay kind="sweep" label={c.name.toUpperCase()} />
    </section>
  );
}

function Hero({ g }: { g: HubGame }) {
  const art = useArt(g.console, g.title, g.platformName);
  const bg = art.fanart ?? art.cover ?? g.coverUrl;
  const i = g.installed;
  return (
    <div className="pc-hero">
      <div className="art">{bg && <img key={bg} src={bg} alt="" />}</div>
      <div className="in">
        <small>{i?.lastPlayed ? 'Continuar jogando' : 'Na biblioteca'}</small>
        {art.logo ? <img className="logo" src={art.logo} alt={g.title} /> : <h1>{g.title}</h1>}
        <div className="meta">
          {i && <span>Jogado <b>{fmtPlay(i.playMs) || '0m'}</b></span>}
          {i?.lastPlayed && <span>Última vez <b>{ago(i.lastPlayed)}</b></span>}
          {g.status && <span className={`pc-tag ${g.status}`}>{STATUS_LABEL[g.status]}</span>}
        </div>
      </div>
    </div>
  );
}

function Detail({ sec, row, achList, achLoading, stats, statsAll, lib, playMs, sndOn }: {
  sec: Sec; row: Row | undefined; achList: AchievementView[]; achLoading: boolean; stats: PlayStats | undefined; statsAll: Map<string, PlayStats | undefined>; lib: HubGame[]; playMs: number; sndOn: boolean;
}) {
  if (!row) return null;
  if (sec === 'ach' && row.g) {
    if (!row.g.installed?.adapter) return <><h3>{row.g.title}</h3><p>O Cartucho ainda não sabe ler as conquistas deste port. Quando houver um leitor, elas aparecem aqui sozinhas.</p></>;
    const L = [...achList].sort((x, y) => (y.unlockedAt ?? -1) - (x.unlockedAt ?? -1));
    const got = L.filter(x => x.unlockedAt != null).length;
    return (
      <>
        <h3>{row.g.title}</h3>
        <div className="big">{got}/{L.length}<small>{L.length ? Math.round((got / L.length) * 100) : 0}%</small></div>
        <div className="bar"><i style={{ width: `${L.length ? (got / L.length) * 100 : 0}%` }} /></div>
        {achLoading && !L.length ? <p>Lendo…</p> : L.slice(0, 8).map(x => (
          <div key={x.id} className={`a ${x.unlockedAt != null ? '' : 'lock'}`}>
            <span className="md">{x.icon ? <img src={x.icon} alt="" /> : <Ic n={x.unlockedAt != null ? 'medal' : 'lock'} />}</span>
            <span className="t"><b>{x.name}</b><small>{x.description}</small></span><span className="d">{x.unlockedAt != null ? fmtDate(x.unlockedAt) : 'Bloqueada'}</span>
          </div>
        ))}
      </>
    );
  }
  if (sec === 'time') {
    if (!row.g) {
      const ses = lib.reduce((a, g) => a + (statsAll.get(g.key)?.sessions ?? 0), 0);
      const mx = Math.max(1, ...lib.map(x => x.installed?.playMs ?? 0));
      return (
        <>
          <h3>Neste console</h3><div className="big">{fmtPlay(playMs) || '0m'}<small>{plural(ses, 'sessão', 'sessões')}</small></div>
          {lib.slice(0, 8).map(x => <div key={x.key} className="rk"><span>{x.title}</span><span className="bar"><i style={{ width: `${((x.installed?.playMs ?? 0) / mx) * 100}%` }} /></span><span>{fmtPlay(x.installed?.playMs ?? 0) || '0m'}</span></div>)}
        </>
      );
    }
    const i = row.g.installed!, d = stats?.days ?? Array(14).fill(0), m = Math.max(...d, 0.01);
    return (
      <>
        <h3>{row.g.title}</h3>
        <div className="big">{fmtPlay(i.playMs) || '0m'}<small>{plural(stats?.sessions ?? 0, 'sessão', 'sessões')}{i.lastPlayed ? ` · ${ago(i.lastPlayed)}` : ''}</small></div>
        <div className="bars">{d.map((v, j) => <i key={j} className={v ? '' : 'z'} style={{ height: `${v ? Math.max(4, (v / m) * 100) : 2}%` }} />)}</div>
        <p className="mut">Últimos 14 dias</p>
      </>
    );
  }
  if (sec === 'cfg') {
    if (row.id === 'dir') return <><h3>{row.t}</h3><p>Onde o Cartucho instala o que você baixa. Jogos adicionados com “Escolher pasta” continuam onde estão.</p><div className="path"><PortsDir /></div></>;
    if (row.id === 'snd') return <><h3>{row.t}</h3><p>Sons da interface: {sndOn ? 'ligados' : 'desligados'}. Enter alterna.</p></>;
    if (row.id === 'radar') return <><h3>{row.t}</h3><p>O radar confere o catálogo do Recompendium toda vez que o Cartucho abre.</p></>;
    return <><h3>{row.t}</h3><p>Volta para o palco do Cartucho.</p></>;
  }
  return null;
}

function PortsDir() {
  const trpc = useTRPC();
  const q = useQuery(trpc.settings.portsDir.queryOptions());
  return <>{q.data ?? '…'}</>;
}
