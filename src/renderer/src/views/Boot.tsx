import { useEffect, useRef, useState } from 'react';
import type { LibrarySummary } from '@shared/types';
import { Glyph, PAD_NAMES, useKeys, usePadKind } from '../lib/input';
import { reduceMotion } from '../lib/settings';
import { initAudio, sfx } from '../lib/sfx';
import { fmtPlay, plural } from '../lib/format';
import { CONSOLES } from '../stage/consoles';

export function Boot({ summary, onDone }: { summary: LibrarySummary | undefined; onDone: () => void }) {
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  const [skip, setSkip] = useState(false);
  const [shown, setShown] = useState(0);
  const pad = usePadKind();
  const timers = useRef<number[]>([]);
  const jingled = useRef(false);
  const snd = useRef<number[]>([]);

  const lines = summary ? [
    <>› catálogo: <b>{summary.catalogTotal} recomps</b> em {CONSOLES.length} consoles</>,
    <>› biblioteca: <b>{plural(summary.installed, 'jogo instalado', 'jogos instalados')}</b></>,
    <>› radar: <b>{plural(summary.radar.fresh, 'novo', 'novos')}</b> e {plural(summary.radar.updates, 'atualização', 'atualizações')} desde a última visita</>,
    <>› conquistas: <b>{summary.achievements.unlocked}</b> de {summary.achievements.total}{summary.playMs ? <> · tempo de jogo: <b>{fmtPlay(summary.playMs)}</b></> : null}</>,
    <>› controle: <b>{PAD_NAMES[pad]}</b></>,
  ] : [<>› lendo a biblioteca…</>];

  useEffect(() => {
    initAudio();
    if (reduceMotion()) { jingled.current = true; sfx.jingle(); return; }
    snd.current = [window.setTimeout(() => sfx.insert(), 1950), window.setTimeout(() => { jingled.current = true; sfx.jingle(); }, 2200)];
    return () => snd.current.forEach(clearTimeout);
  }, []);
  useEffect(() => {
    if (stage !== 0 || skip) return;
    const reduce = reduceMotion(), base = reduce ? 0 : 3200;
    timers.current.forEach(clearTimeout); timers.current = [];
    for (let i = 0; i < lines.length; i++) timers.current.push(window.setTimeout(() => setShown(i + 1), reduce ? 0 : base + i * 260));
    timers.current.push(window.setTimeout(() => setStage(1), reduce ? 0 : base + lines.length * 260 + 200));
    return () => timers.current.forEach(clearTimeout);
  }, [lines.length, stage, skip]);

  const press = () => {
    if (stage === 0) { timers.current.forEach(clearTimeout); snd.current.forEach(clearTimeout); if (!jingled.current) sfx.jingle(); jingled.current = true; setSkip(true); setShown(lines.length); setStage(1); return; }
    if (stage !== 1) return;
    setStage(2); initAudio(); sfx.play('ok');
    window.setTimeout(onDone, reduceMotion() ? 0 : 460);
  };
  useKeys(() => press());

  return (
    <div id="boot" className={`${skip ? 'skip' : ''} ${stage === 2 ? 'go' : ''}`} onClick={press} aria-label="Abertura do Cartucho">
      <div className="line" />
      <div className="bt-in">
        <div className="bt-dev"><div className="bt-c"><span>RECOMP</span></div><div className="bt-slot" /></div>
        <div className="bt-logo">CARTUCHO</div>
        <div className="bt-sub">RECOMPS · PORTS · EMULADORES</div>
        <div className="bt-log">{lines.slice(0, shown).map((l, i) => <div key={i}>{l}</div>)}</div>
        <div className={`bt-start ${stage >= 1 ? 'on' : ''}`}>{stage >= 1 && <>APERTE <Glyph a="ok" /> PARA COMEÇAR</>}</div>
      </div>
    </div>
  );
}
