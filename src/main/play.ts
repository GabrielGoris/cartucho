import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { basename, dirname, normalize } from 'node:path';
import type { PlayEvent, PlayStats } from '@shared/types';
import type { DB } from './db';
import type { AchievementService } from './achievements/service';
import { emulatorFor } from './emulators';

export class Player {
  readonly events = new EventEmitter<{ play: [PlayEvent] }>();
  private running = new Map<string, Run>();
  private external = new Map<string, { pid: number; session: number; start: number }>();
  private scanTimer: NodeJS.Timeout | null = null;
  private scanning = false;

  constructor(private db: DB, private games: AchievementService, private openPath: (p: string) => Promise<string>, private onExit: () => void = () => {}, private procs: () => Promise<Proc[]> = processTable) {
    db.prepare('UPDATE play_session SET ended_at = started_at WHERE ended_at IS NULL').run();
  }

  private emu = new Map<number, { title: string; gameId: string | null; session: number; start: number }>();
  private resolveEmu: ((exe: string, title: string) => Promise<string | null>) | null = null;
  setEmulatorResolver(f: (exe: string, title: string) => Promise<string | null>) { this.resolveEmu = f; }

  isRunning = (id: string) => this.running.has(id) || this.external.has(id) || [...this.emu.values()].some(e => e.gameId === id);

  private async env() {
    if (process.platform !== 'win32') return process.env;
    const out = await run('tasklist', ['/FI', 'IMAGENAME eq steam.exe', '/NH']).catch(() => '');
    return out.toLowerCase().includes('steam.exe') ? { ...process.env, SDL_JOYSTICK_HIDAPI_STEAM: '0' } : process.env;
  }

  async play(gameId: string) {
    const g = this.games.getGame(gameId);
    if (this.running.has(gameId)) throw new Error(`${g.title} já está aberto.`);
    if (!g.exe) throw new Error('Ainda não sei qual programa abre este jogo. Use "Escolher o .exe".');
    if (!existsSync(g.exe)) throw new Error(`${basename(g.exe)} não está mais lá. O jogo foi movido ou apagado?`);

    const isProgram = process.platform === 'win32' ? /\.exe$/i.test(g.exe) : true;
    if (!isProgram) {
      const err = await this.openPath(g.exe);
      if (err) throw new Error(`Não consegui abrir ${basename(g.exe)}: ${err}`);
      const now = Date.now();
      this.db.prepare('INSERT INTO play_session (game_id, started_at, ended_at) VALUES (?, ?, ?)').run(gameId, now, now);
      this.events.emit('play', { gameId, title: g.title, running: false, sessionMs: 0 });
      return;
    }

    const env = await this.env();
    const denied = await new Promise<boolean>((ok, fail) => {
      const child = spawn(g.exe!, [], { cwd: dirname(g.exe!), env, detached: true, stdio: 'ignore' });
      child.once('error', e => {
        if ((e as NodeJS.ErrnoException).code === 'EACCES' && process.platform === 'win32') ok(true);
        else fail(new Error(`Não consegui abrir o jogo: ${e.message}`));
      });
      child.once('spawn', () => {
        const start = Date.now();
        const session = Number(this.db.prepare('INSERT INTO play_session (game_id, started_at) VALUES (?, ?)').run(gameId, start).lastInsertRowid);
        this.running.set(gameId, { child, session, start });
        child.unref();
        this.events.emit('play', { gameId, title: g.title, running: true });
        child.once('exit', () => this.finish(gameId, child));
        ok(false);
      });
    });
    if (denied) await this.playElevated(gameId, g.title, g.exe, g.installDir);
  }

  private async playElevated(gameId: string, title: string, exe: string, installDir: string) {
    const q = (x: string) => `'${x.replace(/'/g, "''")}'`;
    try {
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath ${q(exe)} -WorkingDirectory ${q(dirname(exe))}`], 180_000);
    } catch {
      throw new Error(`O Windows não deixou abrir ${basename(exe)}. Se o jogo pede permissão de administrador, aceite o aviso do Windows; se o aviso não apareceu, veja se o antivírus bloqueou o arquivo.`);
    }
    const start = Date.now();
    const session = Number(this.db.prepare('INSERT INTO play_session (game_id, started_at) VALUES (?, ?)').run(gameId, start).lastInsertRowid);
    const r: Run = { child: null, session, start };
    r.follow = { pids: new Set(), dirs: [...new Set([installDir, dirname(exe)])], names: [basename(exe)], exitAt: start, seenAt: 0, misses: 0, timer: null, tries: 8 };
    this.running.set(gameId, r);
    this.events.emit('play', { gameId, title, running: true });
    this.followTick(gameId, r);
  }

  private finish(gameId: string, child: ChildProcess) {
    const r = this.running.get(gameId);
    if (!r || r.child !== child || r.follow) return;
    const now = Date.now();
    if (now - r.start < FOLLOW.window && child.pid) {
      let dirs: string[] = [];
      try { const g = this.games.getGame(gameId); dirs = [...new Set([g.installDir, dirname(g.exe ?? g.installDir)])]; } catch { }
      r.follow = { pids: new Set([child.pid]), dirs, names: [], exitAt: now, seenAt: 0, misses: 0, timer: null };
      this.followTick(gameId, r);
      return;
    }
    this.end(gameId, r, now);
  }

  private followTick(gameId: string, r: Run) {
    const f = r.follow!;
    f.timer = setTimeout(() => {
      void this.procs().then(table => {
        if (this.running.get(gameId) !== r) return;
        const alive = followAlive(table, f.pids, f.dirs, f.names);
        if (alive.length) { f.pids = new Set(alive); f.seenAt = Date.now(); f.misses = 0; return this.followTick(gameId, r); }
        if (f.seenAt) return this.end(gameId, r, Date.now());
        if (++f.misses >= (f.tries ?? FOLLOW.tries)) return this.end(gameId, r, f.exitAt);
        this.followTick(gameId, r);
      }, () => { if (this.running.get(gameId) === r) this.end(gameId, r, Date.now()); });
    }, FOLLOW.every);
  }

  private end(gameId: string, r: Run, end: number) {
    if (this.running.get(gameId) !== r) return;
    if (r.follow?.timer) clearTimeout(r.follow.timer);
    this.running.delete(gameId);
    this.db.prepare('UPDATE play_session SET ended_at = ? WHERE id = ?').run(end, r.session);
    let title = ''; try { title = this.games.getGame(gameId).title; } catch {  }
    this.events.emit('play', { gameId, title, running: false, sessionMs: end - r.start });
    this.onExit();
  }

  watchExternal(on: boolean) {
    if (process.platform !== 'win32') return;
    if (on && !this.scanTimer) { this.scanTimer = setInterval(() => void this.scan(), 5000); void this.scan(); }
    else if (!on && this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null; this.endExternal(); for (const pid of [...this.emu.keys()]) this.endEmu(pid); }
  }

  private async scan() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const procs = await listProcesses();
      const seen = new Set<string>();
      for (const g of this.games.listGames()) {
        if (!g.exe || !/\.exe$/i.test(g.exe) || this.running.has(g.id) || emulatorFor(g.exe)) continue;
        const pids = procs.get(basename(g.exe).toLowerCase());
        if (!pids?.length) continue;
        const cur = this.external.get(g.id);
        if (cur && pids.includes(cur.pid)) { seen.add(g.id); continue; }
        const paths = await processPaths(pids);
        const want = normalize(g.exe).toLowerCase();
        const pid = pids.find(p => paths.get(p) === want);
        if (pid == null) continue;
        seen.add(g.id);
        if (cur) { cur.pid = pid; continue; }
        const start = Date.now();
        const session = Number(this.db.prepare('INSERT INTO play_session (game_id, started_at) VALUES (?, ?)').run(g.id, start).lastInsertRowid);
        this.external.set(g.id, { pid, session, start });
        this.events.emit('play', { gameId: g.id, title: g.title, running: true });
      }
      for (const id of [...this.external.keys()]) if (!seen.has(id)) this.endExternal(id);
      await this.scanEmulators(procs);
    } catch { } finally { this.scanning = false; }
  }

  private async scanEmulators(procs: Map<string, number[]>) {
    const list = [...procs.entries()].filter(([n]) => emulatorFor(n)).flatMap(([, pids]) => pids);
    const launched = new Set([...this.running.values()].map(r => r.child?.pid).filter((p): p is number => !!p));
    const live = new Set<number>();
    if (list.length && this.resolveEmu) {
      const wins = await windowTitles(list);
      for (const pid of list) {
        const w = wins.get(pid);
        if (!w || launched.has(pid)) continue;
        live.add(pid);
        const cur = this.emu.get(pid);
        if (cur && cur.title === w.title) continue;
        const gameId = w.title ? await this.resolveEmu(w.path, w.title) : null;
        if (cur && cur.gameId === gameId) { cur.title = w.title; continue; }
        if (cur) this.endEmu(pid);
        if (gameId && !this.running.has(gameId) && !this.external.has(gameId) && ![...this.emu.values()].some(e => e.gameId === gameId)) {
          const start = Date.now();
          const session = Number(this.db.prepare('INSERT INTO play_session (game_id, started_at) VALUES (?, ?)').run(gameId, start).lastInsertRowid);
          this.emu.set(pid, { title: w.title, gameId, session, start });
          let title = ''; try { title = this.games.getGame(gameId).title; } catch { }
          this.events.emit('play', { gameId, title, running: true });
        } else this.emu.set(pid, { title: w.title, gameId: null, session: 0, start: 0 });
      }
    }
    for (const pid of [...this.emu.keys()]) if (!live.has(pid)) this.endEmu(pid);
  }

  private endEmu(pid: number) {
    const r = this.emu.get(pid); if (!r) return;
    this.emu.delete(pid);
    if (!r.gameId) return;
    const end = Date.now();
    this.db.prepare('UPDATE play_session SET ended_at = ? WHERE id = ?').run(end, r.session);
    let title = ''; try { title = this.games.getGame(r.gameId).title; } catch { }
    this.events.emit('play', { gameId: r.gameId, title, running: false, sessionMs: end - r.start });
  }

  private endExternal(only?: string) {
    const end = Date.now();
    for (const [id, r] of [...this.external]) {
      if (only && id !== only) continue;
      this.external.delete(id);
      this.db.prepare('UPDATE play_session SET ended_at = ? WHERE id = ?').run(end, r.session);
      let title = ''; try { title = this.games.getGame(id).title; } catch { }
      this.events.emit('play', { gameId: id, title, running: false, sessionMs: end - r.start });
    }
  }

  quit(gameId: string) {
    const em = [...this.emu.entries()].find(([, e]) => e.gameId === gameId);
    if (em) { killTree(em[0]); return true; }
    const ext = this.external.get(gameId);
    if (ext) { try { spawn('taskkill', ['/pid', String(ext.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); } catch { } return true; }
    const r = this.running.get(gameId);
    if (r?.follow) {
      for (const pid of r.follow.pids) killTree(pid);
      return true;
    }
    const child = r?.child;
    if (!child?.pid) return false;
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
      else process.kill(-child.pid, 'SIGTERM');
    } catch { try { child.kill(); } catch {  } }
    return true;
  }

  stop() {
    const now = Date.now();
    for (const r of this.running.values()) if (r.follow?.timer) clearTimeout(r.follow.timer);
    for (const r of this.running.values()) this.db.prepare('UPDATE play_session SET ended_at = ? WHERE id = ?').run(now, r.session);
    this.running.clear();
    if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null; }
    for (const r of this.external.values()) this.db.prepare('UPDATE play_session SET ended_at = ? WHERE id = ?').run(now, r.session);
    this.external.clear();
    for (const r of this.emu.values()) if (r.gameId) this.db.prepare('UPDATE play_session SET ended_at = ? WHERE id = ?').run(now, r.session);
    this.emu.clear();
  }

  stats(gameId?: string): PlayStats {
    const where = gameId ? 'WHERE game_id = ?' : '', args = gameId ? [gameId] : [];
    const sum = this.db.prepare(`SELECT COALESCE(SUM(COALESCE(ended_at, ?) - started_at), 0) ms, COUNT(*) n, MAX(started_at) last FROM play_session ${where}`)
      .get(Date.now(), ...args) as { ms: number; n: number; last: number | null };
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const from = today.getTime() - 13 * 86400_000;
    const days = Array(14).fill(0) as number[];
    const rows = this.db.prepare(`SELECT started_at s, COALESCE(ended_at, ?) e FROM play_session ${where ? where + ' AND' : 'WHERE'} COALESCE(ended_at, ?) > ?`)
      .all(Date.now(), ...args, Date.now(), from) as { s: number; e: number }[];
    for (const { s, e } of rows) {
      for (let d = 0; d < 14; d++) {
        const a = from + d * 86400_000, b = a + 86400_000, ov = Math.min(e, b) - Math.max(s, a);
        if (ov > 0) days[d]! += ov / 3600_000;
      }
    }
    return { totalMs: sum.ms, sessions: sum.n, lastPlayed: sum.last, days };
  }
}

interface Run {
  child: ChildProcess | null; session: number; start: number;
  follow?: { pids: Set<number>; dirs: string[]; names: string[]; exitAt: number; seenAt: number; misses: number; timer: NodeJS.Timeout | null; tries?: number };
}
export const FOLLOW = { window: 90_000, every: 4000, tries: 4 };

export interface Proc { pid: number; ppid: number; path: string; name?: string }

export function followAlive(table: Proc[], pids: Set<number>, dirs: string[], names: string[] = []) {
  const key = (x: string) => x.replace(/[\\/]+/g, '/').toLowerCase();
  const wanted = new Set(names.map(n => n.toLowerCase()));
  const roots = dirs.filter(Boolean).map(d => key(d).replace(/\/$/, '') + '/');
  const tracked = new Set(pids), alive = new Set<number>();
  for (let grew = true; grew;) {
    grew = false;
    for (const p of table) {
      if (alive.has(p.pid) || p.pid === process.pid) continue;
      const inDir = !!p.path && roots.some(r => key(p.path).startsWith(r));
      const named = !!p.name && wanted.has(p.name.toLowerCase());
      if (tracked.has(p.pid) || tracked.has(p.ppid) || inDir || named) { alive.add(p.pid); if (!tracked.has(p.pid)) { tracked.add(p.pid); grew = true; } }
    }
  }
  return [...alive];
}

export function parseProcTable(out: string): Proc[] {
  const L: Proc[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^(\d+)\|(\d+)\|([^|]*)(?:\|(.*))?$/);
    if (m) L.push({ pid: Number(m[1]), ppid: Number(m[2]), path: m[3]!.trim(), ...(m[4] !== undefined ? { name: m[4].trim() } : {}) });
  }
  return L;
}

async function processTable(): Promise<Proc[]> {
  if (process.platform === 'win32') {
    return parseProcTable(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_UTF8 + 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$($_.ExecutablePath)|$($_.Name)" }']));
  }
  const L: Proc[] = [];
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const st = readFileSync(`/proc/${d}/stat`, 'utf8'), ppid = Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1]);
      let path = '', name = ''; try { path = readlinkSync(`/proc/${d}/exe`); } catch { }
      try { name = readFileSync(`/proc/${d}/comm`, 'utf8').trim(); } catch { }
      L.push({ pid: Number(d), ppid, path, name });
    } catch { }
  }
  return L;
}

function killTree(pid: number) {
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    else process.kill(pid, 'SIGTERM');
  } catch { }
}

const PS_UTF8 = '[Console]::OutputEncoding = [Text.Encoding]::UTF8; ';

export function parseWindows(out: string) {
  const m = new Map<number, { path: string; title: string }>();
  for (const line of out.split(/\r?\n/)) {
    const f = line.match(/^(\d+)\|([^|]*)\|(.*)$/);
    if (f) m.set(Number(f[1]), { path: f[2]!.trim(), title: f[3]!.trim() });
  }
  return m;
}

async function windowTitles(pids: number[]) {
  const ids = pids.filter(p => Number.isInteger(p) && p > 0).slice(0, 32);
  if (!ids.length) return new Map<number, { path: string; title: string }>();
  return parseWindows(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `${PS_UTF8}Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id)|$($_.Path)|$($_.MainWindowTitle)" }`]));
}

const run = (cmd: string, args: string[], timeout = 8000) => new Promise<string>((ok, fail) => {
  execFile(cmd, args, { windowsHide: true, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 }, (err, out) => (err ? fail(err) : ok(out)));
});

export function parseTasklist(csv: string) {
  const m = new Map<string, number[]>();
  for (const line of csv.split(/\r?\n/)) {
    const f = line.match(/^"([^"]*)","(\d+)"/);
    if (!f) continue;
    const k = f[1]!.toLowerCase();
    m.set(k, [...(m.get(k) ?? []), Number(f[2])]);
  }
  return m;
}

async function listProcesses() {
  return parseTasklist(await run('tasklist', ['/fo', 'csv', '/nh']));
}

async function processPaths(pids: number[]) {
  const m = new Map<number, string>();
  const ids = pids.filter(p => Number.isInteger(p) && p > 0).slice(0, 32);
  if (!ids.length) return m;
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `${PS_UTF8}Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id)|$($_.Path)" }`]);
  for (const line of out.split(/\r?\n/)) {
    const i = line.indexOf('|'); if (i < 0) continue;
    const path = line.slice(i + 1).trim();
    if (path) m.set(Number(line.slice(0, i)), normalize(path).toLowerCase());
  }
  return m;
}
