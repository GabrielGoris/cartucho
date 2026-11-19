/**
 * Jogar e contar o tempo, como na Steam: cada jogo aberto pelo Cartucho é acompanhado até o processo
 * fechar, e cada sessão fica guardada (início e fim). Atalhos (.lnk, .url, .bat) abrem pelo sistema e
 * não têm processo para acompanhar: contam só como "jogado agora".
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { PlayEvent, PlayStats } from '@shared/types';
import type { DB } from './db';
import type { AchievementService } from './achievements/service';

export class Player {
  readonly events = new EventEmitter<{ play: [PlayEvent] }>();
  private running = new Map<string, { child: ChildProcess; session: number; start: number }>();

  constructor(private db: DB, private games: AchievementService, private openPath: (p: string) => Promise<string>, private onExit: () => void = () => {}) {
    // Sessões que ficaram abertas (o Cartucho fechou com o jogo rodando): fecham no último sinal de vida conhecido.
    db.prepare('UPDATE play_session SET ended_at = started_at WHERE ended_at IS NULL').run();
  }

  isRunning = (id: string) => this.running.has(id);

  /** Enquanto a Steam está aberta ela cuida do Steam Controller; o SDL dos jogos não deve disputar com ela. */
  private env() {
    if (process.platform !== 'win32') return process.env;
    const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq steam.exe', '/NH'], { windowsHide: true, encoding: 'utf8' });
    return (r.stdout || '').toLowerCase().includes('steam.exe') ? { ...process.env, SDL_JOYSTICK_HIDAPI_STEAM: '0' } : process.env;
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

    await new Promise<void>((ok, fail) => {
      const child = spawn(g.exe!, [], { cwd: dirname(g.exe!), env: this.env(), detached: true, stdio: 'ignore' });
      child.once('error', e => fail(new Error(`Não consegui abrir o jogo: ${e.message}`)));
      child.once('spawn', () => {
        const start = Date.now();
        const session = Number(this.db.prepare('INSERT INTO play_session (game_id, started_at) VALUES (?, ?)').run(gameId, start).lastInsertRowid);
        this.running.set(gameId, { child, session, start });
        child.unref();
        this.events.emit('play', { gameId, title: g.title, running: true });
        child.once('exit', () => this.finish(gameId, child));
        ok();
      });
    });
  }

  private finish(gameId: string, child: ChildProcess) {
    const r = this.running.get(gameId);
    if (!r || r.child !== child) return;
    this.running.delete(gameId);
    const end = Date.now();
    this.db.prepare('UPDATE play_session SET ended_at = ? WHERE id = ?').run(end, r.session);
    let title = ''; try { title = this.games.getGame(gameId).title; } catch { /* removido */ }
    this.events.emit('play', { gameId, title, running: false, sessionMs: end - r.start });
    this.onExit();
  }

  /** Fecha o jogo (e o que ele abriu). */
  quit(gameId: string) {
    const r = this.running.get(gameId);
    if (!r?.child.pid) return false;
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(r.child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
      else process.kill(-r.child.pid, 'SIGTERM');
    } catch { try { r.child.kill(); } catch { /* já fechou */ } }
    return true;
  }

  /** O Cartucho vai fechar: as sessões em andamento terminam agora (o jogo continua aberto). */
  stop() {
    const now = Date.now();
    for (const r of this.running.values()) this.db.prepare('UPDATE play_session SET ended_at = ? WHERE id = ?').run(now, r.session);
    this.running.clear();
  }

  /** Tempo total, sessões e horas por dia nos últimos 14 dias (de um jogo, ou de todos). */
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
      // reparte a sessão pelos dias que ela atravessa
      for (let d = 0; d < 14; d++) {
        const a = from + d * 86400_000, b = a + 86400_000, ov = Math.min(e, b) - Math.max(s, a);
        if (ov > 0) days[d]! += ov / 3600_000;
      }
    }
    return { totalMs: sum.ms, sessions: sum.n, lastPlayed: sum.last, days };
  }
}
