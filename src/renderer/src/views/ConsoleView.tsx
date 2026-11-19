/**
 * Hub provisório de cada console: seus jogos daquele console, o que existe no catálogo e as conquistas.
 * A interface no estilo de cada console (a do protótipo) substitui esta tela nas próximas etapas.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CatalogGame, ConsoleId, InstalledGame } from '@shared/types';
import { CONSOLE_NAME, isSelfInstall, STATUS_LABEL } from '@shared/consoles';
import { useTRPC } from '../trpc';
import { Hints } from '../lib/input';
import { useSpatialNav } from '../lib/spatial';
import { ago, fmtDate, fmtPlay, plural } from '../lib/format';
import { sfx } from '../lib/sfx';
import { GameArt } from '../components/GameArt';
import { CONSOLES, otherConsoles } from '../stage/consoles';
import { useSettings } from '../lib/settings';
import { CatalogPage, GamePage } from './GamePages';

type Tab = 'lib' | 'cat';
interface Props { id: ConsoleId; game?: string; tab?: Tab; active: boolean; onBack: () => void }

export function ConsoleView({ id, game, tab: tab0, active, onBack }: Props) {
  const c = CONSOLES.find(x => x.id === id)!;
  const trpc = useTRPC(), qc = useQueryClient();
  const games = useQuery(trpc.games.list.queryOptions());
  // Outros junta os jogos sem lugar próprio no palco e os dos consoles que o usuário escondeu
  const s = useSettings();
  const group = id === 'other' ? otherConsoles(s.hidden) : [id];
  const mine = (games.data ?? []).filter(g => group.includes(g.console));
  const [only, setOnly] = useState<string | null>(null);   // Outros: só um console de origem
  const [tab, setTab] = useState<Tab>(tab0 ?? 'lib');
  type Open = { kind: 'game'; id: string } | { kind: 'ach'; id: string } | { kind: 'cat'; game: CatalogGame };
  const [open, setOpen] = useState<Open | null>(game ? { kind: 'game', id: game } : null);
  const installedBy = new Map((games.data ?? []).filter(g => g.catalogId).map(g => [g.catalogId!, g.id]));
  const [search, setSearch] = useState(''), [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 200); return () => clearTimeout(t); }, [search]);
  const cat = useQuery(trpc.catalog.list.queryOptions(id === 'other' ? { consoles: group, search: q || undefined } : { console: id, search: q || undefined }, { placeholderData: p => p }));
  const add = useMutation(trpc.games.addFromDialog.mutationOptions({ onSuccess: g => { void qc.invalidateQueries(); if (g) setOpen({ kind: 'game', id: g.id }); } }));

  // sem jogos deste console, abre direto no catálogo
  useEffect(() => { if (!tab0 && games.data && !mine.length) setTab('cat'); }, [games.data]);   // eslint-disable-line react-hooks/exhaustive-deps

  const root = useRef<HTMLDivElement>(null);
  const nav = useSpatialNav(root, {
    active: active && !open,
    onKey: k => {
      if (k === 'Escape') { sfx.play('back'); onBack(); return true; }
      if (k === 'LB' || k === 'RB' || k === 'Tab') { sfx.play('move'); setTab(t => (t === 'lib' ? 'cat' : 'lib')); nav.reset(); return true; }
    },
  });

  return (
    <section className="view chub" style={{ ['--cc' as string]: c.color }} aria-label={c.name}>
      {open?.kind === 'ach' ? <Achievements id={open.id} active={active} onBack={() => { sfx.play('back'); setOpen({ kind: 'game', id: open.id }); }} />
        : open?.kind === 'game' ? <GamePage key={open.id} id={open.id} active={active} onBack={() => setOpen(null)} onAchievements={() => setOpen({ kind: 'ach', id: open.id })} />
        : open?.kind === 'cat' ? <CatalogPage game={open.game} installedId={installedBy.get(open.game.id) ?? null} active={active} onBack={() => setOpen(null)} onOpenInstalled={gid => setOpen({ kind: 'game', id: gid })} />
        : (
        <div ref={root} style={{ display: 'contents' }}>
          <header className="chub-top">
            <button className="back" data-hf onClick={() => { sfx.play('back'); onBack(); }}>◀ CARTUCHO</button>
            <h1 className="glow">{c.name.toUpperCase()}</h1>
            <nav className="seg">
              <button className={tab === 'lib' ? 'on' : ''} data-hf onClick={() => setTab('lib')}>MEUS JOGOS {mine.length > 0 && <span className="n">{mine.length}</span>}</button>
              <button className={tab === 'cat' ? 'on' : ''} data-hf onClick={() => setTab('cat')}>DESCOBRIR</button>
            </nav>
            <span className="grow" />
            <button className="btn acc" data-hf disabled={add.isPending} onClick={() => add.mutate()}>{add.isPending ? 'Lendo a pasta…' : '+ Adicionar jogo'}</button>
          </header>
          <p className="chub-note">Versão provisória do hub. A interface no estilo do {c.name} chega numa próxima etapa.</p>
          {add.error && <p className="err">{add.error.message}</p>}
          {add.data && !add.data.adapter && <p className="warn">Adicionei <b>{add.data.title}</b>, mas ainda não sei ler as conquistas dele.</p>}

          <div className="chub-body">
            {tab === 'lib' ? (
              mine.length ? <BySource on={id === 'other'} items={mine} only={only} setOnly={setOnly} cls="rows"
                  render={g => <GameRow key={g.id} g={g} onOpen={() => { sfx.play('ok'); setOpen({ kind: 'game', id: g.id }); }} />} />
                : <EmptyLib />
            ) : (
              <>
                <div className="toolbar"><input className="search" placeholder={`Buscar entre ${plural(cat.data?.length ?? 0, 'recomp', 'recomps')}…`} value={search} onChange={e => setSearch(e.target.value)} /></div>
                {cat.data?.length === 0 && <p className="pad24 dim">{q ? 'Nada encontrado.' : 'Ainda não há recomps deste console no catálogo.'}</p>}
                <BySource on={id === 'other'} items={cat.data ?? []} only={only} setOnly={setOnly} cls="grid"
                  render={g => <GameCard key={g.id} g={g} installed={installedBy.has(g.id)} onOpen={() => { sfx.play('ok'); setOpen({ kind: 'cat', game: g }); }} />} />
                <p className="credit">Catálogo: <a href="https://recompendium.com/" target="_blank" rel="noreferrer">Recompendium</a></p>
              </>
            )}
          </div>
          <Hints items={[['ud', 'Navegar'], ['ok', 'Abrir'], ['lb', 'Aba'], ['back', 'Cartucho']]} />
        </div>
      )}
    </section>
  );
}

/** Console de origem de um jogo em Outros: o nome que o catálogo dá ("Game Boy Advance", "Xbox"…). */
const sourceOf = (g: { console: ConsoleId; platformName: string | null }) => g.platformName ?? (g.console === 'other' ? 'Outros' : CONSOLE_NAME[g.console]);

/** Em Outros, os jogos vêm em blocos por console de origem (o maior primeiro), com atalhos para ver um só. */
function BySource<T extends { console: ConsoleId; platformName: string | null }>({ on, items, only, setOnly, cls, render }: {
  on: boolean; items: T[]; only: string | null; setOnly: (s: string | null) => void; cls: string; render: (g: T) => ReactNode;
}) {
  if (!on) return <div className={cls}>{items.map(render)}</div>;
  const groups = new Map<string, T[]>();
  for (const g of items) { const k = sourceOf(g); groups.set(k, [...(groups.get(k) ?? []), g]); }
  const list = [...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const shown = only && groups.has(only) ? list.filter(([k]) => k === only) : list;
  const color = (g: T) => CONSOLES.find(c => c.id === g.console && c.id !== 'other')?.color;
  return (
    <>
      {list.length > 1 && (
        <div className="oth-chips">
          <button data-hf className={!only ? 'on' : ''} onClick={() => setOnly(null)}>Todos</button>
          {list.map(([k, gs]) => <button key={k} data-hf className={only === k ? 'on' : ''} onClick={() => setOnly(only === k ? null : k)}>{k} · {gs.length}</button>)}
        </div>
      )}
      {shown.map(([k, gs]) => (
        <section key={k} style={{ ['--cc' as string]: color(gs[0]!) }}>
          <h2 className="oth-sec">{k.toUpperCase()}<small>{plural(gs.length, 'jogo', 'jogos')}</small></h2>
          <div className={cls}>{gs.map(render)}</div>
        </section>
      ))}
    </>
  );
}

function EmptyLib() {
  const trpc = useTRPC();
  const supported = useQuery(trpc.achievements.supported.queryOptions());
  return (
    <div className="empty-box">
      <p>Nenhum jogo deste console na sua biblioteca. Use “Adicionar jogo” e aponte a pasta onde o recomp está instalado.</p>
      <p style={{ marginTop: 10 }}>Conquistas já funcionam com:</p>
      <ul>{supported.data?.map(s => <li key={s.id}>{s.label}</li>)}</ul>
    </div>
  );
}

function GameCard({ g, installed, onOpen }: { g: CatalogGame; installed: boolean; onOpen: () => void }) {
  return (
    <button className="lcard" data-hf onClick={onOpen}>
      <div style={{ position: 'relative' }}>
        <GameArt title={g.title} console={g.console} platformName={g.platformName} fallback={g.coverUrl} />
        <span className={`st st-${g.status}`}>{STATUS_LABEL[g.status]}</span>
        {installed && <span className="inlib">NA BIBLIOTECA</span>}
        {g.noLink && !isSelfInstall(g.console) && <span className="nolink" title="O Recompendium lista este projeto, mas prefere não pôr link para ele">SEM LINK</span>}
      </div>
      <div className="lmeta">
        <div className="title">{g.title}</div>
        <div className="dim">{['other', 'gb', 'megadrive'].includes(g.console) ? g.platformName : g.developer ?? ''}{g.year ? ` · ${g.year}` : ''}</div>
        {g.repo && <span className="repo">{g.repo}</span>}
      </div>
    </button>
  );
}

function GameRow({ g, onOpen }: { g: InstalledGame; onOpen: () => void }) {
  const a = g.achievements;
  const pct = a && a.total ? Math.round((a.unlocked / a.total) * 100) : 0;
  return (
    <button className="lrow" data-hf onClick={onOpen}>
      <GameArt title={g.title} console={g.console} platformName={g.platformName} fallback={g.coverUrl} className="thumb" />
      <div className="row-main">
        <div className="title">{g.title}</div>
        <div className="dim">{g.running ? 'jogando agora · ' : ''}{g.playMs ? `${fmtPlay(g.playMs)} jogadas` : 'ainda não jogado'}{g.lastPlayed ? ` · ${ago(g.lastPlayed)}` : ''}{g.version ? ` · ${g.version}` : ''} · {g.installDir}</div>
      </div>
      {a && a.total > 0 && (
        <div className="prog">
          <div className="prog-n">{a.unlocked}/{a.total}</div>
          <div className="pbar"><i style={{ width: `${pct}%` }} /></div>
        </div>
      )}
    </button>
  );
}

function Achievements({ id, active, onBack }: { id: string; active: boolean; onBack: () => void }) {
  const trpc = useTRPC(), qc = useQueryClient();
  const data = useQuery(trpc.achievements.forGame.queryOptions({ id }));
  const resync = useMutation(trpc.achievements.resync.mutationOptions({
    onSuccess: d => { qc.setQueryData(trpc.achievements.forGame.queryKey({ id }), d); void qc.invalidateQueries({ queryKey: trpc.games.list.queryKey() }); },
  }));
  const remove = useMutation(trpc.games.remove.mutationOptions({ onSuccess: () => { void qc.invalidateQueries(); onBack(); } }));
  const openFolder = useMutation(trpc.games.openFolder.mutationOptions());
  const [filter, setFilter] = useState<'all' | 'on' | 'off'>('all');
  const root = useRef<HTMLDivElement>(null);
  useSpatialNav(root, { active, onKey: k => { if (k === 'Escape') { onBack(); return true; } } });

  if (!data.data) return <p className="dim pad24">{data.error ? data.error.message : 'Carregando…'}</p>;
  const d = data.data;
  const got = d.list.filter(a => a.unlockedAt != null);
  const pts = d.list.reduce((s, a) => s + (a.points ?? 0), 0), gotPts = got.reduce((s, a) => s + (a.points ?? 0), 0);
  const shown = d.list.filter(a => filter === 'all' || (filter === 'on') === (a.unlockedAt != null)).sort((x, y) => (y.unlockedAt ?? -1) - (x.unlockedAt ?? -1));

  return (
    <div ref={root} style={{ display: 'contents' }}>
      <header className="chub-top">
        <button className="back" data-hf onClick={onBack}>◀ VOLTAR</button>
        <h1 className="glow" style={{ fontSize: 18 }}>{d.game.title}</h1>
        <span className="grow" />
        <button className="btn" data-hf disabled={resync.isPending} onClick={() => resync.mutate({ id })}>{resync.isPending ? 'Lendo…' : 'Ler de novo'}</button>
        <button className="btn ghost" data-hf onClick={() => openFolder.mutate({ id })}>Abrir pasta</button>
        <button className="btn ghost danger" data-hf onClick={() => { if (confirm(`Remover ${d.game.title} do Cartucho? Os arquivos do jogo não são apagados.`)) remove.mutate({ id }); }}>Remover</button>
      </header>
      <div className="chub-body">
        <div className="ach-head">
          <div className="achbig">{got.length}<span>/{d.list.length}</span></div>
          <div className="pbar wide"><i style={{ width: `${d.list.length ? (got.length / d.list.length) * 100 : 0}%` }} /></div>
          {pts > 0 && <div className="dim">{gotPts}/{pts} G</div>}
          <div className="seg small">
            {(['all', 'on', 'off'] as const).map(f => <button key={f} data-hf className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'Todas' : f === 'on' ? 'Desbloqueadas' : 'Bloqueadas'}</button>)}
          </div>
        </div>
        {d.errors.map(e => <p key={e} className="err">{e}</p>)}
        {!d.game.adapter && <p className="warn" style={{ margin: '0 28px' }}>O Cartucho ainda não sabe ler as conquistas deste jogo.</p>}
        <div className="ach-list">
          {shown.map(a => (
            <div key={a.id} className={`ach-item ${a.unlockedAt != null ? 'got' : 'locked'}`}>
              <Icon src={a.icon} />
              <div className="ach-main"><div className="title">{a.name}</div><div className="dim">{a.description}</div></div>
              <div className="ach-side">
                {a.points != null && <div className="pts">{a.points} G</div>}
                <div className="dim">{a.unlockedAt != null ? fmtDate(a.unlockedAt) : 'Bloqueada'}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="credit">Lista: {d.origin ?? '—'}<br />Desbloqueios lidos de: {d.unlockFile ?? '—'}</p>
      </div>
      <Hints items={[['ok', 'Escolher'], ['back', 'Voltar']]} />
    </div>
  );
}

function Icon({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(false);
  return <div className="achico">{src && !broken ? <img src={src} alt="" onError={() => setBroken(true)} /> : <span>★</span>}</div>;
}
