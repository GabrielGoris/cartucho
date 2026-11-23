import { EventEmitter } from 'node:events';
import { existsSync, unwatchFile, watchFile } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isSelfInstall } from '@shared/consoles';
import type { ConsoleId, GameAchievements, InstalledGame, InstalledRelease, RecentUnlock, UnlockEvent } from '@shared/types';
import { findGameExe, guessProgram } from '../ports/files';
import { type DB, kvGet, kvSet, tx } from '../db';
import { absUrl } from '../catalog';
import { type Adapter, type AdapterContext, adapterById, adapterForDir } from './adapters';
import type { Unlock } from './saves';
import { tt } from '@shared/i18n';
import { steamManifest, windowsAppData } from '../steam';

const ADAPTER_CONSOLE: Record<string, ConsoleId> = { 'unleashed-recomp': 'x360', 'marathon-recomp': 'x360', sonic3air: 'other', rsdkv4: 'other' };

type GameRow = {
  id: string; catalog_id: string | null; title: string; console: string; install_dir: string; adapter: string | null; added_at: number; cover_url: string | null; platform_name: string | null;
  exe: string | null; version: string | null; source_repo: string | null; managed: number; play_ms: number; last_played: number | null;
};
export interface AddExtra { catalogId?: string | null; title?: string; console?: string; exe?: string | null; sourceRepo?: string | null; release?: InstalledRelease | null; managed?: boolean; manifest?: Record<string, number> | null }
const GAME_SQL = `SELECT g.*, c.cover_url, c.platform_name,
  (SELECT COALESCE(SUM(p.ended_at - p.started_at), 0) FROM play_session p WHERE p.game_id = g.id AND p.ended_at IS NOT NULL) play_ms,
  (SELECT MAX(p.started_at) FROM play_session p WHERE p.game_id = g.id) last_played
  FROM installed_game g LEFT JOIN catalog_game c ON c.id = g.catalog_id`;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class AchievementService {
  readonly events = new EventEmitter<{ unlock: [UnlockEvent]; changed: [string] }>();
  private watching = new Map<string, string>();
  private busy = new Map<string, Promise<number[]>>();

  constructor(private db: DB, private appData: string) {}

  isRunning: (id: string) => boolean = () => false;

  private row(id: string) {
    const r = this.db.prepare(`${GAME_SQL} WHERE g.id = ?`).get(id) as GameRow | undefined;
    if (!r) throw new Error(tt('jogo não encontrado'));
    return r;
  }
  private toGame(r: GameRow): InstalledGame {
    const adapter = adapterById(r.adapter);
    const counts = adapter ? this.db.prepare(`SELECT (SELECT COUNT(*) FROM achievement_def WHERE game_id = ?) total,
      (SELECT COUNT(*) FROM achievement_unlock WHERE game_id = ?) unlocked`).get(r.id, r.id) as { total: number; unlocked: number } : null;
    return {
      id: r.id, title: r.title, console: r.console as ConsoleId, platformName: r.platform_name ?? null, installDir: r.install_dir, adapter: r.adapter, adapterLabel: adapter?.label ?? null,
      catalogId: r.catalog_id, coverUrl: absUrl(r.cover_url), addedAt: r.added_at, achievements: counts,
      exe: r.exe, sourceRepo: isSelfInstall(r.console) ? null : r.source_repo, version: r.version, managed: !!r.managed,
      playMs: r.play_ms ?? 0, lastPlayed: r.last_played ?? null, running: this.isRunning(r.id), missing: !existsSync(r.install_dir),
    };
  }
  private ctx(r: GameRow): AdapterContext {
    const appData = process.platform === 'linux' ? windowsAppData(r.install_dir, r.exe) ?? this.appData : this.appData;
    return { installDir: r.install_dir, appData, title: r.title };
  }

  listGames(): InstalledGame[] {
    return (this.db.prepare(`${GAME_SQL} ORDER BY g.title`).all() as GameRow[]).map(r => this.toGame(r));
  }
  getGame(id: string) { return this.toGame(this.row(id)); }
  internals(id: string) {
    const r = this.db.prepare('SELECT release_json, manifest_json FROM installed_game WHERE id = ?').get(id) as { release_json: string | null; manifest_json: string | null } | undefined;
    return { release: r?.release_json ? JSON.parse(r.release_json) as InstalledRelease : null, manifest: r?.manifest_json ? JSON.parse(r.manifest_json) as Record<string, number> : null };
  }
  addEmulated({ title, console, exe }: { title: string; console: string; exe: string }) {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO installed_game (id, catalog_id, title, console, install_dir, adapter, added_at, exe, source_repo, release_json, version, managed, manifest_json)
      VALUES (?, NULL, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, 0, NULL)`).run(id, title, console, dirname(exe), Date.now(), exe);
    this.events.emit('changed', id);
    return this.toGame(this.row(id));
  }

  patchGame(id: string, p: { exe?: string | null; sourceRepo?: string | null; release?: InstalledRelease | null; manifest?: Record<string, number> | null; title?: string; console?: string }) {
    const sets: string[] = [], args: (string | null)[] = [];
    if (p.exe !== undefined) { sets.push('exe = ?'); args.push(p.exe); }
    if (p.sourceRepo !== undefined) { sets.push('source_repo = ?'); args.push(p.sourceRepo); }
    if (p.release !== undefined) { sets.push('release_json = ?', 'version = ?'); args.push(p.release ? JSON.stringify(p.release) : null, p.release?.tag ?? null); }
    if (p.manifest !== undefined) { sets.push('manifest_json = ?'); args.push(p.manifest ? JSON.stringify(p.manifest) : null); }
    if (p.title !== undefined) { sets.push('title = ?'); args.push(p.title); }
    if (p.console !== undefined) { sets.push('console = ?'); args.push(p.console); }
    if (sets.length) this.db.prepare(`UPDATE installed_game SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    this.events.emit('changed', id);
  }

  private matchCatalog(adapter: Adapter, dir: string) {
    const rows = adapter.repos.flatMap(name => this.db.prepare(`SELECT id, title, console, repo FROM catalog_game WHERE retired = 0 AND (lower(repo) = ? OR lower(repo) LIKE ?)`)
      .all(name, `%/${name}`) as { id: string; title: string; console: string; repo: string | null }[]);
    if (rows.length <= 1) return rows[0] ?? null;
    const folder = basename(dir).toLowerCase();
    const wants2 = /2/.test(folder);
    return rows.find(r => /\b2\b/.test(r.title) === wants2) ?? rows[0]!;
  }

  relocate(id: string, dir: string, p: { exe?: string | null; release?: InstalledRelease | null; manifest?: Record<string, number> | null; managed?: boolean } = {}) {
    dir = resolve(dir);
    const other = this.db.prepare('SELECT id, title FROM installed_game WHERE install_dir = ? AND id != ?').get(dir, id) as { id: string; title: string } | undefined;
    if (other) throw new Error(tt('Essa pasta já é de {0}. Escolha outra pasta, ou troque a pasta de {1} antes.', { 0: other.title, 1: other.title }));
    const r = this.row(id);
    let exe = p.exe ?? null;
    if (!exe) try { exe = findGameExe(dir) ?? guessProgram(dir, r.source_repo); } catch { exe = null; }
    this.unwatch(id);
    this.db.prepare('UPDATE installed_game SET install_dir = ?, exe = ? WHERE id = ?').run(dir, exe, id);
    if (p.managed !== undefined) this.db.prepare('UPDATE installed_game SET managed = ? WHERE id = ?').run(p.managed ? 1 : 0, id);
    this.patchGame(id, { ...(p.release !== undefined ? { release: p.release } : {}), ...(p.manifest !== undefined ? { manifest: p.manifest } : {}) });
    if (r.adapter) this.watch(id);
    return this.toGame(this.row(id));
  }

  async addGame(dir: string, extra: AddExtra = {}): Promise<InstalledGame> {
    dir = resolve(dir);
    const dup = this.db.prepare('SELECT id, title, catalog_id FROM installed_game WHERE install_dir = ?').get(dir) as { id: string; title: string; catalog_id: string | null } | undefined;
    if (dup && extra.catalogId && dup.catalog_id !== extra.catalogId) throw new Error(tt('Essa pasta já é de {0}. Escolha outra pasta, ou troque a pasta de {1} antes.', { 0: dup.title, 1: dup.title }));
    if (dup) return this.toGame(this.row(dup.id));
    const lost = extra.catalogId ? (this.db.prepare('SELECT id, install_dir FROM installed_game WHERE catalog_id = ?').all(extra.catalogId) as { id: string; install_dir: string }[]).find(x => !existsSync(x.install_dir)) : undefined;
    if (lost) return this.relocate(lost.id, dir, { exe: extra.exe, release: extra.release, manifest: extra.manifest, managed: extra.managed });
    const adapter = adapterForDir(dir);
    const cat = extra.catalogId
      ? this.db.prepare('SELECT id, title, console, repo FROM catalog_game WHERE id = ?').get(extra.catalogId) as { id: string; title: string; console: string; repo: string | null } | undefined
      : adapter ? this.matchCatalog(adapter, dir) : null;
    let exe = extra.exe ?? null;
    if (!exe) try { exe = findGameExe(dir) ?? guessProgram(dir, extra.sourceRepo ?? cat?.repo ?? null); } catch { exe = null; }
    const id = randomUUID();
    this.db.prepare(`INSERT INTO installed_game (id, catalog_id, title, console, install_dir, adapter, added_at, exe, source_repo, release_json, version, managed, manifest_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, cat?.id ?? null, extra.title ?? cat?.title ?? adapter?.label ?? steamManifest(dir, exe)?.name ?? basename(dir),
      extra.console ?? cat?.console ?? (adapter ? ADAPTER_CONSOLE[adapter.id] : 'other') ?? 'other', dir, adapter?.id ?? null, Date.now(),
      exe, extra.sourceRepo ?? cat?.repo ?? null, extra.release ? JSON.stringify(extra.release) : null, extra.release?.tag ?? null,
      extra.managed ? 1 : 0, extra.manifest ? JSON.stringify(extra.manifest) : null);
    if (adapter) {
      await this.syncDefinitions(id);
      await this.syncUnlocks(id, { silent: true });
      this.watch(id);
    }
    return this.toGame(this.row(id));
  }

  removeGame(id: string) {
    this.unwatch(id);
    tx(this.db, () => {
      for (const t of ['achievement_unlock', 'achievement_def', 'play_session']) this.db.prepare(`DELETE FROM ${t} WHERE game_id = ?`).run(id);
      this.db.prepare('DELETE FROM installed_game WHERE id = ?').run(id);
      this.db.prepare("DELETE FROM kv WHERE key LIKE ?").run(`ach.%.${id}`);
    });
  }

  async syncDefinitions(id: string) {
    const r = this.row(id), adapter = adapterById(r.adapter);
    if (!adapter) return;
    try {
      const defs = await adapter.definitions(this.ctx(r));
      const ins = this.db.prepare('INSERT INTO achievement_def (game_id, ach_id, name, description, points, image, sort) VALUES (?, ?, ?, ?, ?, ?, ?)');
      tx(this.db, () => {
        this.db.prepare('DELETE FROM achievement_def WHERE game_id = ?').run(id);
        defs.list.forEach((a, i) => ins.run(id, a.id, a.name, a.description, a.points, defs.images?.get(a.id) ?? null, i));
      });
      kvSet(this.db, `ach.origin.${id}`, defs.origin);
      this.db.prepare('DELETE FROM kv WHERE key = ?').run(`ach.defError.${id}`);
    } catch (e) {
      kvSet(this.db, `ach.defError.${id}`, tt('Não consegui ler a lista de conquistas: {0}', { 0: msg(e) }));
    }
  }

  syncUnlocks(id: string, opts: { silent?: boolean } = {}): Promise<number[]> {
    const prev = this.busy.get(id) ?? Promise.resolve([]);
    const next = prev.catch(() => []).then(() => this.doSyncUnlocks(id, opts));
    this.busy.set(id, next);
    return next;
  }

  private async doSyncUnlocks(id: string, opts: { silent?: boolean }): Promise<number[]> {
    const r = this.row(id), adapter = adapterById(r.adapter);
    if (!adapter) return [];
    const file = adapter.unlockFile(this.ctx(r));
    if (!existsSync(file)) { this.db.prepare('DELETE FROM kv WHERE key = ?').run(`ach.unlockError.${id}`); return []; }

    let unlocks: Unlock[] | null = null, lastErr: unknown;
    for (let i = 0; i < 4 && !unlocks; i++) {
      try { unlocks = adapter.readUnlocks(new Uint8Array(await readFile(file))); }
      catch (e) { lastErr = e; await sleep(250 * (i + 1)); }
    }
    if (!unlocks) { kvSet(this.db, `ach.unlockError.${id}`, tt('Não consegui ler os desbloqueios: {0}', { 0: msg(lastErr) })); return []; }
    this.db.prepare('DELETE FROM kv WHERE key = ?').run(`ach.unlockError.${id}`);

    const now = Date.now(), fresh: number[] = [];
    const have = new Map((this.db.prepare('SELECT ach_id, unlocked_at FROM achievement_unlock WHERE game_id = ?').all(id) as { ach_id: number; unlocked_at: number | null }[]).map(u => [u.ach_id, u.unlocked_at]));
    const ins = this.db.prepare('INSERT INTO achievement_unlock (game_id, ach_id, unlocked_at, seen_at) VALUES (?, ?, ?, ?)');
    const fix = this.db.prepare('UPDATE achievement_unlock SET unlocked_at = ? WHERE game_id = ? AND ach_id = ?');
    tx(this.db, () => {
      for (const u of unlocks!) {
        if (!have.has(u.id)) { ins.run(id, u.id, u.at, now); fresh.push(u.id); }
        else if (have.get(u.id) == null && u.at != null) fix.run(u.at, id, u.id);
      }
    });

    if (fresh.length) {
      this.events.emit('changed', id);
      if (!opts.silent) {
        const name = this.db.prepare('SELECT name FROM achievement_def WHERE game_id = ? AND ach_id = ?');
        for (const achId of fresh) {
          const n = (name.get(id, achId) as { name: string } | undefined)?.name ?? tt('Conquista #{0}', { 0: achId });
          this.events.emit('unlock', { gameId: id, gameTitle: r.title, achId, name: n, at: unlocks.find(u => u.id === achId)?.at ?? now });
        }
      }
    }
    return fresh;
  }

  watch(id: string) {
    const r = this.row(id), adapter = adapterById(r.adapter);
    if (!adapter || this.watching.has(id)) return;
    const file = adapter.unlockFile(this.ctx(r));
    let timer: NodeJS.Timeout | undefined;
    watchFile(file, { interval: 1500, persistent: false }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => { void this.syncUnlocks(id).catch(() => {}); }, 400);
    });
    this.watching.set(id, file);
  }
  unwatch(id: string) {
    const file = this.watching.get(id);
    if (file) { unwatchFile(file); this.watching.delete(id); }
  }
  async start() {
    for (const r of this.db.prepare('SELECT id, title, install_dir, exe FROM installed_game WHERE catalog_id IS NULL').all() as { id: string; title: string; install_dir: string; exe: string | null }[]) {
      if (r.title.toLowerCase() !== basename(r.install_dir).toLowerCase()) continue;
      const name = steamManifest(r.install_dir, r.exe)?.name;
      if (name && name !== r.title) this.db.prepare('UPDATE installed_game SET title = ? WHERE id = ?').run(name, r.id);
    }
    for (const r of this.db.prepare(`SELECT g.id, g.install_dir, g.exe, g.source_repo, c.repo FROM installed_game g LEFT JOIN catalog_game c ON c.id = g.catalog_id
        WHERE g.exe IS NULL OR (g.source_repo IS NULL AND c.repo IS NOT NULL)`).all() as { id: string; install_dir: string; exe: string | null; source_repo: string | null; repo: string | null }[]) {
      let exe = r.exe;
      if (!exe) try { exe = findGameExe(r.install_dir) ?? guessProgram(r.install_dir, r.repo); } catch {  }
      this.db.prepare('UPDATE installed_game SET exe = ?, source_repo = COALESCE(source_repo, ?) WHERE id = ?').run(exe, r.repo, r.id);
    }
    for (const g of this.listGames()) {
      if (!g.adapter) continue;
      if (!this.db.prepare('SELECT 1 FROM achievement_def WHERE game_id = ? LIMIT 1').get(g.id)) await this.syncDefinitions(g.id);
      await this.syncUnlocks(g.id).catch(() => {});
      this.watch(g.id);
    }
  }
  stop() { for (const id of [...this.watching.keys()]) this.unwatch(id); }

  recentUnlocks(limit = 8): RecentUnlock[] {
    return (this.db.prepare(`SELECT u.game_id, g.title game, u.ach_id, COALESCE(d.name, 'Conquista #' || u.ach_id) name, d.points, COALESCE(u.unlocked_at, u.seen_at) at
      FROM achievement_unlock u JOIN installed_game g ON g.id = u.game_id LEFT JOIN achievement_def d ON d.game_id = u.game_id AND d.ach_id = u.ach_id
      ORDER BY at DESC LIMIT ?`).all(limit) as { game_id: string; game: string; ach_id: number; name: string; points: number | null; at: number }[])
      .map(r => ({ gameId: r.game_id, gameTitle: r.game, achId: r.ach_id, name: r.name, points: r.points, at: r.at }));
  }

  totals() {
    return this.db.prepare(`SELECT (SELECT COUNT(*) FROM achievement_unlock) unlocked, (SELECT COUNT(*) FROM achievement_def) total`).get() as { unlocked: number; total: number };
  }

  async resync(id: string) { await this.syncDefinitions(id); await this.syncUnlocks(id); return this.forGame(id); }

  forGame(id: string): GameAchievements {
    const r = this.row(id), adapter = adapterById(r.adapter);
    const defs = this.db.prepare('SELECT ach_id, name, description, points, image FROM achievement_def WHERE game_id = ? ORDER BY sort').all(id) as
      { ach_id: number; name: string; description: string; points: number | null; image: Uint8Array | null }[];
    const unlocks = new Map((this.db.prepare('SELECT ach_id, COALESCE(unlocked_at, seen_at) at FROM achievement_unlock WHERE game_id = ?').all(id) as { ach_id: number; at: number }[]).map(u => [u.ach_id, u.at]));
    const list = defs.map(d => ({
      id: d.ach_id, name: d.name, description: d.description, points: d.points, unlockedAt: unlocks.get(d.ach_id) ?? null,
      icon: d.image ? `data:image/png;base64,${Buffer.from(d.image).toString('base64')}` : null,
    }));
    const known = new Set(defs.map(d => d.ach_id));
    for (const [achId, at] of unlocks) if (!known.has(achId)) list.push({ id: achId, name: tt('Conquista #{0}', { 0: achId }), description: '', points: null, unlockedAt: at, icon: null });
    const errors = [kvGet(this.db, `ach.defError.${id}`), kvGet(this.db, `ach.unlockError.${id}`)].filter((e): e is string => !!e);
    return { game: this.toGame(r), origin: kvGet(this.db, `ach.origin.${id}`), unlockFile: adapter ? adapter.unlockFile(this.ctx(r)) : null, errors, list };
  }
}
