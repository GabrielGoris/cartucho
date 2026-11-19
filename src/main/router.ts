import { on } from 'node:events';
import { BrowserWindow, dialog, shell } from 'electron';
import { initTRPC } from '@trpc/server';
import superjson from 'superjson';
import { z } from 'zod';
import type { LibrarySummary, UnlockEvent } from '@shared/types';
import type { DB } from './db';
import { kvGet } from './db';
import { listCatalog, listRadar, markRadarSeen, perConsole, platformCount, radarCounts, refreshCatalog } from './catalog';
import type { AchievementService } from './achievements/service';
import { ADAPTERS } from './achievements/adapters';

const t = initTRPC.create({ transformer: superjson, isServer: true });

export function createRouter(db: DB, ach: AchievementService) {
  return t.router({
    library: t.router({
      summary: t.procedure.query((): LibrarySummary => {
        const pc = perConsole(db), rc = radarCounts(db);
        return {
          catalogTotal: Object.values(pc).reduce((s, x) => s + x.recomps, 0),
          platforms: platformCount(db),
          perConsole: pc,
          installed: ach.listGames().length,
          radar: { unseen: rc.unseen ?? 0, fresh: rc.fresh ?? 0, updates: rc.updates ?? 0 },
          achievements: ach.totals(),
        };
      }),
    }),

    catalog: t.router({
      markRadarSeen: t.procedure.mutation(() => { markRadarSeen(db); }),
      list: t.procedure.input(z.object({ console: z.string().optional(), search: z.string().optional() }).optional())
        .query(({ input }) => listCatalog(db, input ?? {})),
      refresh: t.procedure.input(z.object({ force: z.boolean().optional() }).optional())
        .mutation(({ input }) => refreshCatalog(db, input ?? {})),
      radar: t.procedure.query(() => listRadar(db)),
      info: t.procedure.query(() => ({
        generatedAt: kvGet(db, 'catalog.generatedAt'),
        checkedAt: Number(kvGet(db, 'catalog.checkedAt') ?? 0) || null,
      })),
    }),

    games: t.router({
      list: t.procedure.query(() => ach.listGames()),
      /** Abre o seletor de pasta e adiciona o jogo. Devolve null se o usuário cancelar. */
      addFromDialog: t.procedure.mutation(async () => {
        const win = BrowserWindow.getFocusedWindow();
        const opts = { title: 'Escolha a pasta do jogo', properties: ['openDirectory' as const] };
        const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
        if (res.canceled || !res.filePaths[0]) return null;
        return ach.addGame(res.filePaths[0]);
      }),
      remove: t.procedure.input(z.object({ id: z.string() })).mutation(({ input }) => ach.removeGame(input.id)),
      openFolder: t.procedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
        const g = ach.listGames().find(x => x.id === input.id);
        if (g) await shell.openPath(g.installDir);
      }),
    }),

    achievements: t.router({
      recent: t.procedure.input(z.object({ limit: z.number().int().min(1).max(50).optional() }).optional())
        .query(({ input }) => ach.recentUnlocks(input?.limit)),
      supported: t.procedure.query(() => ADAPTERS.map(a => ({ id: a.id, label: a.label, repos: a.repos }))),
      forGame: t.procedure.input(z.object({ id: z.string() })).query(({ input }) => ach.forGame(input.id)),
      resync: t.procedure.input(z.object({ id: z.string() })).mutation(({ input }) => ach.resync(input.id)),
      onUnlock: t.procedure.subscription(async function* ({ signal }) {
        for await (const [e] of on(ach.events, 'unlock', { signal })) yield e as UnlockEvent;
      }),
      onChanged: t.procedure.subscription(async function* ({ signal }) {
        for await (const [id] of on(ach.events, 'changed', { signal })) yield id as string;
      }),
    }),
  });
}

export type AppRouter = ReturnType<typeof createRouter>;
