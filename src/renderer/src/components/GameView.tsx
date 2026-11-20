import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SELF_INSTALL_NOTE, STATUS_LABEL } from '@shared/consoles';
import { Glyph, useKeys, type Key } from '../lib/input';
import { sfx } from '../lib/sfx';
import { fmtPlay } from '../lib/format';
import { useArt, useShots } from '../lib/art';
import { useTranslated } from '../lib/translate';
import { GameArt } from './GameArt';
import { useGameProgress, type HubGame } from '../hubs/data';
import type { DOpt } from './Discover';

type Zone = 'acts' | 'shots' | 'text';

export function GameView({ theme, g, opts, run, onBack, self, logo = true, extra }: {
  theme: string; g: HubGame; opts: DOpt[]; run: (k: string, g: HubGame) => void; onBack: () => void; self: boolean; logo?: boolean; extra?: ReactNode;
}) {
  const art = useArt(g.console, g.title, g.platformName);
  const shots = useShots(g.console, g.title, g.platformName);
  const about = useTranslated(g.catalog?.description);
  const needs = useTranslated(g.catalog?.needs);
  const p = useGameProgress(g);
  const inst = g.installed;
  const [zone, setZone] = useState<Zone>('acts');
  const [ai, setAi] = useState(0);
  const [si, setSi] = useState(0);
  const [view, setView] = useState<number | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => { setZone('acts'); setAi(0); setSi(0); setView(null); scroll.current?.scrollTo({ top: 0 }); }, [g.key]);
  useEffect(() => { if (ai >= opts.length && opts.length) setAi(opts.length - 1); }, [opts.length]);

  useEffect(() => {
    const el = scroll.current; if (!el) return;
    if (zone === 'acts') el.scrollTo({ top: 0, behavior: 'smooth' });
    else if (zone === 'shots') el.querySelector('.gv-shots')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else el.querySelector('.gv-text')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [zone]);
  useEffect(() => { strip.current?.children[si]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }, [si]);

  const mv = (f: () => void) => { sfx.play('move'); f(); };
  const act = (j: number) => { const o = opts[j]; if (o) run(o.k, g); };

  useKeys((k: Key) => {
    const R = k === 'ArrowRight', L = k === 'ArrowLeft', U = k === 'ArrowUp', D = k === 'ArrowDown';
    if (view != null) {
      if (k === 'Escape' || k === 'Enter') { sfx.play('back'); setView(null); }
      else if (R && view < shots.length - 1) mv(() => setView(view + 1));
      else if (L && view > 0) mv(() => setView(view - 1));
      return;
    }
    if (k === 'Escape') { sfx.play('back'); return onBack(); }
    if (zone === 'acts') {
      if (k === 'Enter') return act(ai);
      if (R && ai < opts.length - 1) mv(() => setAi(ai + 1));
      else if (L && ai > 0) mv(() => setAi(ai - 1));
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
  const meta = [g.catalog?.developer, g.catalog?.year, g.platformName].filter(Boolean).join(' · ');
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
              {g.status && <span className={`pill ${g.status}`}>{STATUS_LABEL[g.status]}</span>}
              {g.isNew && <span className="pill new">Novo no catálogo</span>}
              {inst && !inst.missing && <span className="pill inst">{inst.running ? 'Jogando agora' : inst.playMs ? `${fmtPlay(inst.playMs)} jogadas` : 'Instalado · ainda não jogado'}</span>}
              {inst?.achievements?.total ? <span className="pill">{inst.achievements.unlocked}/{inst.achievements.total} conquistas</span> : null}
              {g.update?.updateAvailable && !self && <span className="pill new">Versão {g.update.latest?.tag} disponível</span>}
            </div>
            {inst?.missing && <p className="gv-warn">A pasta do jogo não foi encontrada em {inst.installDir}.</p>}
            {p && <div className="gv-prog"><span>{p.error ?? p.stage}</span>{!p.error && p.pct > 0 && p.pct < 1 && <i style={{ width: `${Math.round(p.pct * 100)}%` }} />}</div>}
            <div className="gv-acts">{opts.map((o, j) => (
              <button key={o.k + j} className={`${j === 0 ? 'pri' : ''} ${zone === 'acts' && ai === j ? 'on' : ''}`}
                onClick={() => { if (zone === 'acts' && ai === j) act(j); else mv(() => { setZone('acts'); setAi(j); }); }}>
                {o.icon}{o.l}
              </button>
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
          {about.text && <><h3>Sobre</h3><p>{about.text}</p></>}
          {needs.text && <><h3>O que você precisa</h3><p>{needs.text}</p></>}
          {self && !inst && <p className="dim">{SELF_INSTALL_NOTE}</p>}
          {!about.text && !needs.text && <p className="dim">O catálogo não traz descrição deste jogo.</p>}
          {(about.auto || needs.auto) && <small>Traduzido automaticamente do inglês</small>}
        </section>
        {extra && <section className="gv-sec gv-extra">{extra}</section>}
      </div>
      <div className="dsc-ft">
        {view != null ? [hint('lr', 'Imagem'), hint('back', 'Fechar')]
          : zone === 'acts' ? [hint('ok', opts[ai]?.l ?? 'OK'), hint('lr', 'Ações'), hint('ud', 'Imagens e texto'), hint('back', 'Voltar')]
          : zone === 'shots' ? [hint('ok', 'Ampliar'), hint('lr', 'Imagens'), hint('ud', 'Rolar'), hint('back', 'Voltar')]
          : [hint('ud', 'Rolar'), hint('back', 'Voltar')]}
      </div>
      {view != null && shots[view] && (
        <div className="gv-view" onClick={() => setView(null)}><img src={shots[view]} alt="" /><span>{view + 1} / {shots.length}</span></div>
      )}
    </div>
  );
}
