import { askConfirm } from '../lib/dialogs';
import { useRef, type ReactNode } from 'react';
import { SearchBox } from '../components/SearchBox';
import { AVATARS, useProfile } from '../lib/profile';
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
  ['PERFIL', [
    { k: 'avatar', t: 'Cor do avatar', d: 'A bolinha com a sua inicial, no topo e nos consoles.', kind: 'pick', opts: AVATARS },
  ]],
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
    { k: 'translate', t: 'Traduzir textos dos jogos', d: 'Descrições e requisitos do catálogo vêm em inglês; o Cartucho traduz pelo MyMemory e guarda.', kind: 'sw' },
  ]],
];

export function Settings({ onClose, onPickConsoles, onSupport }: { onClose: () => void; onPickConsoles: () => void; onSupport: () => void }) {
  const s = useSettings();
  const root = useRef<HTMLDivElement>(null);
  const trpc = useTRPC(), qc = useQueryClient();
  const portsDir = useQuery(trpc.settings.portsDir.queryOptions());
  const [artStatus, setArtStatus] = useState<string | null>(null);
  const artStatus0 = useQuery(trpc.art.status.queryOptions());
  useSubscription(trpc.art.onStatus.subscriptionOptions(undefined, { onData: d => setArtStatus(d) }));
  const artRefresh = useMutation(trpc.art.refresh.mutationOptions());
  const pickDir = useMutation(trpc.settings.pickPortsDir.mutationOptions({ onSuccess: d => qc.setQueryData(trpc.settings.portsDir.queryKey(), d) }));
  const me = useProfile();
  const quit = useMutation(trpc.system.quit.mutationOptions());
  const openLog = useMutation(trpc.system.openLog.mutationOptions());
  const nameRef = useRef<HTMLInputElement>(null);
  const win = useQuery(trpc.win.state.queryOptions());
  useSubscription(trpc.win.onState.subscriptionOptions(undefined, { onData: d => qc.setQueryData(trpc.win.state.queryKey(), d) }));
  const toggleFs = useMutation(trpc.win.toggleFullScreen.mutationOptions());
  const upd = useQuery(trpc.updates.state.queryOptions());
  const check = useMutation(trpc.updates.check.mutationOptions({ onSuccess: d => { if (d) qc.setQueryData(trpc.updates.state.queryKey(), d); } }));
  const install = useMutation(trpc.updates.install.mutationOptions());
  const u = upd.data;
  const updText = !u ? '' : u.status === 'dev' ? 'Rodando pelo código: a atualização automática só funciona na versão instalada.'
    : u.status === 'checking' ? 'Procurando versão nova…' : u.status === 'downloading' ? `Baixando a versão ${u.version} · ${u.pct}%`
    : u.status === 'ready' ? `Versão ${u.version} baixada. Enter reinicia e instala.` : u.status === 'error' ? `Não deu para verificar: ${u.error}`
    : u.status === 'none' ? 'Você está na versão mais nova.' : 'O Cartucho procura versões novas sozinho, a cada 6 horas.';
  const bg = useQuery(trpc.background.get.queryOptions());
  const setBg = useMutation(trpc.background.set.mutationOptions({ onSuccess: d => qc.setQueryData(trpc.background.get.queryKey(), d) }));
  const bgRow = (k: 'tray' | 'track' | 'autostart', t: string, d: string) => (
    <button key={k} className="st-r" data-hf data-k={k} onClick={() => { sfx.play('move'); setBg.mutate({ [k]: !bg.data?.[k] }); }}>
      <span><span className="t">{t}</span><span className="d">{d}</span></span>
      <span className="c"><span className={`st-sw ${bg.data?.[k] ? 'f' : ''}`}><i /></span></span>
    </button>
  );

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
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        const el = root.current?.querySelector<HTMLElement>('[data-on]') ?? null;
        const r = rowOf(el); if (r) { change(r, k === 'ArrowRight' ? 1 : -1); return true; }
        const bk = el?.dataset.k as 'tray' | 'track' | 'autostart' | 'fs' | undefined;
        if (bk === 'fs') { toggleFs.mutate(); return true; }
        if (bk && bg.data) { sfx.play('move'); setBg.mutate({ [bk]: !bg.data[bk] }); return true; }
      }
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
          <button className="st-r st-sup" data-hf onClick={() => { sfx.play('ok'); onSupport(); }}>
            <span><span className="t">♥ Apoiar o Cartucho</span><span className="d">O Cartucho é de graça e vai continuar sendo. Um café ajuda a manter o catálogo e os hubs em dia.</span></span>
            <span className="c"><span className="st-pick"><b style={{ minWidth: 0 }}>☕ Abrir</b>›</span></span>
          </button>
          {SECTIONS.map(([sec, rows]) => (
            <div key={sec}>
              <div className="st-sec">{sec}</div>
              {sec === 'PERFIL' && (
                <button className="st-r" data-hf onClick={() => nameRef.current?.focus()}>
                  <span><span className="t">Seu nome</span><span className="d">Aparece no perfil e nos consoles. Em branco, o Cartucho usa o nome do Windows.</span></span>
                  <span className="c"><span className="st-av" style={{ background: me.color }}>{me.initial}</span>
                    <SearchBox ref={nameRef} value={s.name} onChange={v => setSettings({ name: v.slice(0, 24) })} placeholder={me.suggested || 'Jogador'} nav={false} className="st-name" /></span>
                </button>
              )}
              {rows.map(r => (
                <button key={r.k} className="st-r" data-hf data-k={r.k} onClick={() => change(r, 1)}>
                  <span><span className="t">{r.t}</span>{r.d && <span className="d">{r.d}</span>}</span>
                  <span className="c">{value(r)}</span>
                </button>
              ))}
            </div>
          ))}
          <div className="st-sec">JANELA</div>
          <button className="st-r" data-hf data-k="fs" onClick={() => toggleFs.mutate()}>
            <span><span className="t">Tela cheia</span><span className="d">Também com Alt+Enter ou F11. O Cartucho lembra do tamanho e da posição da janela.</span></span>
            <span className="c"><span className={`st-sw ${win.data?.fullscreen ? 'f' : ''}`}><i /></span></span>
          </button>
          {bg.data && <>
            <div className="st-sec">SEGUNDO PLANO</div>
            {bgRow('track', 'Contar jogos abertos fora do Cartucho', 'Com o Cartucho aberto (ou na bandeja), o tempo conta mesmo se você abrir o jogo pelo .exe ou por um atalho.')}
            {bgRow('tray', 'Fechar para a bandeja', 'O X esconde o Cartucho perto do relógio em vez de fechar. Para sair de vez, use Sair no ícone da bandeja.')}
            {bgRow('autostart', 'Abrir com o Windows', 'Liga escondido na bandeja quando o computador inicia, pronto para contar o tempo.')}
          </>}
          <div className="st-sec">PALCO</div>
          <button className="st-r" data-hf onClick={() => { sfx.play('ok'); onPickConsoles(); }}>
            <span><span className="t">Consoles no palco</span><span className="d">Quais aparecem no palco. Os que ficam de fora vão para Outros.</span></span>
            <span className="c"><span className="st-pick"><b style={{ minWidth: 0 }}>{s.hidden.length ? `${s.hidden.length} escondido${s.hidden.length > 1 ? 's' : ''}` : 'Todos'}</b>›</span></span>
          </button>
          <div className="st-sec">JOGOS</div>
          <button className="st-r" data-hf onClick={() => pickDir.mutate()}>
            <span><span className="t">Pasta dos jogos</span><span className="d">Onde o Cartucho instala o que você baixa. Jogos já instalados ficam onde estão.</span></span>
            <span className="c"><span className="st-pick"><b style={{ minWidth: 0, maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{portsDir.data ?? '…'}</b>›</span></span>
          </button>
          <button className="st-r" data-hf onClick={() => artRefresh.mutate()} disabled={artRefresh.isPending}>
            <span><span className="t">Imagens dos jogos</span><span className="d">{artStatus ?? artStatus0.data ?? 'Capas, fundos e logos do LaunchBox Games Database. Enter baixa o banco de novo e procura as que faltaram.'}</span></span>
            <span className="c"><span className="st-pick"><b style={{ minWidth: 0 }}>{artRefresh.isPending ? 'Atualizando…' : 'Atualizar'}</b>›</span></span>
          </button>
          <div className="st-sec">ATUALIZAÇÕES</div>
          <button className="st-r" data-hf onClick={() => { sfx.play('ok'); if (u?.status === 'ready') install.mutate(); else check.mutate(); }}>
            <span><span className="t">Cartucho {u ? `v${u.current}` : ''}</span><span className="d">{updText}</span></span>
            <span className="c"><span className="st-pick"><b style={{ minWidth: 0 }}>{u?.status === 'ready' ? 'Reiniciar e atualizar' : check.isPending || u?.status === 'checking' ? 'Verificando…' : 'Verificar agora'}</b>›</span></span>
          </button>
          <button className="st-r" data-hf onClick={() => { sfx.play('ok'); void askConfirm({ title: 'Sair do Cartucho?', text: 'O Cartucho fecha de vez, sem ficar na bandeja.', ok: 'Sair', cancel: 'Ficar' }).then(y => { if (y) quit.mutate(); }); }}>
            <span><span className="t">Sair do Cartucho</span><span className="d">Fecha o app de vez. Também fica no menu do Start/≡ do controle.</span></span>
            <span className="c"><span className="st-pick"><b style={{ minWidth: 0 }}>⏻</b>›</span></span>
          </button>
          <div className="st-sec">SOBRE</div>
          <button className="st-r" data-hf onClick={() => { sfx.play('ok'); openLog.mutate(); }}>
            <span><span className="t">Registro do Cartucho</span><span className="d">Abre a pasta do arquivo cartucho.log. Se algo travar ou der erro, mande esse arquivo junto com o relato.</span></span>
            <span className="c"><span className="st-pick"><b style={{ minWidth: 0 }}>Abrir pasta</b>›</span></span>
          </button>
          <p className="st-credits">
            Catálogo: Recompendium (recompendium.com). Imagens: LaunchBox Games Database. Modelos 3D do Sketchfab, de: Laser Design (SNES, CC BY-NC), Joseph Rohm (N64, CC BY),
            Jeffrey fan 2000 (GameCube, CC BY), elouisetrewartha (Wii, CC BY-NC), Smoggybeard (Switch, CC BY-NC-SA), NAIT Studio (Switch 2, CC BY),
            ecjhr0awipso (PS1, CC BY), barbi0526 (PS2, CC BY), Ilya Ostrovsky (PSP, CC BY), Vasily (PS3, CC BY), Laxity (PS4, CC BY), DatSketch (PS5, CC BY-ND),
            A.stark (NES, CC BY), danny_p3d (Game Boy, CC BY-NC), Cianon (DS Lite, CC BY), rubikreef (Xbox, CC BY), synthetic worlds (Mega Drive, CC BY),
            Rob Bryant, Jr (Xbox 360, CC BY), MadeByYeshe (PC, CC BY), Daniel Brück (fliperama, CC BY). Instalação e atualização adaptadas do Harbour (MIT-0). Atalhos: S configurações, C botões, M som, P paleta, F11 ou Alt+Enter tela cheia.
          </p>
        </div>
      </div>
    </div>
  );
}
