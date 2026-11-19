/**
 * Catálogo do Recompendium (https://recompendium.com/), o mesmo que o Harbour usa.
 * Não há API documentada; é o JSON que o próprio site gera todo dia. Pedimos com ETag para não baixar
 * à toa, guardamos uma cópia no banco e funcionamos offline com a última versão.
 */
import { z } from 'zod';
import { toConsoleId, toStatus } from '@shared/consoles';
import type { CatalogGame, RadarEvent } from '@shared/types';
import { type DB, kvGet, kvSet, tx } from './db';

export const CATALOG_URL = process.env.CARTUCHO_CATALOG_URL || 'https://recompendium.com/unricopie/catalogo.json';
/** As capas podem vir com caminho relativo ao catálogo. */
export const absUrl = (u: string | null) => { if (!u) return null; try { return new URL(u, 'https://recompendium.com/unricopie/catalogo.json').href; } catch { return null; } };
const UA = { 'User-Agent': 'Cartucho/0.1 (+https://github.com/)' };

const lang = z.object({ es: z.string().nullish(), en: z.string().nullish() }).partial().nullish();
const Entry = z.object({
  entry: z.string(),
  nombre: z.string(),
  repo: z.string().nullish(),
  consola: z.string().nullish(),
  consola_nombre: z.string().nullish(),
  desarrollador: z.string().nullish(),
  anio: z.number().nullish(),
  estado: z.string().nullish(),
  desc: lang,
  requisitos: lang,
  retirado: z.boolean().nullish(),
  sin_enlace: z.boolean().nullish(),
  version: z.string().nullish(),
  fecha: z.string().nullish(),
  estrellas: z.number().nullish(),
  arte: z.object({ portada: z.string().nullish() }).partial().nullish(),
}).loose();
const Catalog = z.object({ formato: z.number(), generado: z.string().nullish(), entradas: z.array(z.unknown()) }).loose();

export interface RefreshResult { changed: boolean; total: number; added: number; statusChanged: number; updated: number; generatedAt: string | null; error?: string }

export async function refreshCatalog(db: DB, opts: { force?: boolean } = {}): Promise<RefreshResult> {
  const headers: Record<string, string> = { ...UA };
  const etag = kvGet(db, 'catalog.etag'), modified = kvGet(db, 'catalog.lastModified');
  if (!opts.force) { if (etag) headers['If-None-Match'] = etag; if (modified) headers['If-Modified-Since'] = modified; }

  const res = await fetch(CATALOG_URL, { headers, signal: AbortSignal.timeout(30_000) });
  kvSet(db, 'catalog.checkedAt', String(Date.now()));
  const total = (db.prepare('SELECT COUNT(*) n FROM catalog_game WHERE retired = 0').get() as { n: number }).n;
  if (res.status === 304) return { changed: false, total, added: 0, statusChanged: 0, updated: 0, generatedAt: kvGet(db, 'catalog.generatedAt') };
  if (!res.ok) throw new Error(`o Recompendium respondeu ${res.status}`);

  const parsed = Catalog.parse(await res.json());
  if (parsed.formato !== 1) throw new Error(`formato de catálogo ${parsed.formato} ainda não suportado`);
  const entries = parsed.entradas.flatMap(e => { const r = Entry.safeParse(e); return r.success ? [r.data] : []; });

  const now = Date.now();
  const firstSync = total === 0;
  const prev = new Map((db.prepare('SELECT id, status, version, retired FROM catalog_game').all() as { id: string; status: string; version: string | null; retired: number }[]).map(r => [r.id, r]));
  const upsert = db.prepare(`
    INSERT INTO catalog_game (id, title, repo, console, platform_name, status, version, date, stars, year, developer, needs, description, cover_url, retired, no_link, first_seen_at, updated_at)
    VALUES (@id, @title, @repo, @console, @platformName, @status, @version, @date, @stars, @year, @developer, @needs, @description, @coverUrl, @retired, @noLink, @now, @now)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, repo=excluded.repo, console=excluded.console, platform_name=excluded.platform_name,
      status=excluded.status, version=excluded.version, date=excluded.date, stars=excluded.stars, year=excluded.year, developer=excluded.developer,
      needs=excluded.needs, description=excluded.description, cover_url=excluded.cover_url, retired=excluded.retired, no_link=excluded.no_link, updated_at=excluded.updated_at`);
  const event = db.prepare('INSERT INTO radar_event (game_id, kind, detail, at) VALUES (?, ?, ?, ?)');
  const installed = new Set((db.prepare('SELECT catalog_id FROM installed_game WHERE catalog_id IS NOT NULL').all() as { catalog_id: string }[]).map(r => r.catalog_id));

  let added = 0, statusChanged = 0, updated = 0;
  tx(db, () => {
    for (const e of entries) {
      // "retirado": o projeto acabou ou sumiu. "sin_enlace": o Recompendium lista mas prefere não pôr link
      // (acontece com jogos atuais, como os de Switch 2). Esses continuam aparecendo, marcados.
      const retired = e.retirado ? 1 : 0, noLink = e.sin_enlace ? 1 : 0;
      const row = {
        id: e.entry, title: e.nombre, repo: e.repo ?? null, console: toConsoleId(e.consola), platformName: e.consola_nombre ?? e.consola ?? 'Outros',
        status: toStatus(e.estado), version: e.version ?? null, date: e.fecha ?? null, stars: e.estrellas ?? 0, year: e.anio ?? null,
        developer: e.desarrollador ?? null, needs: e.requisitos?.en ?? e.requisitos?.es ?? null, description: e.desc?.en ?? e.desc?.es ?? null,
        coverUrl: e.arte?.portada ?? null, retired, noLink, now,
      };
      upsert.run(row);
      const p = prev.get(e.entry);
      if (firstSync || retired) continue;   // na primeira sincronização tudo seria "novo": não avisamos
      if (!p || p.retired) { event.run(e.entry, 'new', e.repo ?? '', now); added++; }
      else if (p.status !== row.status) { event.run(e.entry, 'up', `${p.status}→${row.status}`, now); statusChanged++; }
      else if (row.version && p.version !== row.version && installed.has(e.entry)) { event.run(e.entry, 'upd', `${p.version ?? '?'}→${row.version}`, now); updated++; }
    }
  });

  if (res.headers.get('etag')) kvSet(db, 'catalog.etag', res.headers.get('etag')!);
  if (res.headers.get('last-modified')) kvSet(db, 'catalog.lastModified', res.headers.get('last-modified')!);
  if (parsed.generado) kvSet(db, 'catalog.generatedAt', parsed.generado);
  return { changed: true, total: entries.filter(e => !e.retirado).length, added, statusChanged, updated, generatedAt: parsed.generado ?? null };
}

type Row = { id: string; title: string; repo: string | null; console: string; platform_name: string; status: string; version: string | null; date: string | null; stars: number; year: number | null; developer: string | null; needs: string | null; description: string | null; cover_url: string | null; no_link: number; first_seen_at: number };
const toGame = (r: Row): CatalogGame => ({
  id: r.id, title: r.title, repo: r.repo, console: r.console as CatalogGame['console'], platformName: r.platform_name, status: r.status as CatalogGame['status'],
  version: r.version, date: r.date, stars: r.stars, year: r.year, developer: r.developer, needs: r.needs, description: r.description, coverUrl: absUrl(r.cover_url), noLink: !!r.no_link, firstSeenAt: r.first_seen_at,
});

export function listCatalog(db: DB, filter: { console?: string; search?: string } = {}): CatalogGame[] {
  const where = ['retired = 0'], args: string[] = [];
  if (filter.console) { where.push('console = ?'); args.push(filter.console); }
  if (filter.search) { where.push('(title LIKE ? OR repo LIKE ?)'); args.push(`%${filter.search}%`, `%${filter.search}%`); }
  return (db.prepare(`SELECT * FROM catalog_game WHERE ${where.join(' AND ')} ORDER BY stars DESC, title`).all(...args) as Row[]).map(toGame);
}

export function listRadar(db: DB, limit = 50): RadarEvent[] {
  return (db.prepare(`SELECT r.id, r.game_id, r.kind, r.detail, r.at, c.title, c.console FROM radar_event r JOIN catalog_game c ON c.id = r.game_id ORDER BY r.at DESC, r.id DESC LIMIT ?`).all(limit) as
    { id: number; game_id: string; kind: RadarEvent['kind']; detail: string; at: number; title: string; console: RadarEvent['console'] }[])
    .map(r => ({ id: r.id, gameId: r.game_id, title: r.title, console: r.console, kind: r.kind, detail: r.detail, at: r.at }));
}

/** Novidades do radar desde a última vez que o usuário abriu o radar. */
export function radarCounts(db: DB) {
  const seen = Number(kvGet(db, 'radar.seenAt') ?? 0);
  return db.prepare(`SELECT
      SUM(CASE WHEN at > ? THEN 1 ELSE 0 END) unseen,
      SUM(CASE WHEN kind = 'new' AND at > ? THEN 1 ELSE 0 END) fresh,
      SUM(CASE WHEN kind = 'upd' AND at > ? THEN 1 ELSE 0 END) updates
    FROM radar_event`).get(seen, seen, seen) as { unseen: number | null; fresh: number | null; updates: number | null };
}
export const markRadarSeen = (db: DB) => kvSet(db, 'radar.seenAt', String(Date.now()));

/** Por console: quantos recomps, quantos instalados e quantos chegaram nos últimos 14 dias. */
export function perConsole(db: DB) {
  const since = Date.now() - 14 * 86400_000;
  const out: Record<string, { recomps: number; installed: number; fresh: number }> = {};
  for (const r of db.prepare(`SELECT console, COUNT(*) n, SUM(CASE WHEN id IN (SELECT game_id FROM radar_event WHERE kind = 'new' AND at > ?) THEN 1 ELSE 0 END) fresh
      FROM catalog_game WHERE retired = 0 GROUP BY console`).all(since) as { console: string; n: number; fresh: number }[])
    out[r.console] = { recomps: r.n, installed: 0, fresh: r.fresh ?? 0 };
  for (const r of db.prepare('SELECT console, COUNT(*) n FROM installed_game GROUP BY console').all() as { console: string; n: number }[])
    (out[r.console] ??= { recomps: 0, installed: 0, fresh: 0 }).installed = r.n;
  return out;
}
export const platformCount = (db: DB) => (db.prepare("SELECT COUNT(DISTINCT platform_name) n FROM catalog_game WHERE retired = 0 AND console = 'other'").get() as { n: number }).n;
