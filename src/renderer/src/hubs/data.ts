/**
 * Dados de um console para os hubs: biblioteca, catálogo, novidades, tempo de jogo e atualizações,
 * juntos numa lista só (um jogo instalado que está no catálogo aparece uma vez).
 */
import { useMemo } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CatalogGame, ConsoleId, InstalledGame, PlayStatus, RadarEvent, UpdateInfo } from '@shared/types';
import { useTRPC } from '../trpc';
import { useProgress } from '../lib/progress';
import { isSelfInstall } from '@shared/consoles';

export interface HubGame {
  key: string;                       // id do jogo instalado, ou do catálogo
  title: string;
  coverUrl: string | null;
  status: PlayStatus | null;
  installed: InstalledGame | null;
  catalog: CatalogGame | null;
  isNew: boolean;                    // chegou no catálogo nos últimos 14 dias
  update: UpdateInfo | null;         // só para instalados com projeto no GitHub
  repo: string | null;
  console: ConsoleId;
  platformName: string | null;      // plataforma de origem (para "Outros")
}

const FRESH_MS = 14 * 86400_000;

export function useHubData(consoleId: ConsoleId) {
  const trpc = useTRPC();
  const games = useQuery(trpc.games.list.queryOptions());
  const cat = useQuery(trpc.catalog.list.queryOptions({ console: consoleId }));
  const radar = useQuery(trpc.catalog.radar.queryOptions());
  const mine = useMemo(() => (games.data ?? []).filter(g => g.console === consoleId), [games.data, consoleId]);
  const updates = useQueries({ queries: mine.filter(g => g.sourceRepo).map(g => ({ ...trpc.ports.checkUpdate.queryOptions({ id: g.id }), staleTime: 5 * 60_000 })) });
  const updById = new Map(mine.filter(g => g.sourceRepo).map((g, i) => [g.id, updates[i]?.data ?? null]));

  return useMemo(() => {
    const feed: RadarEvent[] = (radar.data ?? []).filter(e => e.console === consoleId);
    const fresh = new Set(feed.filter(e => e.kind === 'new' && Date.now() - e.at < FRESH_MS).map(e => e.gameId));
    const byCat = new Map((cat.data ?? []).map(c => [c.id, c]));
    const lib: HubGame[] = mine.map(g => {
      const c = g.catalogId ? byCat.get(g.catalogId) ?? null : null;
      return { key: g.id, title: g.title, coverUrl: g.coverUrl ?? c?.coverUrl ?? null, status: c?.status ?? null, installed: g, catalog: c,
        isNew: !!c && fresh.has(c.id), update: updById.get(g.id) ?? null, repo: g.sourceRepo ?? c?.repo ?? null, console: g.console, platformName: c?.platformName ?? null };
    }).sort((a, b) => (b.installed!.lastPlayed ?? b.installed!.addedAt) - (a.installed!.lastPlayed ?? a.installed!.addedAt));
    const have = new Set(mine.map(g => g.catalogId).filter(Boolean));
    const notInstalled: HubGame[] = (cat.data ?? []).filter(c => !have.has(c.id)).map(c => ({
      key: c.id, title: c.title, coverUrl: c.coverUrl, status: c.status, installed: null, catalog: c, isNew: fresh.has(c.id), update: null, repo: c.repo,
      console: c.console, platformName: c.platformName,
    }));
    const catalog = [...lib.filter(g => g.catalog), ...notInstalled].sort((a, b) => Number(b.isNew) - Number(a.isNew) || Number(!!a.installed) - Number(!!b.installed));
    return {
      loading: games.isLoading || cat.isLoading,
      lib,                                    // instalados, o último jogado primeiro
      notInstalled,                           // do catálogo, ainda não instalados (mais estrelas primeiro)
      catalog,                                // tudo do catálogo, novos primeiro
      feed,
      withUpdate: lib.filter(g => g.update?.updateAvailable),
      playMs: mine.reduce((s, g) => s + g.playMs, 0),
    };
  }, [mine, cat.data, radar.data, consoleId, cat.isLoading, games.isLoading, updates.map(u => u.dataUpdatedAt).join()]);   // eslint-disable-line react-hooks/exhaustive-deps
}

/** Ações que todo hub oferece: jogar, instalar, atualizar, fechar, ver no GitHub. */
export function useHubActions() {
  const trpc = useTRPC(), qc = useQueryClient();
  const refresh = () => { void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }); void qc.invalidateQueries({ queryKey: trpc.library.summary.queryKey() }); };
  const play = useMutation(trpc.play.start.mutationOptions({ onSuccess: refresh }));
  const quit = useMutation(trpc.play.quit.mutationOptions());
  const install = useMutation(trpc.ports.install.mutationOptions({ onSuccess: () => void qc.invalidateQueries() }));
  const update = useMutation(trpc.ports.update.mutationOptions({ onSuccess: () => void qc.invalidateQueries() }));
  const add = useMutation(trpc.games.addFromDialog.mutationOptions({ onSuccess: () => void qc.invalidateQueries() }));
  const checkAll = useMutation({ mutationFn: async (ids: string[]) => { await Promise.all(ids.map(id => qc.fetchQuery(trpc.ports.checkUpdate.queryOptions({ id, force: true }, { staleTime: 0 })))); await qc.invalidateQueries({ queryKey: trpc.ports.checkUpdate.pathKey() }); } });
  const error = play.error ?? install.error ?? update.error ?? quit.error ?? add.error;

  return {
    error: error?.message ?? null,
    reset: () => { play.reset(); install.reset(); update.reset(); quit.reset(); add.reset(); },
    /** Instalado: abre (ou fecha, se já estiver aberto). Não instalado: instala, ou pede a pasta (consoles em que o usuário instala sozinho). */
    primary(g: HubGame): 'play' | 'quit' | 'install' | 'add' | 'pick' | 'none' {
      if (g.installed?.running) { quit.mutate({ id: g.installed.id }); return 'quit'; }
      if (g.installed) { if (!g.installed.exe) return 'pick'; play.mutate({ id: g.installed.id }); return 'play'; }
      if (g.catalog && isSelfInstall(g.console)) { add.mutate({ catalogId: g.catalog.id }); return 'add'; }
      if (g.catalog?.repo) { install.mutate({ catalogId: g.catalog.id }); return 'install'; }
      return 'none';
    },
    /** Atualiza, ou só abre a página de versões quando o usuário instala sozinho. Devolve o que fez. */
    update: (g: HubGame): 'update' | 'page' | 'none' => {
      if (!g.installed) return 'none';
      if (isSelfInstall(g.console)) { if (!g.repo) return 'none'; window.open(`https://github.com/${g.repo}/releases`, '_blank'); return 'page'; }
      update.mutate({ id: g.installed.id }); return 'update';
    },
    github: (g: HubGame) => { if (g.repo) window.open(`https://github.com/${g.repo}`, '_blank'); },
    checkAll: (gs: HubGame[]) => checkAll.mutate(gs.filter(g => g.installed?.sourceRepo).map(g => g.installed!.id)),
    checking: checkAll.isPending,
  };
}

/** Progresso de instalação/atualização deste jogo, se houver. */
export const useGameProgress = (g: HubGame | null | undefined) => {
  const a = useProgress(g?.installed?.id), b = useProgress(g?.catalog?.id);
  return a ?? b;
};
