import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '../trpc';
import { SELF_INSTALL_NOTE, STATUS_LABEL } from '@shared/consoles';
import { Glyph, useKeys, type Key } from '../lib/input';
import { sfx } from '../lib/sfx';
import { fmtPlay } from '../lib/format';
import { useArt, useInfo, useShots } from '../lib/art';
import { useTranslated } from '../lib/translate';
import { GameArt } from './GameArt';
import { useGameProgress, type HubGame } from '../hubs/data';
import type { DOpt } from './Discover';

type Zone = 'score' | 'acts' | 'shots' | 'text';
const MAIN = new Set(['update', 'ach', 'install', 'add', 'reinstall', 'relink', 'remove']);

export function GameView({ theme, g, opts: base, run, onBack, self, logo = true, extra }: {
  theme: string; g: HubGame; opts: DOpt[]; run: (k: string, g: HubGame) => void; onBack: () => void; self: boolean; logo?: boolean; extra?: ReactNode;
}) {
  const art = useArt(g.console, g.title, g.platformName);
  const shots = useShots(g.console, g.title, g.platformName);
  const info = useInfo(g.console, g.title, g.platformName, g.installed?.id, g.catalog?.id);
  const about = useTranslated(g.catalog?.description || (info?.lang === 'en' ? info.overview : null));
  const aboutText = about.text || (info?.lang === 'pt' ? info.overview ?? '' : '');
  const score = info?.score ?? null;
  const needs = useTranslated(g.catalog?.needs);
  const p = useGameProgress(g);
  const inst = g.installed;
  const trpc = useTRPC();
  const [note, setNote] = useState<string | null>(null);
  const lnk = useMutation(trpc.background.shortcut.mutationOptions({ onSuccess: () => setNote('Atalho criado na Área de Trabalho. Ele abre o jogo pelo Cartucho e conta o tempo.'), onError: e => setNote(e.message) }));
  const qc = useQueryClient();
  const dir = useMutation(trpc.games.relink.mutationOptions({
    onSuccess: r => { if (r) { setNote(`Pasta trocada para ${r.installDir}.`); void qc.invalidateQueries(); } },
    onError: e => setNote(e.message),
  }));
  const opts: DOpt[] = [
    ...base,
    ...(inst && !inst.missing && !base.some(o => o.k === 'relink') ? [{ k: '__dir', l: 'Trocar a pasta' }] : []),
    ...(inst && !inst.missing && inst.exe && navigator.userAgent.includes('Windows') ? [{ k: '__lnk', l: 'Atalho na Área de Trabalho' }] : []),
  ];
  const main = opts.filter((o, j) => j === 0 || MAIN.has(o.k)), rest = opts.filter((o, j) => j !== 0 && !MAIN.has(o.k));
  const shown: DOpt[] = rest.length > 1 ? [...main, { k: '__more', l: 'Mais opções' }] : [...main, ...rest];
  const [more, setMore] = useState(false);
  const [mi, setMi] = useState(0);
  const tone = score ? (score.value >= 75 ? 'hi' : score.value >= 50 ? 'mid' : 'lo') : '';
  const openScore = () => { if (!score?.url) return; sfx.play('ok'); window.open(score.url); };
  const [zone, setZone] = useState<Zone>('acts');
  const [ai, setAi] = useState(0);
  const [si, setSi] = useState(0);
  const [view, setView] = useState<number | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => { setNote(null); setZone('acts'); setAi(0); setSi(0); setView(null); setMore(false); scroll.current?.scrollTo({ top: 0 }); }, [g.key]);
  useEffect(() => { if (ai >= shown.length && shown.length) setAi(shown.length - 1); }, [shown.length]);
  useEffect(() => { if (zone === 'score' && !score) setZone('acts'); }, [zone, score]);

  useEffect(() => {
    const el = scroll.current; if (!el) return;
    if (zone === 'acts' || zone === 'score') el.scrollTo({ top: 0, behavior: 'smooth' });
    else if (zone === 'shots') el.querySelector('.gv-shots')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else el.querySelector('.gv-text')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [zone]);
  useEffect(() => { strip.current?.children[si]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }, [si]);

  const mv = (f: () => void) => { sfx.play('move'); f(); };
  const runOpt = (o: DOpt | undefined) => { if (!o) return; setMore(false); if (o.k === '__lnk') { sfx.play('ok'); lnk.mutate({ id: inst!.id }); } else if (o.k === '__dir') { sfx.play('ok'); dir.mutate({ id: inst!.id }); } else run(o.k, g); };
  const act = (j: number) => { const o = shown[j]; if (o?.k === '__more') { sfx.play(more ? 'back' : 'ok'); setMi(0); setMore(!more); } else runOpt(o); };

  useKeys((k: Key) => {
    const R = k === 'ArrowRight', L = k === 'ArrowLeft', U = k === 'ArrowUp', D = k === 'ArrowDown';
    if (view != null) {
      if (k === 'Escape' || k === 'Enter') { sfx.play('back'); setView(null); }
      else if (R && view < shots.length - 1) mv(() => setView(view + 1));
      else if (L && view > 0) mv(() => setView(view - 1));
      return;
    }
    if (more) {
      if (k === 'Enter') { sfx.play('ok'); return runOpt(rest[mi]); }
      if (D && mi < rest.length - 1) mv(() => setMi(mi + 1));
      else if (U && mi > 0) mv(() => setMi(mi - 1));
      else if (k === 'Escape' || L || R || (U && mi === 0)) { sfx.play('back'); setMore(false); }
      return;
    }
    if (zone === 'score') {
      if (k === 'Enter') return openScore();
      if (D || k === 'Escape') mv(() => setZone('acts'));
      return;
    }
    if (k === 'Escape') { sfx.play('back'); return onBack(); }
    if (zone === 'acts') {
      if (k === 'Enter') return act(ai);
      if (R && ai < shown.length - 1) mv(() => setAi(ai + 1));
      else if (L && ai > 0) mv(() => setAi(ai - 1));
      else if (U && score) mv(() => setZone('score'));
      else if (D) mv(() => setZone(shots.length ? 'shots' : 'text'));
      return;
    }
    if (zone === 'shots') {
      if (k === 'Enter') { sfx.play('ok'); return setView(si); }
      if (R && si < shots.length - 1) mv(() => setSi(si + 1));
      else if (L && si > 0) mv(() => setSi(si - 1));
      else if (U) mv(() => setZone('acts'));
      else if (D) mv(() => setZone('text'));
      return;
    }
    const el = scroll.current;
    if (D || k === 'RT') { sfx.play('move'); el?.scrollBy({ top: k === 'RT' ? 600 : 160, behavior: 'smooth' }); }
    else if (U || k === 'LT') {
      if (!el || el.scrollTop <= el.querySelector<HTMLElement>('.gv-text')!.offsetTop - 40) mv(() => setZone(shots.length ? 'shots' : 'acts'));
      else { sfx.play('move'); el.scrollBy({ top: k === 'LT' ? -600 : -160, behavior: 'smooth' }); }
    }
  });

  const bg = art.fanart ?? art.cover ?? g.coverUrl;
  const meta = [g.catalog?.developer || info?.developer, g.catalog?.year || info?.year, g.platformName].filter(Boolean).join(' · ');
  const hint = (a: Parameters<typeof Glyph>[0]['a'], t: string): ReactNode => <span key={a + t}><Glyph a={a} />{t}</span>;

  return (
    <div className={`dsc gv ${theme}`}>
      <div className={`gv-bg ${art.fanart ? '' : 'soft'}`}>{bg && <img src={bg} alt="" />}</div>
      <div className="gv-scroll" ref={scroll}>
        <div className="gv-hero">
          <span className="gv-cover"><GameArt title={g.title} console={g.console} platformName={g.platformName} fallback={g.coverUrl} variant="cover" /></span>
          <div className="gv-head">
            {logo && art.logo ? <img className="gv-logo" src={art.logo} alt={g.title} /> : <h1>{g.title}</h1>}
            {meta && <p className="gv-meta">{meta}</p>}
            <div className="gv-pills">
              {score && (
                <span className={`pill score ${tone} ${zone === 'score' ? 'on' : ''}`} onClick={openScore}>
                  {score.value}
                  <span className="gv-pop">
                    <b>{score.by === 'IGDB' ? 'Média da crítica' : `Nota do ${score.by}`}</b>
                    <span>{score.platform ? `Versão de ${score.platform}` : 'Média da crítica especializada'}</span>
                    <small>Fonte: {score.via === 'Steam' ? 'loja da Steam' : score.via === 'IGDB' ? 'IGDB.com' : 'Wikidata'}{score.url ? ' · abrir a página com OK ou clique' : ''}</small>
                  </span>
                </span>
              )}
              {g.status && <span className={`pill ${g.status}`}>{STATUS_LABEL[g.status]}</span>}
              {g.isNew && <span className="pill new">Novo no catálogo</span>}
              {inst && !inst.missing && <span className="pill inst">{inst.running ? 'Jogando agora' : inst.playMs ? `${fmtPlay(inst.playMs)} jogadas` : 'Instalado · ainda não jogado'}</span>}
              {inst?.achievements?.total ? <span className="pill">{inst.achievements.unlocked}/{inst.achievements.total} conquistas</span> : null}
              {g.update?.updateAvailable && !self && <span className="pill new">Versão {g.update.latest?.tag} disponível</span>}
            </div>
            {inst?.missing && <p className="gv-warn">A pasta do jogo não foi encontrada em {inst.installDir}.</p>}
            {p && <div className="gv-prog"><span>{p.error ?? p.stage}</span>{!p.error && p.pct > 0 && p.pct < 1 && <i style={{ width: `${Math.round(p.pct * 100)}%` }} />}</div>}
            {note && <p className="gv-note">{note}</p>}
            <div className="gv-acts">{shown.map((o, j) => (
              <span key={o.k + j} className="gv-aw">
                <button className={`${j === 0 ? 'pri' : ''} ${o.k === '__more' ? 'more' : ''} ${zone === 'acts' && ai === j && !more ? 'on' : ''} ${o.k === '__more' && more ? 'open' : ''}`}
                  onClick={() => { if (zone === 'acts' && ai === j) act(j); else mv(() => { setZone('acts'); setAi(j); setMore(false); }); }}>
                  {o.icon}{o.l}{o.k === '__more' && <i className="gv-caret">▾</i>}
                </button>
                {o.k === '__more' && more && (
                  <span className="gv-menu">{rest.map((r, n) => (
                    <button key={r.k + n} className={mi === n ? 'on' : ''} onMouseEnter={() => setMi(n)} onClick={() => { sfx.play('ok'); runOpt(r); }}>{r.icon}{r.l}</button>
                  ))}</span>
                )}
              </span>
            ))}</div>
          </div>
        </div>
        <section className="gv-sec">
          <h3>Imagens</h3>
          {shots.length ? <div className="gv-shots" ref={strip}>{shots.map((u, j) => (
            <button key={u} className={zone === 'shots' && si === j ? 'on' : ''} onClick={() => { sfx.play('ok'); setZone('shots'); setSi(j); setView(j); }}><img src={u} alt="" /></button>
          ))}</div> : <p className="dim">Sem capturas de tela para este jogo.</p>}
        </section>
        <section className={`gv-sec gv-text ${zone === 'text' ? 'on' : ''}`}>
          {aboutText && <><h3>Sobre</h3><p>{aboutText}</p></>}
          {needs.text && <><h3>O que você precisa</h3><p>{needs.text}</p></>}
          {self && !inst && <p className="dim">{SELF_INSTALL_NOTE}</p>}
          {!aboutText && !needs.text && <p className="dim">Ainda não há descrição deste jogo.</p>}
          {(about.auto || needs.auto) && <small>Traduzido automaticamente do inglês</small>}
        </section>
        {extra && <section className="gv-sec gv-extra">{extra}</section>}
      </div>
      <div className="dsc-ft">
        {view != null ? [hint('lr', 'Imagem'), hint('back', 'Fechar')]
          : more ? [hint('ud', 'Escolher'), hint('ok', rest[mi]?.l ?? 'OK'), hint('back', 'Fechar')]
          : zone === 'score' ? [hint('ok', 'Abrir a página'), hint('ud', 'Ações'), hint('back', 'Voltar')]
          : zone === 'acts' ? [hint('ok', shown[ai]?.l ?? 'OK'), hint('lr', 'Ações'), hint('ud', score ? 'Nota, imagens e texto' : 'Imagens e texto'), hint('back', 'Voltar')]
          : zone === 'shots' ? [hint('ok', 'Ampliar'), hint('lr', 'Imagens'), hint('ud', 'Rolar'), hint('back', 'Voltar')]
          : [hint('ud', 'Rolar'), hint('back', 'Voltar')]}
      </div>
      {view != null && shots[view] && (
        <div className="gv-view" onClick={() => setView(null)}><img src={shots[view]} alt="" /><span>{view + 1} / {shots.length}</span></div>
      )}
    </div>
  );
}
