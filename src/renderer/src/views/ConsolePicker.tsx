/**
 * Quais consoles ficam no palco. Aparece na primeira vez que o usuário abre os Consoles e depois em
 * Configurações. Os que ficam de fora não somem: os jogos deles aparecem em Outros, separados por console.
 */
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../trpc';
import { Glyph } from '../lib/input';
import { setSettings, useSettings } from '../lib/settings';
import { useSpatialNav } from '../lib/spatial';
import { initAudio, sfx } from '../lib/sfx';
import { plural } from '../lib/format';
import { CONSOLES, MAKERS, MAKER_LABEL } from '../stage/consoles';

const PICKABLE = CONSOLES.filter(c => c.id !== 'other');

export function ConsolePicker({ first, onClose }: { first: boolean; onClose: () => void }) {
  const s = useSettings();
  const trpc = useTRPC();
  // na primeira vez o catálogo ainda pode estar chegando: confere de novo até ter números
  const summary = useQuery(trpc.library.summary.queryOptions(undefined, { refetchInterval: q => (Object.keys(q.state.data?.perConsole ?? {}).length ? false : 2000) }));
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(s.hidden));
  const root = useRef<HTMLDivElement>(null);

  const save = () => { initAudio(); sfx.play('ok'); setSettings({ hidden: PICKABLE.filter(c => hidden.has(c.id)).map(c => c.id), picked: true }); onClose(); };
  const toggle = (id: string) => { initAudio(); sfx.play('move'); setHidden(h => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const all = () => { initAudio(); sfx.play('move'); setHidden(new Set()); };
  // sem jogo nenhum no catálogo, o console só ocupa lugar: sugestão para quem quer o palco enxuto
  const withGames = () => { initAudio(); sfx.play('move'); setHidden(new Set(PICKABLE.filter(c => !(summary.data?.perConsole[c.id]?.recomps)).map(c => c.id))); };

  useSpatialNav(root, {
    active: true, initial: '[data-main]',
    onKey: k => { if (k === 'Escape') { if (first) save(); else { sfx.play('back'); onClose(); } return true; } },
  });

  const shown = PICKABLE.length - hidden.size;
  return (
    <div className="ov">
      <div className="st-w cp-w" ref={root}>
        <header className="st-h">
          <span className="glow">{first ? 'MONTE SEU PALCO' : 'CONSOLES NO PALCO'}</span>
          <span className="st-hint"><Glyph a="ok" />mostrar/esconder <Glyph a="back" />{first ? 'pronto' : 'cancelar'}</span>
        </header>
        <div className="cp-body">
          <p className="cp-intro">
            Escolha quais consoles aparecem no palco. Os que ficarem de fora continuam no Cartucho: os jogos deles
            aparecem em <b>Outros</b>, separados por console. Dá para mudar quando quiser em Configurações.
          </p>
          {MAKERS.filter(m => m !== 'Outros').map(m => (
            <div key={m} className="cp-grp">
              <div className="st-sec">{MAKER_LABEL[m]}</div>
              <div className="cp-list">
                {PICKABLE.filter(c => c.maker === m).map((c, i) => {
                  const pc = summary.data?.perConsole[c.id], on = !hidden.has(c.id);
                  return (
                    <button key={c.id} className={`cp-c ${on ? 'on' : ''}`} data-hf data-main={m === 'Nintendo' && i === 0 ? true : undefined}
                      style={{ ['--cc' as string]: c.color }} aria-pressed={on} onClick={() => toggle(c.id)}>
                      <span className="cp-chk">{on ? '✓' : ''}</span>
                      <span className="cp-n">{c.name}</span>
                      <span className="cp-m">{pc?.recomps ? plural(pc.recomps, 'jogo', 'jogos') : 'nenhum jogo ainda'}{pc?.installed ? ` · ${pc.installed} seu${pc.installed > 1 ? 's' : ''}` : ''}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <footer className="cp-foot">
          <button className="btn ghost" data-hf onClick={all}>Todos</button>
          <button className="btn ghost" data-hf onClick={withGames}>Só os que têm jogos</button>
          <span className="grow" />
          <span className="dim">{plural(shown, 'console', 'consoles')} + Outros</span>
          <button className="btn acc" data-hf onClick={save}>{first ? 'PRONTO' : 'SALVAR'}</button>
        </footer>
      </div>
    </div>
  );
}
