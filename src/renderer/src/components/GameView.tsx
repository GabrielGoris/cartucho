import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '../trpc';
import { SELF_INSTALL_NOTE, STATUS_LABEL } from '@shared/consoles';
import { Glyph, useKeys, type Key } from '../lib/input';
import { openWeb } from '../lib/web';
import { askConfirm } from '../lib/dialogs';
import { sfx } from '../lib/sfx';
import { fmtPlay } from '../lib/format';
import { useArt, useInfo, useShots } from '../lib/art';
import { useTranslated } from '../lib/translate';
import { GameArt } from './GameArt';
import { useGameProgress, type HubGame } from '../hubs/data';
import type { DOpt } from './Discover';
import { WineDialog } from './WineDialog';
import { getLang, tt } from '@shared/i18n';

type Zone = 'score' | 'acts' | 'shots' | 'text';
const MAIN = new Set(['update', 'ach', 'install', 'add', 'reinstall', 'relink', 'remove']);

export function GameView({ theme, g, opts: base, run, onBack, self, logo = true, extra }: {
  theme: string; g: HubGame; opts: DOpt[]; run: (k: string, g: HubGame) => void; onBack: () => void; self: boolean; logo?: boolean; extra?: ReactNode;
}) {
  const art = useArt(g.console, g.title, g.platformName);
  const lbShots = useShots(g.console, g.title, g.platformName);
  const capsQ = useQuery(useTRPC().ingame.shots.queryOptions({ title: g.title }, { enabled: !!g.installed }));
  const caps = capsQ.data ?? [];
  const shots = [...caps, ...lbShots];
  const info = useInfo(g.console, g.title, g.platformName, g.installed?.id, g.catalog?.id);
  const about = useTranslated(g.catalog?.description || (info?.lang === 'en' ? info.overview : null));
  const aboutText = about.text || (info?.lang === getLang() ? info.overview ?? '' : '');
  const score = info?.score ?? null;
  const hrs = (h: number) => `${Math.floor(h)}h${h % 1 ? '30' : ''}`;
  const ttb = info?.ttb ?? null;
  const ttbMain: [string, number] | null = ttb ? (ttb.h ? [tt('Campanha'), ttb.h] : ttb.n ? [tt('Com extras'), ttb.n] : ttb.c ? ['100%', ttb.c] : null) : null;
  const needs = useTranslated(g.catalog?.needs);
  const p = useGameProgress(g);
  const inst = g.installed;
  const trpc = useTRPC();
  const [note, setNote] = useState<string | null>(null);
  const lnk = useMutation(trpc.background.shortcut.mutationOptions({ onSuccess: () => setNote(tt('Atalho criado na Área de Trabalho. Ele abre o jogo pelo Cartucho e conta o tempo.')), onError: e => setNote(e.message) }));
  const qc = useQueryClient();
  const openShots = useMutation(trpc.ingame.openShots.mutationOptions());
  const dropShot = useMutation(trpc.ingame.removeShot.mutationOptions({ onSuccess: () => void qc.invalidateQueries({ queryKey: trpc.ingame.shots.pathKey() }) }));
  const askDrop = (j: number) => {
    const u = caps[j]; if (!u) return;
    sfx.play('ok');
    void askConfirm({ title: tt('Excluir esta captura?'), text: tt('A imagem vai para a Lixeira.'), ok: tt('Excluir'), cancel: tt('Manter'), danger: true }).then(y => {
      if (!y) return;
      dropShot.mutate({ url: u });
      setView(v => (v == null ? v : shots.length - 1 <= 1 ? null : Math.min(v, shots.length - 2)));
      setSi(x => Math.max(0, Math.min(x, shots.length - 2)));
    });
  };
  const plat = useMutation(trpc.games.changePlatform.mutationOptions({ onSuccess: () => void qc.invalidateQueries() }));
  const dir = useMutation(trpc.games.relink.mutationOptions({
    onSuccess: r => { if (r) { setNote(tt('Pasta trocada para {0}.', { 0: r.installDir })); void qc.invalidateQueries(); } },
    onError: e => setNote(e.message),
  }));
  const opts: DOpt[] = [
    ...base,
    ...(inst && !inst.missing && !base.some(o => o.k === 'relink') ? [{ k: '__dir', l: tt('Trocar a pasta') }] : []),
    ...(inst && !inst.missing && inst.exe && /Windows|Linux/.test(navigator.userAgent) ? [{ k: '__lnk', l: tt('Atalho na Área de Trabalho') }] : []),
    ...(inst && !inst.missing && inst.exe && navigator.userAgent.includes('Linux') && /\.(exe|bat|cmd|lnk)$/i.test(inst.exe) ? [{ k: '__wine', l: tt('Opções do Wine') }] : []),
    ...(inst && !g.catalog ? [{ k: '__plat', l: tt('Trocar a plataforma') }] : []),
    ...(caps.length ? [{ k: '__shots', l: tt('Abrir pasta das capturas') }] : []),
  ];
  const main = opts.filter((o, j) => j === 0 || MAIN.has(o.k)), rest = opts.filter((o, j) => j !== 0 && !MAIN.has(o.k));
  const shown: DOpt[] = rest.length > 1 ? [...main, { k: '__more', l: tt('Mais opções') }] : [...main, ...rest];
  const [more, setMore] = useState(false);
  const [wine, setWine] = useState(false);
  const [mi, setMi] = useState(0);
  const tone = score ? (score.value >= 75 ? 'hi' : score.value >= 50 ? 'mid' : 'lo') : '';
  const tops = [score ? 'score' : null, 'ttb'].filter((x): x is 'score' | 'ttb' => !!x);
  const [pi, setPi] = useState(0);
  const topNow = tops[Math.min(pi, tops.length - 1)];
  const openScore = () => { if (!score?.url) return; sfx.play('ok'); window.open(score.url); };
  const openTtb = () => { sfx.play('ok'); openWeb(`https://howlongtobeat.com/?q=${encodeURIComponent(g.title)}`, `${g.title} · HowLongToBeat`); };
  const [zone, setZone] = useState<Zone>('acts');
  const [ai, setAi] = useState(0);
  const [si, setSi] = useState(0);
  const [view, setView] = useState<number | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => { setNote(null); setZone('acts'); setAi(0); setSi(0); setView(null); setMore(false); scroll.current?.scrollTo({ top: 0 }); }, [g.key]);
  useEffect(() => { if (ai >= shown.length && shown.length) setAi(shown.length - 1); }, [shown.length]);
  useEffect(() => { if (zone === 'score' && !tops.length) setZone('acts'); }, [zone, tops.length]);

  useEffect(() => {
    const el = scroll.current; if (!el) return;
    if (zone === 'acts' || zone === 'score') el.scrollTo({ top: 0, behavior: 'smooth' });
    else if (zone === 'shots') el.querySelector('.gv-shots')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else el.querySelector('.gv-text')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [zone]);
  useEffect(() => { strip.current?.children[si]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }, [si]);
  useEffect(() => { if (more) scroll.current?.querySelector('.gv-menu .on')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [more, mi]);

  const mv = (f: () => void) => { sfx.play('move'); f(); };
  const runOpt = (o: DOpt | undefined) => { if (!o) return; setMore(false); if (o.k === '__lnk') { sfx.play('ok'); lnk.mutate({ id: inst!.id }); } else if (o.k === '__wine') { sfx.play('ok'); setWine(true); } else if (o.k === '__dir') { sfx.play('ok'); dir.mutate({ id: inst!.id }); } else if (o.k === '__plat') { sfx.play('ok'); plat.mutate({ id: inst!.id }); } else if (o.k === '__shots') { sfx.play('ok'); openShots.mutate({ title: g.title }); } else run(o.k, g); };
  const act = (j: number) => { const o = shown[j]; if (o?.k === '__more') { sfx.play(more ? 'back' : 'ok'); setMi(0); setMore(!more); } else runOpt(o); };

  useKeys((k: Key) => {
    if (wine) return;
    const R = k === 'ArrowRight', L = k === 'ArrowLeft', U = k === 'ArrowUp', D = k === 'ArrowDown';
    if (view != null) {
      if (k === 'X' && view < caps.length) return askDrop(view);
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
      if (k === 'Enter') return topNow === 'ttb' ? openTtb() : openScore();
      if (R && pi < tops.length - 1) mv(() => setPi(pi + 1));
      else if (L && pi > 0) mv(() => setPi(pi - 1));
      else if (D || k === 'Escape') mv(() => setZone('acts'));
      return;
    }
    if (k === 'Escape') { sfx.play('back'); return onBack(); }
    if (zone === 'acts') {
      if (k === 'Enter') return act(ai);
      if (R && ai < shown.length - 1) mv(() => setAi(ai + 1));
      else if (L && ai > 0) mv(() => setAi(ai - 1));
      else if (U && tops.length) mv(() => { setPi(0); setZone('score'); });
      else if (D) mv(() => setZone(shots.length ? 'shots' : 'text'));
      return;
    }
    if (zone === 'shots') {
      if (k === 'Enter') { sfx.play('ok'); return setView(si); }
      if (k === 'X' && si < caps.length) return askDrop(si);
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
                <span className={`pill score ${tone} ${zone === 'score' && topNow === 'score' ? 'on' : ''}`} onClick={openScore}>
                  {score.value}
                  <span className="gv-pop">
                    <b>{score.by === 'IGDB' ? tt('Média da crítica') : tt('Nota do {0}', { 0: score.by })}</b>
                    <span>{score.platform ? tt('Versão de {0}', { 0: score.platform }) : tt('Média da crítica especializada')}</span>
                    <small>{tt('Fonte: {0}{1}', { 0: score.via === 'Steam' ? tt('loja da Steam') : score.via === 'IGDB' ? 'IGDB.com' : tt('Wikidata'), 1: score.url ? tt(' · abrir a página com OK ou clique') : '' })}</small>
                  </span>
                </span>
              )}
              <span className={`pill ttb ${ttbMain ? '' : 'ask'} ${zone === 'score' && topNow === 'ttb' ? 'on' : ''}`} onClick={openTtb}>
                {ttbMain ? `${ttbMain[0]}: ${hrs(ttbMain[1])}` : tt('Ver tempo para zerar')}
                <span className="gv-pop">
                  <b>{tt('Tempo para zerar')}</b>
                  {ttb?.h ? <span>{tt('Campanha: {0}', { 0: hrs(ttb.h) })}</span> : null}
                  {ttb?.n ? <span>{tt('Campanha com extras: {0}', { 0: hrs(ttb.n) })}</span> : null}
                  {ttb?.c ? <span>100%: {hrs(ttb.c)}</span> : null}
                  {!ttbMain && <span>{tt('Ainda sem uma média confiável no IGDB.com.')}</span>}
                  <small>{tt('{0}OK ou clique abre o HowLongToBeat aqui no Cartucho', { 0: ttbMain ? tt('Média de jogadores no IGDB.com · ') : '' })}</small>
                </span>
              </span>
              {g.status && <span className={`pill ${g.status}`}>{STATUS_LABEL[g.status]}</span>}
              {g.isNew && <span className="pill new">{tt('Novo no catálogo')}</span>}
              {inst && !inst.missing && <span className="pill inst">{inst.running ? tt('Jogando agora') : inst.playMs ? tt('{0} jogadas', { 0: fmtPlay(inst.playMs) }) : tt('Instalado · ainda não jogado')}</span>}
              {inst?.achievements?.total ? <span className="pill">{tt('{0}/{1} conquistas', { 0: inst.achievements.unlocked, 1: inst.achievements.total })}</span> : null}
              {g.update?.updateAvailable && !self && <span className="pill new">{tt('Versão {0} disponível', { 0: g.update.latest?.tag })}</span>}
            </div>
            {inst?.missing && <p className="gv-warn">{tt('A pasta do jogo não foi encontrada em {0}.', { 0: inst.installDir })}</p>}
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
          <h3>{caps.length ? tt('Galeria') : tt('Imagens')}</h3>
          {shots.length ? <div className="gv-shots" ref={strip}>{shots.map((u, j) => (
            <button key={u} className={`${zone === 'shots' && si === j ? 'on' : ''} ${j < caps.length ? 'mine' : ''}`} onClick={() => { sfx.play('ok'); setZone('shots'); setSi(j); setView(j); }}><img src={u} alt="" /></button>
          ))}</div> : <p className="dim">{tt('Sem capturas de tela para este jogo.')}</p>}
        </section>
        <section className={`gv-sec gv-text ${zone === 'text' ? 'on' : ''}`}>
          {aboutText && <><h3>{tt('Sobre')}</h3><p>{aboutText}</p></>}
          {needs.text && <><h3>{tt('O que você precisa')}</h3><p>{needs.text}</p></>}
          {self && !inst && <p className="dim">{SELF_INSTALL_NOTE}</p>}
          {!aboutText && !needs.text && <p className="dim">{tt('Ainda não há descrição deste jogo.')}</p>}
          {(about.auto || needs.auto) && <small>{tt('Traduzido automaticamente do inglês')}</small>}
        </section>
        {extra && <section className="gv-sec gv-extra">{extra}</section>}
      </div>
      <div className="dsc-ft">
        {view != null ? [hint('lr', tt('Imagem')), ...(view < caps.length ? [hint('x', tt('Excluir captura'))] : []), hint('back', tt('Fechar'))]
          : more ? [hint('ud', tt('Escolher')), hint('ok', rest[mi]?.l ?? 'OK'), hint('back', tt('Fechar'))]
          : zone === 'score' ? [hint('ok', topNow === 'ttb' ? tt('Abrir o HowLongToBeat') : tt('Abrir a página')), ...(tops.length > 1 ? [hint('lr', tt('Escolher'))] : []), hint('ud', tt('Ações')), hint('back', tt('Voltar'))]
          : zone === 'acts' ? [hint('ok', shown[ai]?.l ?? 'OK'), hint('lr', tt('Ações')), hint('ud', tops.length ? tt('Nota, imagens e texto') : tt('Imagens e texto')), hint('back', tt('Voltar'))]
          : zone === 'shots' ? [hint('ok', tt('Ampliar')), hint('lr', tt('Imagens')), ...(si < caps.length ? [hint('x', tt('Excluir captura'))] : []), hint('ud', tt('Rolar')), hint('back', tt('Voltar'))]
          : [hint('ud', tt('Rolar')), hint('back', tt('Voltar'))]}
      </div>
      {view != null && shots[view] && (
        <div className="gv-view" onClick={() => setView(null)}><img src={shots[view]} alt="" /><span>{view < caps.length ? tt('Sua captura · ') : ''}{view + 1} / {shots.length}</span></div>
      )}
      {wine && inst && <WineDialog id={inst.id} title={g.title} onClose={() => setWine(false)} />}
    </div>
  );
}
