import type { InstalledGame, LibrarySummary } from '@shared/types';
import { CONSOLE_NAME } from '@shared/consoles';
import { Cover } from '../components/Cover';
import { ago, fmtPlay, plural } from '../lib/format';
import { CONSOLES } from '../stage/consoles';

interface Props {
  games: InstalledGame[] | undefined;
  summary: LibrarySummary | undefined;
  onOpenGame: (g: InstalledGame) => void;
  onPlay: (g: InstalledGame) => void;
  playError: string | null;
  onStage: () => void;
  onAddGame: () => void;
  adding: boolean;
}

/** Legenda embaixo da fileira (também atualizada pela navegação com setas, em Select). */
export const showCap = (e: { currentTarget: HTMLElement }) => setCaption(e.currentTarget);
export function setCaption(el: HTMLElement | null) { const c = document.getElementById('hmCap'); if (c) c.textContent = el?.dataset.cap ?? ''; }

/** Início: o jogo mais recente em destaque e os outros numa fileira. */
export function Home({ games, summary, onOpenGame, onPlay, playError, onStage, onAddGame, adding }: Props) {
  if (!games) return null;
  // o último jogado primeiro; os nunca jogados pela data em que entraram
  const sorted = [...games].sort((a, b) => (b.lastPlayed ?? b.addedAt) - (a.lastPlayed ?? a.addedAt));
  const top = sorted[0], rec = sorted.slice(1, 7);
  const color = (id: string) => CONSOLES.find(c => c.id === id)?.color ?? 'var(--acc)';

  if (!top) return (
    <div className="home">
      <div className="hm2-hero">
        <div className="hm2-txt">
          <span className="k" style={{ color: 'var(--pink)' }}>BEM-VINDO</span>
          <h1>Sua biblioteca está vazia</h1>
          <p>{summary?.catalogTotal ? `${summary.catalogTotal} recomps, ports e emuladores no catálogo. ` : ''}Escolha um console para ver o que existe, ou aponte a pasta de um jogo que você já tem.</p>
          <div className="hm-btns">
            <button className="hm-go" data-hf data-main onClick={onStage}>ESCOLHER UM CONSOLE</button>
            <button className="hm-go ghost" data-hf onClick={onAddGame} disabled={adding}>{adding ? 'LENDO A PASTA…' : '+ ADICIONAR JOGO'}</button>
          </div>
        </div>
      </div>
    </div>
  );

  const a = top.achievements;
  return (
    <div className="home">
      <div className="hm2-hero">
        <Cover title={top.title} url={top.coverUrl} />
        <div className="hm2-txt">
          <span className="k" style={{ color: color(top.console) }}>{top.running ? 'JOGANDO AGORA' : top.lastPlayed ? 'CONTINUAR' : 'NA SUA BIBLIOTECA'} · {CONSOLE_NAME[top.console].toUpperCase()}</span>
          <h1>{top.title}</h1>
          <p>{top.lastPlayed ? `${fmtPlay(top.playMs)} jogadas · ${ago(top.lastPlayed)}` : `adicionado ${ago(top.addedAt)}`}{a && a.total ? ` · ${a.unlocked}/${a.total} conquistas` : ''}</p>
          <div className="hm-btns">
            {top.exe && !top.running
              ? <button className="hm-go" data-hf data-main onClick={() => onPlay(top)}>▶ {top.lastPlayed ? 'CONTINUAR' : 'JOGAR'}</button>
              : <button className="hm-go" data-hf data-main onClick={() => onOpenGame(top)}>▶ ABRIR</button>}
            {top.exe && !top.running && <button className="hm-go ghost" data-hf onClick={() => onOpenGame(top)}>DETALHES</button>}
          </div>
          {playError && <p className="err" style={{ margin: 0 }}>{playError}</p>}
        </div>
      </div>
      <div className="hm2-rec">
        <div className="hm2-row">
          {rec.map(g => (
            <button key={g.id} data-hf aria-label={g.title} onClick={() => onOpenGame(g)}
              onMouseEnter={showCap} data-cap={`${g.title} · ${CONSOLE_NAME[g.console]}${g.playMs ? ` · ${fmtPlay(g.playMs)}` : ''}`}>
              <Cover title={g.title} url={g.coverUrl} />
            </button>
          ))}
          <button className="more" data-hf data-cap="Adicionar jogo" aria-label="Adicionar jogo" onClick={onAddGame} onMouseEnter={showCap}>+</button>
          <button className="more" data-hf data-cap="Todos os consoles" aria-label="Todos os consoles" onClick={onStage} onMouseEnter={showCap}>▶</button>
        </div>
        <div className="hm2-cap" id="hmCap" />
      </div>
      {summary && summary.installed > 7 && <span className="dim">{plural(summary.installed, 'jogo', 'jogos')} na biblioteca</span>}
    </div>
  );
}
