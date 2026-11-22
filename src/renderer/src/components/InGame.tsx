import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';
import { useTRPC } from '../trpc';
import { useSpatialNav } from '../lib/spatial';
import { sfx } from '../lib/sfx';
import { askConfirm } from '../lib/dialogs';
import { fmtPlay } from '../lib/format';
import { Glyph } from '../lib/input';

export function InGameHost() {
  const trpc = useTRPC(), qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const cur = useQuery(trpc.ingame.current.queryOptions(undefined, { enabled: open, refetchInterval: open ? 20_000 : false }));
  const g = cur.data ?? null;
  const shots = useQuery(trpc.ingame.shots.queryOptions({ title: g?.title ?? '' }, { enabled: open && !!g }));
  useSubscription(trpc.ingame.onSummon.subscriptionOptions(undefined, {
    onData: () => { sfx.play('ok'); setOpen(true); void qc.invalidateQueries({ queryKey: trpc.ingame.pathKey() }); },
  }));
  useSubscription(trpc.ingame.onShot.subscriptionOptions(undefined, { onData: () => void qc.invalidateQueries({ queryKey: trpc.ingame.shots.pathKey() }) }));
  const back = useMutation(trpc.ingame.back.mutationOptions());
  const quit = useMutation(trpc.play.quit.mutationOptions({ onSuccess: () => void qc.invalidateQueries() }));
  const openShots = useMutation(trpc.ingame.openShots.mutationOptions());
  const root = useRef<HTMLDivElement>(null);
  const close = () => { sfx.play('back'); setOpen(false); };
  useSpatialNav(root, { active: open, initial: '[data-main]', onKey: k => { if (k === 'Escape' || k === 'Home') { close(); return true; } } });
  if (!open) return null;
  const n = shots.data?.length ?? 0;
  return (
    <div className="ov gl-ov ig-ov">
      <div className="gl-box ig" ref={root}>
        <small className="ig-k">{g ? 'JOGANDO AGORA' : 'CARTUCHO'}</small>
        <h3>{g?.title ?? 'Nenhum jogo aberto agora'}</h3>
        {g && <p>Há {fmtPlay(Date.now() - g.start)} nesta sessão{n ? ` · ${n} ${n === 1 ? 'captura' : 'capturas'}` : ''}</p>}
        {shots.data?.[0] && <img className="ig-shot" src={shots.data[0]} alt="Última captura" />}
        <div className="ig-btns">
          {g && <button className="btn acc" data-hf data-main onClick={() => { sfx.play('ok'); setOpen(false); back.mutate(); }}>Voltar ao jogo</button>}
          {g && n > 0 && <button className="btn" data-hf onClick={() => { sfx.play('ok'); openShots.mutate({ title: g.title }); }}>Ver capturas</button>}
          {g && <button className="btn danger" data-hf onClick={() => { sfx.play('ok'); void askConfirm({ title: `Fechar ${g.title}?`, text: 'O que não foi salvo dentro do jogo se perde.', ok: 'Fechar o jogo', cancel: 'Continuar jogando', danger: true }).then(y => { if (y) { quit.mutate({ id: g.id }); setOpen(false); } }); }}>Fechar o jogo</button>}
          <button className="btn" data-hf {...(g ? {} : { 'data-main': '' })} onClick={close}>Ficar no Cartucho</button>
        </div>
        <p className="ig-tip">Durante o jogo: <Glyph a="sel" pad /> + <Glyph a="menu" pad /> tira uma captura de tela · o botão Home do controle abre este painel</p>
      </div>
    </div>
  );
}
