/**
 * SQLite embutido do próprio Node (node:sqlite). Sem módulo nativo para compilar: o `npm install` não
 * precisa de Python nem Visual Studio, e o mesmo código roda no Electron e nos testes.
 */
import { DatabaseSync } from 'node:sqlite';

export type DB = DatabaseSync;

/** Roda `fn` numa transação (BEGIN/COMMIT, ROLLBACK se der erro). */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

/** Cada item roda uma vez, em ordem. Para mudar o esquema, acrescente um novo item no fim. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE catalog_game (
    id TEXT PRIMARY KEY,            -- "entry" do Recompendium
    title TEXT NOT NULL,
    repo TEXT,
    console TEXT NOT NULL,
    platform_name TEXT NOT NULL,
    status TEXT NOT NULL,
    version TEXT,
    date TEXT,
    stars INTEGER NOT NULL DEFAULT 0,
    year INTEGER,
    developer TEXT,
    needs TEXT,
    description TEXT,
    cover_url TEXT,
    retired INTEGER NOT NULL DEFAULT 0,
    first_seen_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX catalog_game_console ON catalog_game(console);

  CREATE TABLE radar_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    kind TEXT NOT NULL,             -- new | up | upd
    detail TEXT NOT NULL,
    at INTEGER NOT NULL
  );

  CREATE TABLE installed_game (
    id TEXT PRIMARY KEY,
    catalog_id TEXT,
    title TEXT NOT NULL,
    console TEXT NOT NULL,
    install_dir TEXT NOT NULL,
    exe TEXT,
    version TEXT,
    adapter TEXT,
    added_at INTEGER NOT NULL
  );

  CREATE TABLE play_session (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER
  );

  CREATE TABLE achievement_def (
    game_id TEXT NOT NULL,
    ach_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    points INTEGER,
    image BLOB,
    sort INTEGER NOT NULL,
    PRIMARY KEY (game_id, ach_id)
  );

  CREATE TABLE achievement_unlock (
    game_id TEXT NOT NULL,
    ach_id INTEGER NOT NULL,
    unlocked_at INTEGER,            -- data gravada pelo jogo, quando ele grava
    seen_at INTEGER NOT NULL,       -- quando o Cartucho percebeu
    PRIMARY KEY (game_id, ach_id)
  );
  `,
  // 2: projetos que o Recompendium lista sem link (ex.: jogos atuais de Switch 2) deixam de ficar escondidos.
  // Zera "retired" para eles não virarem "novos" no radar na próxima atualização; os retirados de verdade voltam a 1.
  `
  ALTER TABLE catalog_game ADD COLUMN no_link INTEGER NOT NULL DEFAULT 0;
  UPDATE catalog_game SET retired = 0;
  `,
  // 3: instalar/atualizar pelo GitHub e tempo de jogo
  `
  ALTER TABLE installed_game ADD COLUMN source_repo TEXT;          -- dono/projeto no GitHub, para atualizações
  ALTER TABLE installed_game ADD COLUMN release_json TEXT;         -- versão instalada: {tag, assetId, date, uploader}
  ALTER TABLE installed_game ADD COLUMN managed INTEGER NOT NULL DEFAULT 0;   -- 1 = instalado pelo Cartucho
  ALTER TABLE installed_game ADD COLUMN manifest_json TEXT;        -- arquivos que vieram no download (para desinstalar)
  CREATE INDEX play_session_game ON play_session(game_id, started_at);
  `,
  // 4: Xbox, NES, Game Boy, Mega Drive e DS ganharam lugar próprio: baixa o catálogo inteiro de novo para remapear
  `
  DELETE FROM kv WHERE key IN ('catalog.etag', 'catalog.lastModified');
  `,
];

export function openDb(file: string): DB {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let v = current; v < MIGRATIONS.length; v++) tx(db, () => { db.exec(MIGRATIONS[v]!); db.exec(`PRAGMA user_version = ${v + 1}`); });
  return db;
}

export const kvGet = (db: DB, key: string) => (db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
export const kvSet = (db: DB, key: string, value: string) => { db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value); };
