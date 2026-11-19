/** Ficha de um jogo da biblioteca (jogar, atualizar, tempo) e ficha de um jogo do catálogo (instalar). */
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CatalogGame } from '@shared/types';
import { CONSOLE_NAME, isSelfInstall, SELF_INSTALL_NOTE, STATUS_LABEL } from '@shared/consoles';
import { useTRPC } from '../trpc';
import { Hints } from '../lib/input';
import { useSpatialNav } from '../lib/spatial';
import { useProgress } from '../lib/progress';
import { ago, fmtDate, fmtPlay, fmtSize, plural } from '../lib/format';
import { sfx } from '../lib/sfx';
import { GameArt } from '../components/GameArt';
import { Bars } from '../components/Bars';
import { ProgressBar } from '../components/ProgressBar';

const gh = (repo: string) => window.open(`https://github.com/${repo}`, '_blank');

export function GamePage({ id, active, onBack, onAchievements }: { id: string; active: boolean; onBack: () => void; onAchievements: () => void }) {
  const trpc = useTRPC(), qc = useQueryClient();
  const game = useQuery(trpc.games.get.queryOptions({ id }));
  const stats = useQuery(trpc.play.stats.queryOptions({ id }));
  const upd = useQuery(trpc.ports.checkUpdate.queryOptions({ id }, { enabled: !!game.data?.sourceRepo, staleTime: 5 * 60_000 }));
  const refresh = () => { void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }); void qc.invalidateQueries({ queryKey: trpc.library.summary.queryKey() }); };
  const play = useMutation(trpc.play.start.mutationOptions({ onSuccess: refresh }));
  const quit = useMutation(trpc.play.quit.mutationOptions());
  const update = useMutation(trpc.ports.update.mutationOptions({ onSuccess: d => { qc.setQueryData(trpc.ports.checkUpdate.queryKey({ id }), d); refresh(); } }));
  const recheck = useMutation({ mutationFn: () => qc.fetchQuery(trpc.ports.checkUpdate.queryOptions({ id, force: true }, { staleTime: 0 })), onSuccess: d => qc.setQueryData(trpc.ports.checkUpdate.queryKey({ id }), d) });
  const chooseExe = useMutation(trpc.games.chooseExe.mutationOptions({ onSuccess: refresh }));
  const openFolder = useMutation(trpc.games.openFolder.mutationOptions());
  const remove = useMutation(trpc.games.remove.mutationOptions({ onSuccess: () => { void qc.invalidateQueries(); onBack(); } }));
  const uninstall = useMutation(trpc.ports.uninstall.mutationOptions({ onSuccess: () => { void qc.invalidateQueries(); onBack(); } }));
  const progress = useProgress(id);
  const [more, setMore] = useState(false);

  const root = useRef<HTMLDivElement>(null);
  useSpatialNav(root, { active, initial: '[data-main]', onKey: k => { if (k === 'Escape') { sfx.play('back'); onBack(); return true; } } });

  const g = game.data;
  if (!g) return <p className="dim pad24">{game.error ? game.error.message : 'Carregando…'}</p>;
  const u = upd.data, a = g.achievements, st = stats.data;
  const err = play.error ?? update.error ?? uninstall.error ?? chooseExe.error ?? quit.error;

  return (
    <div ref={root} className="gp-page">
      <header className="chub-top">
        <button className="back" data-hf onClick={() => { sfx.play('back'); onBack(); }}>◀ VOLTAR</button>
        <span className="grow" />
      </header>
      <div className="gp-body">
        <GameArt title={g.title} console={g.console} fallback={g.coverUrl} className="gp-cover" />
        <div className="gp-main">
          <span className="k">{CONSOLE_NAME[g.console].toUpperCase()}{g.version ? ` · ${g.version}` : ''}{g.running ? ' · JOGANDO AGORA' : ''}</span>
          <h1>{g.title}</h1>
          <p className="dim">{g.playMs ? `${fmtPlay(g.playMs)} jogadas` : 'Ainda não jogado pelo Cartucho'}{g.lastPlayed ? ` · ${ago(g.lastPlayed)}` : ''}{a && a.total ? ` · ${a.unlocked}/${a.total} conquistas` : ''}</p>

          <div className="hm-btns">
            {g.running
              ? <button className="hm-go" data-hf data-main onClick={() => quit.mutate({ id })}>■ FECHAR O JOGO</button>
              : g.exe
                ? <button className="hm-go" data-hf data-main disabled={play.isPending || !!progress} onClick={() => { sfx.play('ok'); play.mutate({ id }); }}>▶ JOGAR</button>
                : <button className="hm-go" data-hf data-main onClick={() => chooseExe.mutate({ id })}>ESCOLHER O .EXE</button>}
            {g.adapter && <button className="hm-go ghost" data-hf onClick={() => { sfx.play('ok'); onAchievements(); }}>★ CONQUISTAS{a?.total ? ` ${a.unlocked}/${a.total}` : ''}</button>}
            {u?.updateAvailable && !progress && <button className="hm-go ghost upd" data-hf disabled={update.isPending || g.running} onClick={() => update.mutate({ id })}>⬇ ATUALIZAR PARA {u.latest?.tag}</button>}
            <button className="hm-go ghost" data-hf onClick={() => setMore(m => !m)}>⋯</button>
          </div>

          {more && (
            <div className="gp-more">
              <button className="btn" data-hf onClick={() => chooseExe.mutate({ id })}>Escolher o .exe</button>
              <button className="btn" data-hf onClick={() => openFolder.mutate({ id })}>Abrir pasta</button>
              {g.sourceRepo && <button className="btn" data-hf onClick={() => gh(g.sourceRepo!)}>Projeto no GitHub</button>}
              {g.managed
                ? <button className="btn danger" data-hf onClick={() => { if (confirm(`Desinstalar ${g.title}? Os arquivos que vieram no download serão apagados; saves e configurações que você mudou ficam na pasta.`)) uninstall.mutate({ id }); }}>Desinstalar</button>
                : <button className="btn danger" data-hf onClick={() => { if (confirm(`Tirar ${g.title} da biblioteca? Nenhum arquivo é apagado.`)) remove.mutate({ id }); }}>Remover da biblioteca</button>}
            </div>
          )}

          {progress && <ProgressBar p={progress} />}
          {err && <p className="err" style={{ margin: 0 }}>{err.message}</p>}

          <div className="gp-cards">
            <section className="gp-card">
              <h3>TEMPO DE JOGO</h3>
              <div className="hm-big glow">{fmtPlay(st?.totalMs ?? 0)}<small>{st?.sessions ? `${plural(st.sessions, 'sessão', 'sessões')} · última ${ago(st.lastPlayed!)}` : 'conta a partir da primeira vez que você jogar pelo Cartucho'}</small></div>
              {st && <Bars days={st.days} />}
            </section>
            <section className="gp-card">
              <h3>VERSÃO</h3>
              {isSelfInstall(g.console) ? <p className="dim">Neste console as atualizações são por sua conta: instale a versão nova por cima da pasta do jogo.</p> : !g.sourceRepo ? <p className="dim">Sem projeto do GitHub ligado, então o Cartucho não procura atualizações.</p> : (
                <>
                  <p>{u?.installed ? <>Instalada: <b>{u.installed}</b></> : 'Versão instalada desconhecida'}{u?.latest ? <> · mais nova: <b>{u.latest.tag}</b>{u.latest.date ? ` (${fmtDate(Date.parse(u.latest.date))})` : ''}</> : null}</p>
                  <p className="dim">
                    {u?.updateAvailable === false ? 'Você está na versão mais nova.' : u?.updateAvailable ? `Atualização de ${fmtSize(u.latest!.size)}.` : u?.installed === null && u?.latest ? 'Atualizar baixa a versão mais nova e passa a acompanhar.' : ''}
                    {u?.error ? ` ${u.error}` : ''}
                  </p>
                  {u?.updateAvailable === null && u.latest && !progress && <button className="btn" data-hf onClick={() => update.mutate({ id })}>Baixar {u.latest.tag} por cima</button>}
                  <p className="dim small">{u?.checkedAt ? `Conferido ${ago(u.checkedAt)} · ` : ''}<button className="link" data-hf disabled={recheck.isPending} onClick={() => recheck.mutate()}>{recheck.isPending ? 'conferindo…' : 'conferir agora'}</button></p>
                  {u?.latest?.notes && u.updateAvailable && <pre className="notes">{u.latest.notes}</pre>}
                </>
              )}
            </section>
          </div>
          <p className="credit" style={{ padding: 0 }}>{g.installDir}{g.exe ? ` · ${g.exe.split(/[\\/]/).pop()}` : ''}</p>
        </div>
      </div>
      <Hints items={[['ok', 'Escolher'], ['back', 'Voltar']]} />
    </div>
  );
}

export function CatalogPage({ game: c, installedId, active, onBack, onOpenInstalled }: { game: CatalogGame; installedId: string | null; active: boolean; onBack: () => void; onOpenInstalled: (id: string) => void }) {
  const trpc = useTRPC(), qc = useQueryClient();
  const install = useMutation(trpc.ports.install.mutationOptions({ onSuccess: g => { void qc.invalidateQueries(); sfx.play('ok'); onOpenInstalled(g.id); } }));
  const add = useMutation(trpc.games.addFromDialog.mutationOptions({ onSuccess: g => { void qc.invalidateQueries(); if (g) { sfx.play('ok'); onOpenInstalled(g.id); } } }));
  const self = isSelfInstall(c.console);
  const portsDir = useQuery(trpc.settings.portsDir.queryOptions());
  const progress = useProgress(c.id);
  const root = useRef<HTMLDivElement>(null);
  useSpatialNav(root, { active, initial: '[data-main]', onKey: k => { if (k === 'Escape') { sfx.play('back'); onBack(); return true; } } });

  return (
    <div ref={root} className="gp-page">
      <header className="chub-top">
        <button className="back" data-hf onClick={() => { sfx.play('back'); onBack(); }}>◀ VOLTAR</button>
        <span className="grow" />
      </header>
      <div className="gp-body">
        <GameArt title={c.title} console={c.console} platformName={c.platformName} fallback={c.coverUrl} className="gp-cover" />
        <div className="gp-main">
          <span className="k">{(c.console === 'other' ? c.platformName : CONSOLE_NAME[c.console]).toUpperCase()}{c.year ? ` · ${c.year}` : ''}{c.developer ? ` · ${c.developer}` : ''}</span>
          <h1>{c.title}</h1>
          <p><span className={`st-${c.status}`}>■ {STATUS_LABEL[c.status]}</span>{c.version ? ` · ${c.version}` : ''}{c.stars ? ` · ★ ${c.stars}` : ''}{c.noLink && !self ? ' · sem link no Recompendium' : ''}</p>
          <div className="hm-btns">
            {installedId
              ? <button className="hm-go" data-hf data-main onClick={() => onOpenInstalled(installedId)}>NA BIBLIOTECA ▶</button>
              : self
                ? <button className="hm-go" data-hf data-main disabled={add.isPending} onClick={() => add.mutate({ catalogId: c.id })}>JÁ INSTALEI: ADICIONAR PASTA</button>
                : c.repo && <button className="hm-go" data-hf data-main disabled={install.isPending || !!progress} onClick={() => { sfx.play('ok'); install.mutate({ catalogId: c.id }); }}>⬇ INSTALAR</button>}
            {c.repo && <button className="hm-go ghost" data-hf onClick={() => gh(c.repo!)}>VER NO GITHUB</button>}
          </div>
          {progress && <ProgressBar p={progress} />}
          {(install.error ?? add.error) && !progress && <p className="err" style={{ margin: 0 }}>{(install.error ?? add.error)!.message}</p>}
          {!installedId && self && <p className="dim small">{SELF_INSTALL_NOTE}</p>}
          {!installedId && c.repo && !self && <p className="dim small">Instala em {portsDir.data ?? '…'} (dá para mudar nas configurações). O download é conferido pelo hash do GitHub e pelo Windows Defender antes de ser aberto.</p>}
          <div className="gp-cards">
            {c.needs && <section className="gp-card"><h3>O QUE VOCÊ PRECISA</h3><p className="txt">{c.needs}</p></section>}
            {c.description && <section className="gp-card wide"><h3>SOBRE</h3><p className="txt">{c.description}</p></section>}
          </div>
          <p className="credit" style={{ padding: 0 }}>Dados: Recompendium{c.repo ? ` · ${c.repo}` : ''}</p>
        </div>
      </div>
      <Hints items={[['ok', 'Escolher'], ['back', 'Voltar']]} />
    </div>
  );
}
