import { on } from 'node:events';
import { BrowserWindow, dialog, shell } from 'electron';
import { initTRPC } from '@trpc/server';
import superjson from 'superjson';
import { z } from 'zod';
import type { InstallProgress, LibrarySummary, PlayEvent, UnlockEvent } from '@shared/types';
import type { DB } from './db';
import { kvGet, kvSet } from './db';
import { listCatalog, listRadar, markRadarSeen, perConsole, platformCount, radarCounts, refreshCatalog } from './catalog';
import type { AchievementService } from './achievements/service';
import { ADAPTERS } from './achievements/adapters';
import type { Ports } from './ports/installer';
import { parseRepo } from './ports/github';
import type { Player } from './play';
import type { Artwork } from './artwork/service';
import type { Translator } from './translate';

export interface RouterDeps { db: DB; ach: AchievementService; ports: Ports; player: Player; art: Artwork; tr: Translator; defaultPortsDir: string }
export const portsDirOf = (d: Pick<RouterDeps, 'db' | 'defaultPortsDir'>) => kvGet(d.db, 'portsDir') || d.defaultPortsDir;

async function pick(title: string, props: ('openDirectory' | 'openFile' | 'createDirectory')[], extra: Partial<Electron.OpenDialogOptions> = {}) {
  const win = BrowserWindow.getFocusedWindow();
  const opts: Electron.OpenDialogOptions = { title, properties: props, ...extra };
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return res.canceled ? null : res.filePaths[0] ?? null;
}

const t = initTRPC.create({ transformer: superjson, isServer: true });

export function createRouter(deps: RouterDeps) {
  const { db, ach, ports, player, art, tr } = deps;
  return t.router({
    art: t.router({
      get: t.procedure.input(z.object({ console: z.string(), platformName: z.string().nullish(), title: z.string() }))
        .query(({ input }) => art.get(input.console, input.platformName, [input.title])),
      shots: t.procedure.input(z.object({ console: z.string(), platformName: z.string().nullish(), title: z.string() }))
        .query(({ input }) => art.shots(input.console, input.platformName, [input.title])),
      status: t.procedure.query(() => art.status),
      refresh: t.procedure.mutation(() => art.refresh()),
      onChanged: t.procedure.subscription(async function* ({ signal }) { for await (const _ of on(art.events, 'changed', { signal })) yield Date.now(); }),
      onStatus: t.procedure.subscription(async function* ({ signal }) { for await (const [s] of on(art.events, 'status', { signal })) yield s as string | null; }),
    }),

    i18n: t.router({
      translate: t.procedure.input(z.object({ text: z.string().max(8000) })).query(({ input }) => tr.translate(input.text)),
    }),

    settings: t.router({
      portsDir: t.procedure.query(() => portsDirOf(deps)),
      pickPortsDir: t.procedure.mutation(async () => {
        const dir = await pick('Onde o Cartucho deve instalar os jogos?', ['openDirectory', 'createDirectory'], { defaultPath: portsDirOf(deps) });
        if (dir) kvSet(db, 'portsDir', dir);
        return portsDirOf(deps);
      }),
    }),

    ports: t.router({
      install: t.procedure.input(z.object({ catalogId: z.string() })).mutation(({ input }) => ports.installFromCatalog(input.catalogId)),
      installRepo: t.procedure.input(z.object({ repo: z.string() })).mutation(({ input }) => ports.install(parseRepo(input.repo))),
      checkUpdate: t.procedure.input(z.object({ id: z.string(), force: z.boolean().optional() })).query(({ input }) => ports.checkUpdate(input.id, input.force)),
      update: t.procedure.input(z.object({ id: z.string() })).mutation(({ input }) => ports.update(input.id)),
      uninstall: t.procedure.input(z.object({ id: z.string() })).mutation(({ input }) => ports.uninstall(input.id)),
      setSource: t.procedure.input(z.object({ id: z.string(), repo: z.string().nullable() })).mutation(({ input }) => {
        ach.patchGame(input.id, { sourceRepo: input.repo ? parseRepo(input.repo) : null, release: null });
        db.prepare('DELETE FROM kv WHERE key = ?').run(`upd.${input.id}`);
        return ach.getGame(input.id);
      }),
      onProgress: t.procedure.subscription(async function* ({ signal }) {
        for await (const [p] of on(ports.events, 'progress', { signal })) yield p as InstallProgress;
      }),
    }),

    play: t.router({
      start: t.procedure.input(z.object({ id: z.string() })).mutation(({ input }) => player.play(input.id)),
      quit: t.procedure.input(z.object({ id: z.string() })).mutation(({ input }) => player.quit(input.id)),
      stats: t.procedure.input(z.object({ id: z.string().optional() }).optional()).query(({ input }) => player.stats(input?.id)),
      onEvent: t.procedure.subscription(async function* ({ signal }) {
        for await (const [e] of on(player.events, 'play', { signal })) yield e as PlayEvent;
      }),
    }),

    library: t.router({
      summary: t.procedure.query((): LibrarySummary => {
        const pc = perConsole(db), rc = radarCounts(db), games = ach.listGames().filter(g => !g.missing);
        for (const x of Object.values(pc)) x.installed = 0;
        for (const g of games) (pc[g.console] ??= { recomps: 0, installed: 0, fresh: 0, platforms: 0 }).installed++;
        return {
          catalogTotal: Object.values(pc).reduce((s, x) => s + x.recomps, 0),
          platforms: platformCount(db),
          perConsole: pc,
          installed: games.length,
          playMs: player.stats().totalMs,
          radar: { unseen: rc.unseen ?? 0, fresh: rc.fresh ?? 0, updates: rc.updates ?? 0 },
          achievements: ach.totals(),
        };
      }),
    }),

    catalog: t.router({
      markRadarSeen: t.procedure.mutation(() => { markRadarSeen(db); }),
      list: t.procedure.input(z.object({ console: z.string().optional(), consoles: z.array(z.string()).optional(), search: z.string().optional() }).optional())
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
      get: t.procedure.input(z.object({ id: z.string() })).query(({ input }) => ach.getGame(input.id)),
      chooseExe: t.procedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
        const g = ach.getGame(input.id);
        const file = await pick(`Qual programa abre ${g.title}?`, ['openFile'], { defaultPath: g.installDir, filters: process.platform === 'win32' ? [{ name: 'Programas', extensions: ['exe', 'bat', 'lnk'] }] : [] });
        if (file) ach.patchGame(input.id, { exe: file });
        return ach.getGame(input.id);
      }),
      addFromDialog: t.procedure.input(z.object({ catalogId: z.string().optional() }).optional()).mutation(async ({ input }) => {
        const dir = await pick(input?.catalogId ? 'Escolha a pasta onde você instalou o jogo' : 'Escolha a pasta do jogo', ['openDirectory']);
        return dir ? ach.addGame(dir, { catalogId: input?.catalogId ?? null }) : null;
      }),
      relink: t.procedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
        const dir = await pick(`Onde está ${ach.getGame(input.id).title} agora?`, ['openDirectory']);
        return dir ? ach.relocate(input.id, dir) : null;
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
