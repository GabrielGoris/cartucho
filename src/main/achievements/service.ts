/**
 * Junta as camadas 1 e 2: guarda a lista de conquistas de cada jogo instalado no banco, lê os
 * desbloqueios do arquivo do recomp e fica de olho nele enquanto o Cartucho está aberto.
 */
import { EventEmitter } from 'node:events';
import { existsSync, unwatchFile, watchFile } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ConsoleId, GameAchievements, InstalledGame, RecentUnlock, UnlockEvent } from '@shared/types';
import { type DB, kvGet, kvSet, tx } from '../db';
import { absUrl } from '../catalog';
import { type Adapter, type AdapterContext, adapterById, adapterForDir } from './adapters';
import type { Unlock } from './saves';

/** Console de origem quando o jogo não está no catálogo. */
const ADAPTER_CONSOLE: Record<string, ConsoleId> = { 'unleashed-recomp': 'x360', 'marathon-recomp': 'x360', sonic3air: 'other', rsdkv4: 'other' };

type GameRow = { id: string; catalog_id: string | null; title: string; console: string; install_dir: string; adapter: string | null; added_at: number; cover_url: string | null };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class AchievementService {
  readonly events = new EventEmitter<{ unlock: [UnlockEvent]; changed: [string] }>();
  private watching = new Map<string, string>();
  private busy = new Map<string, Promise<number[]>>();

  constructor(private db: DB, private appData: string) {}

  // ---------- jogos instalados ----------

  private row(id: string) {
    const r = this.db.prepare('SELECT g.*, c.cover_url FROM installed_game g LEFT JOIN catalog_game c ON c.id = g.catalog_id WHERE g.id = ?').get(id) as GameRow | undefined;
    if (!r) throw new Error('jogo não encontrado');
    return r;
  }
  private toGame(r: GameRow): InstalledGame {
    const adapter = adapterById(r.adapter);
    const counts = adapter ? this.db.prepare(`SELECT (SELECT COUNT(*) FROM achievement_def WHERE game_id = ?) total,
      (SELECT COUNT(*) FROM achievement_unlock WHERE game_id = ?) unlocked`).get(r.id, r.id) as { total: number; unlocked: number } : null;
    return {
      id: r.id, title: r.title, console: r.console as ConsoleId, installDir: r.install_dir, adapter: r.adapter, adapterLabel: adapter?.label ?? null,
      catalogId: r.catalog_id, coverUrl: absUrl(r.cover_url), addedAt: r.added_at, achievements: counts,
    };
  }
  private ctx(r: GameRow): AdapterContext { return { installDir: r.install_dir, appData: this.appData, title: r.title }; }

  listGames(): InstalledGame[] {
    return (this.db.prepare('SELECT g.*, c.cover_url FROM installed_game g LEFT JOIN catalog_game c ON c.id = g.catalog_id ORDER BY g.title').all() as GameRow[]).map(r => this.toGame(r));
  }

  /** Acha o jogo do catálogo pelo nome do repositório. Se houver mais de um (Sonic 1 e 2 dividem o RSDKv4), usa o nome da pasta para desempatar. */
  private matchCatalog(adapter: Adapter, dir: string) {
    const rows = adapter.repos.flatMap(name => this.db.prepare(`SELECT id, title, console FROM catalog_game WHERE retired = 0 AND (lower(repo) = ? OR lower(repo) LIKE ?)`)
      .all(name, `%/${name}`) as { id: string; title: string; console: string }[]);
    if (rows.length <= 1) return rows[0] ?? null;
    const folder = basename(dir).toLowerCase();
    const wants2 = /2/.test(folder);
    return rows.find(r => /\b2\b/.test(r.title) === wants2) ?? rows[0]!;
  }

  async addGame(dir: string): Promise<InstalledGame> {
    dir = resolve(dir);
    const dup = this.db.prepare('SELECT id FROM installed_game WHERE install_dir = ?').get(dir) as { id: string } | undefined;
    if (dup) return this.toGame(this.row(dup.id));
    const adapter = adapterForDir(dir);
    const cat = adapter ? this.matchCatalog(adapter, dir) : null;
    const id = randomUUID();
    this.db.prepare('INSERT INTO installed_game (id, catalog_id, title, console, install_dir, adapter, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id, cat?.id ?? null, cat?.title ?? adapter?.label ?? basename(dir), cat?.console ?? (adapter ? ADAPTER_CONSOLE[adapter.id] : 'other') ?? 'other', dir, adapter?.id ?? null, Date.now());
    if (adapter) {
      await this.syncDefinitions(id);
      await this.syncUnlocks(id, { silent: true });   // o que já estava desbloqueado antes não vira notificação
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

  // ---------- camada 2: a lista ----------

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
      kvSet(this.db, `ach.defError.${id}`, `Não consegui ler a lista de conquistas: ${msg(e)}`);
    }
  }

  // ---------- camada 1: os desbloqueios ----------

  /** Lê o arquivo de desbloqueios e grava os novos. Devolve os ids que apareceram agora. */
  syncUnlocks(id: string, opts: { silent?: boolean } = {}): Promise<number[]> {
    // Um por vez por jogo: o watcher e o botão "sincronizar" podem chegar juntos.
    const prev = this.busy.get(id) ?? Promise.resolve([]);
    const next = prev.catch(() => []).then(() => this.doSyncUnlocks(id, opts));
    this.busy.set(id, next);
    return next;
  }

  private async doSyncUnlocks(id: string, opts: { silent?: boolean }): Promise<number[]> {
    const r = this.row(id), adapter = adapterById(r.adapter);
    if (!adapter) return [];
    const file = adapter.unlockFile(this.ctx(r));
    if (!existsSync(file)) { this.db.prepare('DELETE FROM kv WHERE key = ?').run(`ach.unlockError.${id}`); return []; }   // ainda não jogou

    let unlocks: Unlock[] | null = null, lastErr: unknown;
    for (let i = 0; i < 4 && !unlocks; i++) {      // o jogo pode estar no meio da gravação
      try { unlocks = adapter.readUnlocks(new Uint8Array(await readFile(file))); }
      catch (e) { lastErr = e; await sleep(250 * (i + 1)); }
    }
    if (!unlocks) { kvSet(this.db, `ach.unlockError.${id}`, `Não consegui ler os desbloqueios: ${msg(lastErr)}`); return []; }
    this.db.prepare('DELETE FROM kv WHERE key = ?').run(`ach.unlockError.${id}`);

    const now = Date.now(), fresh: number[] = [];
    const have = new Map((this.db.prepare('SELECT ach_id, unlocked_at FROM achievement_unlock WHERE game_id = ?').all(id) as { ach_id: number; unlocked_at: number | null }[]).map(u => [u.ach_id, u.unlocked_at]));
    const ins = this.db.prepare('INSERT INTO achievement_unlock (game_id, ach_id, unlocked_at, seen_at) VALUES (?, ?, ?, ?)');
    const fix = this.db.prepare('UPDATE achievement_unlock SET unlocked_at = ? WHERE game_id = ? AND ach_id = ?');
    // Se o save some ou é apagado, o histórico continua no Cartucho (como na Steam).
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
          const n = (name.get(id, achId) as { name: string } | undefined)?.name ?? `Conquista #${achId}`;
          this.events.emit('unlock', { gameId: id, gameTitle: r.title, achId, name: n, at: unlocks.find(u => u.id === achId)?.at ?? now });
        }
      }
    }
    return fresh;
  }

  // ---------- observação ----------

  /** watchFile (por polling) e não fs.watch: funciona com arquivo que ainda não existe e com gravação por renomear no Windows. */
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
  /** Ao abrir o Cartucho: confere o que mudou enquanto ele estava fechado e começa a observar. */
  async start() {
    for (const g of this.listGames()) {
      if (!g.adapter) continue;
      if (!this.db.prepare('SELECT 1 FROM achievement_def WHERE game_id = ? LIMIT 1').get(g.id)) await this.syncDefinitions(g.id);
      await this.syncUnlocks(g.id).catch(() => {});
      this.watch(g.id);
    }
  }
  stop() { for (const id of [...this.watching.keys()]) this.unwatch(id); }

  // ---------- leitura para a tela ----------

  /** Últimos desbloqueios de todos os jogos (para o perfil e a abertura). */
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
    // Desbloqueios de ids que a lista não tem (lista ausente ou de outra versão do jogo).
    const known = new Set(defs.map(d => d.ach_id));
    for (const [achId, at] of unlocks) if (!known.has(achId)) list.push({ id: achId, name: `Conquista #${achId}`, description: '', points: null, unlockedAt: at, icon: null });
    const errors = [kvGet(this.db, `ach.defError.${id}`), kvGet(this.db, `ach.unlockError.${id}`)].filter((e): e is string => !!e);
    return { game: this.toGame(r), origin: kvGet(this.db, `ach.origin.${id}`), unlockFile: adapter ? adapter.unlockFile(this.ctx(r)) : null, errors, list };
  }
}
