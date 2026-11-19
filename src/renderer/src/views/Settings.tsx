import { useRef, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';
import { useState } from 'react';
import { useTRPC } from '../trpc';
import { Glyph, PAD_NAMES, type Key } from '../lib/input';
import { PALETTES, paletteById } from '../lib/palettes';
import { setSettings, useSettings, type Settings as S } from '../lib/settings';
import { useSpatialNav } from '../lib/spatial';
import { initAudio, sfx } from '../lib/sfx';

type Row =
  | { k: keyof S; t: string; d: string; kind: 'sw' }
  | { k: keyof S; t: string; d: string; kind: 'lvl'; step: number }
  | { k: keyof S; t: string; d: string; kind: 'pick'; opts: [string, string][] };

const SECTIONS: [string, Row[]][] = [
  ['VISUAL', [
    { k: 'pal', t: 'Paleta', d: 'Cores do Cartucho e do palco.', kind: 'pick', opts: PALETTES.map(p => [p.id, p.n]) },
    { k: 'crtLvl', t: 'Filtro CRT', d: 'Linhas e cantos escuros de TV antiga. 0 desliga.', kind: 'lvl', step: 10 },
    { k: 'flicker', t: 'Tremulação', d: 'A TV pisca de leve de vez em quando.', kind: 'sw' },
    { k: 'frame', t: 'Moldura de TV', d: 'Cantos arredondados em volta da tela.', kind: 'sw' },
    { k: 'glow', t: 'Brilho neon', d: 'Brilho em volta dos textos e botões.', kind: 'sw' },
    { k: 'pixel', t: 'Palco pixelado', d: 'Os consoles em baixa resolução, como num jogo antigo.', kind: 'sw' },
    { k: 'blur', t: 'Desfocar o palco na Home', d: 'O palco fica desfocado atrás do Início.', kind: 'sw' },
  ]],
  ['SOM', [
    { k: 'snd', t: 'Sons da interface', d: 'Bipes ao mover e confirmar.', kind: 'sw' },
    { k: 'vol', t: 'Volume', d: '', kind: 'lvl', step: 10 },
    { k: 'bootSnd', t: 'Vinheta da abertura', d: '', kind: 'sw' },
  ]],
  ['GERAL', [
    { k: 'boot', t: 'Mostrar a abertura', d: 'Desligado, o Cartucho abre direto.', kind: 'sw' },
    { k: 'start', t: 'Começar em', d: '', kind: 'pick', opts: [['act', 'Início'], ['stage', 'Consoles']] },
    { k: 'pad', t: 'Botões na tela', d: 'Automático segue o controle conectado.', kind: 'pick', opts: Object.entries(PAD_NAMES) as [string, string][] },
    { k: 'reduce', t: 'Menos movimento', d: 'Sem animações nem tremulação.', kind: 'sw' },
  ]],
];

export function Settings({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const root = useRef<HTMLDivElement>(null);
  const trpc = useTRPC(), qc = useQueryClient();
  const portsDir = useQuery(trpc.settings.portsDir.queryOptions());
  const [artStatus, setArtStatus] = useState<string | null>(null);
  const artStatus0 = useQuery(trpc.art.status.queryOptions());
  useSubscription(trpc.art.onStatus.subscriptionOptions(undefined, { onData: d => setArtStatus(d) }));
  const artRefresh = useMutation(trpc.art.refresh.mutationOptions());
  const pickDir = useMutation(trpc.settings.pickPortsDir.mutationOptions({ onSuccess: d => qc.setQueryData(trpc.settings.portsDir.queryKey(), d) }));

  const change = (r: Row, dir: 1 | -1) => {
    initAudio();
    if (r.kind === 'sw') setSettings({ [r.k]: !s[r.k] } as Partial<S>);
    else if (r.kind === 'lvl') setSettings({ [r.k]: Math.max(0, Math.min(100, (s[r.k] as number) + dir * r.step)) } as Partial<S>);
    else { const i = r.opts.findIndex(o => o[0] === s[r.k]); setSettings({ [r.k]: r.opts[(i + dir + r.opts.length) % r.opts.length]![0] } as Partial<S>); }
    sfx.play('move');
  };
  const rowOf = (el: Element | null) => { const k = (el as HTMLElement | null)?.dataset.k; return SECTIONS.flatMap(x => x[1]).find(r => r.k === k); };

  useSpatialNav(root, {
    active: true,
    onKey: (k: Key) => {
      if (k === 'Escape') { sfx.play('back'); onClose(); return true; }
      if (k === 'ArrowLeft' || k === 'ArrowRight') { const r = rowOf(root.current?.querySelector('[data-on]') ?? null); if (r) change(r, k === 'ArrowRight' ? 1 : -1); return true; }
    },
  });

  const value = (r: Row): ReactNode => {
    const v = s[r.k];
    if (r.kind === 'sw') return <span className={`st-sw ${v ? 'f' : ''}`}><i /></span>;
    if (r.kind === 'lvl') return <span className="st-seg">{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < (v as number) / 10 ? 'f' : ''} />)}</span>;
    const label = r.opts.find(o => o[0] === v)?.[1] ?? String(v);
    const pal = r.k === 'pal' ? paletteById(v as string) : null;
    return <span className="st-pick">‹{pal && <span className="st-pal">{[pal.bg, pal.acc, pal.pink, pal.cyan].map(c => <i key={c} style={{ background: c }} />)}</span>}<b>{label}</b>›</span>;
  };

  return (
    <div className="ov" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="st-w">
        <header className="st-h"><span className="glow">CONFIGURAÇÕES</span><span className="st-hint"><Glyph a="ud" />escolher <Glyph a="lr" />mudar <Glyph a="back" />fechar</span></header>
        <div className="st-rows" ref={root}>
          {SECTIONS.map(([sec, rows]) => (
            <div key={sec}>
              <div className="st-sec">{sec}</div>
              {rows.map(r => (
                <button key={r.k} className="st-r" data-hf data-k={r.k} onClick={() => change(r, 1)}>
                  <span><span className="t">{r.t}</span>{r.d && <span className="d">{r.d}</span>}</span>
                  <span className="c">{value(r)}</span>
                </button>
              ))}
            </div>
          ))}
          <div className="st-sec">JOGOS</div>
          <button className="st-r" data-hf onClick={() => pickDir.mutate()}>
            <span><span className="t">Pasta dos jogos</span><span className="d">Onde o Cartucho instala o que você baixa. Jogos já instalados ficam onde estão.</span></span>
            <span className="c"><span className="st-pick"><b style={{ minWidth: 0, maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{portsDir.data ?? '…'}</b>›</span></span>
          </button>
          <button className="st-r" data-hf onClick={() => artRefresh.mutate()} disabled={artRefresh.isPending}>
            <span><span className="t">Imagens dos jogos</span><span className="d">{artStatus ?? artStatus0.data ?? 'Capas, fundos e logos do LaunchBox Games Database. Enter baixa o banco de novo e procura as que faltaram.'}</span></span>
            <span className="c"><span className="st-pick"><b style={{ minWidth: 0 }}>{artRefresh.isPending ? 'Atualizando…' : 'Atualizar'}</b>›</span></span>
          </button>
          <div className="st-sec">SOBRE</div>
          <p className="st-credits">
            Catálogo: Recompendium (recompendium.com). Imagens: LaunchBox Games Database. Modelos 3D do Sketchfab, de: Laser Design (SNES, CC BY-NC), Joseph Rohm (N64, CC BY),
            Jeffrey fan 2000 (GameCube, CC BY), elouisetrewartha (Wii, CC BY-NC), Smoggybeard (Switch, CC BY-NC-SA), NAIT Studio (Switch 2, CC BY),
            ecjhr0awipso (PS1, CC BY), DemoDove99 (PS2), Ilya Ostrovsky (PSP, CC BY), Vasily (PS3, CC BY), Laxity (PS4, CC BY), DatSketch (PS5, CC BY-ND),
            Rob Bryant, Jr (Xbox 360, CC BY), MadeByYeshe (PC, CC BY), Daniel Brück (fliperama, CC BY). Instalação e atualização adaptadas do Harbour (MIT-0). Atalhos: S configurações, C botões, M som, P paleta, F11 tela cheia.
          </p>
        </div>
      </div>
    </div>
  );
}
