import { useRef, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CONSOLE_NAME } from '@shared/consoles';
import type { ConsoleId } from '@shared/types';
import { useTRPC } from '../trpc';
import { Glyph } from '../lib/input';
import { useSpatialNav } from '../lib/spatial';
import { ago, plural } from '../lib/format';
import { sfx } from '../lib/sfx';

const TAGS = { new: 'NOVO', upd: 'VERSÃO', up: 'SUBIU' } as const;

function Shell({ title, onClose, children, initial }: { title: string; onClose: () => void; children: ReactNode; initial?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useSpatialNav(root, { active: true, initial, onKey: k => { if (k === 'Escape') { sfx.play('back'); onClose(); return true; } } });
  return (
    <div className="ov" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hm-ov" ref={root}>
        <h3>{title} <span><Glyph a="back" />fechar</span></h3>
        {children}
      </div>
    </div>
  );
}

/** Radar: novidades do Recompendium desde a última olhada. */
export function RadarOverlay({ onClose, onOpenConsole }: { onClose: () => void; onOpenConsole: (c: ConsoleId) => void }) {
  const trpc = useTRPC(), qc = useQueryClient();
  const radar = useQuery(trpc.catalog.radar.queryOptions());
  const info = useQuery(trpc.catalog.info.queryOptions());
  const refresh = useMutation(trpc.catalog.refresh.mutationOptions({ onSettled: () => qc.invalidateQueries() }));
  const seen = useMutation(trpc.catalog.markRadarSeen.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.library.summary.queryKey() }) }));
  const close = () => { seen.mutate(); onClose(); };

  return (
    <Shell title="RADAR" onClose={close}>
      {radar.data?.length === 0 && <p className="empty">Nada novo por enquanto. O Cartucho confere o Recompendium toda vez que abre; jogos novos, mudanças de status e versões novas dos seus jogos aparecem aqui.</p>}
      {radar.data?.slice(0, 40).map(r => (
        <button key={r.id} className="it" data-hf onClick={() => { seen.mutate(); onOpenConsole(r.console); }}>
          <span className={`tag ${r.kind}`}>{TAGS[r.kind]}</span>
          <span className="t">{r.title}</span>
          <span className="s">{CONSOLE_NAME[r.console]}{r.kind !== 'new' ? ` · ${r.detail}` : ''} · {ago(r.at)}</span>
        </button>
      ))}
      <div className="scan">
        <span>{refresh.error ? `Sem conexão com o Recompendium (${refresh.error.message})` : info.data?.checkedAt ? `Verificado ${ago(info.data.checkedAt)}` : 'Ainda não verificado'}</span>
        <button data-hf disabled={refresh.isPending} onClick={() => refresh.mutate({})}>{refresh.isPending ? 'Verificando…' : 'Verificar agora'}</button>
      </div>
    </Shell>
  );
}

/** Perfil: conquistas (e, na próxima etapa, tempo de jogo). */
export function MeOverlay({ onClose }: { onClose: () => void }) {
  const trpc = useTRPC();
  const summary = useQuery(trpc.library.summary.queryOptions());
  const recent = useQuery(trpc.achievements.recent.queryOptions({ limit: 8 }));
  const a = summary.data?.achievements;
  return (
    <Shell title="GORIS" onClose={onClose}>
      <div className="hm-big glow">{a?.unlocked ?? 0}<small>{a ? `de ${plural(a.total, 'conquista', 'conquistas')} nos seus jogos · ${plural(summary.data!.installed, 'jogo', 'jogos')} na biblioteca` : ''}</small></div>
      <div className="hm-sub">CONQUISTAS RECENTES</div>
      <div className="hm-ach">
        {recent.data?.length === 0 && <span className="dim">Nenhuma ainda. Elas aparecem aqui assim que você desbloquear algo num jogo suportado.</span>}
        {recent.data?.map(u => (
          <div key={`${u.gameId}:${u.achId}`}><i /><span>{u.name}<br /><small>{u.gameTitle}</small></span><small>{ago(u.at)}</small></div>
        ))}
      </div>
      <p className="dim" style={{ marginTop: 16, fontSize: 18 }}>Tempo de jogo entra quando o Cartucho passar a abrir os jogos.</p>
    </Shell>
  );
}
