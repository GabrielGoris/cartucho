import { EventEmitter } from 'node:events';
import { app } from 'electron';
import electronUpdater from 'electron-updater';

export type UpdStatus = 'dev' | 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error';
export interface UpdState { status: UpdStatus; current: string; version: string | null; pct: number; error: string | null; checkedAt: number | null }

const SIX_HOURS = 6 * 3600_000;

export class Updater {
  readonly events = new EventEmitter();
  private s: UpdState = { status: app.isPackaged ? 'idle' : 'dev', current: app.getVersion(), version: null, pct: 0, error: null, checkedAt: null };

  constructor(private beforeInstall: () => void) {
    if (!app.isPackaged) return;
    const u = electronUpdater.autoUpdater;
    u.autoDownload = true;
    u.autoInstallOnAppQuit = true;
    u.on('checking-for-update', () => this.set({ status: 'checking', error: null }));
    u.on('update-not-available', () => this.set({ status: 'none', checkedAt: Date.now() }));
    u.on('update-available', i => this.set({ status: 'downloading', version: i.version, pct: 0, checkedAt: Date.now() }));
    u.on('download-progress', p => this.set({ status: 'downloading', pct: Math.round(p.percent) }));
    u.on('update-downloaded', i => this.set({ status: 'ready', version: i.version, pct: 100 }));
    u.on('error', e => this.set({ status: 'error', error: e?.message ?? String(e) }));
    setTimeout(() => void this.check(), 15_000);
    setInterval(() => void this.check(), SIX_HOURS);
  }

  state() { return this.s; }

  private set(p: Partial<UpdState>) { this.s = { ...this.s, ...p }; this.events.emit('state', this.s); }

  async check() {
    if (!app.isPackaged || this.s.status === 'downloading' || this.s.status === 'ready') return this.s;
    try { await electronUpdater.autoUpdater.checkForUpdates(); } catch (e) { this.set({ status: 'error', error: e instanceof Error ? e.message : String(e) }); }
    return this.s;
  }

  install() {
    if (this.s.status !== 'ready') return false;
    this.beforeInstall();
    setImmediate(() => electronUpdater.autoUpdater.quitAndInstall(false, true));
    return true;
  }
}
