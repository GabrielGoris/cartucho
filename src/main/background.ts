import { join } from 'node:path';
import { app, Menu, nativeImage, shell, Tray } from 'electron';
import { kvGet, kvSet, type DB } from './db';
import type { Player } from './play';
import type { AchievementService } from './achievements/service';
import type { WinCtl } from './window';

export interface BgPrefs { tray: boolean; track: boolean; autostart: boolean }

export const startHidden = (argv: string[]) => argv.includes('--hidden');
export const playArg = (argv: string[]) => { const i = argv.indexOf('--play'); return i >= 0 ? argv[i + 1] ?? null : null; };

export class Background {
  private tray: Tray | null = null;
  quitting = false;

  constructor(private db: DB, private ctl: () => WinCtl | null, private player: Player, private games: AchievementService, private icon: string) {
    app.on('before-quit', () => { this.quitting = true; });
  }

  prefs(): BgPrefs {
    const b = (k: string, d: boolean) => { const v = kvGet(this.db, k); return v == null ? d : v === '1'; };
    return { tray: b('bg.tray', true), track: b('bg.track', true), autostart: process.platform === 'win32' && app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin };
  }

  set(p: Partial<BgPrefs>) {
    if (p.tray != null) kvSet(this.db, 'bg.tray', p.tray ? '1' : '0');
    if (p.track != null) kvSet(this.db, 'bg.track', p.track ? '1' : '0');
    if (p.autostart != null && process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: p.autostart, args: ['--hidden'] });
    this.apply();
    return this.prefs();
  }

  apply() {
    const p = this.prefs();
    this.player.watchExternal(p.track);
    if (p.tray && !this.tray) this.makeTray();
    else if (!p.tray && this.tray) { this.tray.destroy(); this.tray = null; }
  }

  shouldHideOnClose() { return !this.quitting && this.prefs().tray; }

  show() { this.ctl()?.reveal(); }

  async handleArgs(argv: string[]) {
    const id = playArg(argv);
    if (!id) return false;
    try { await this.player.play(id); } catch (e) { console.warn('[atalho]', e instanceof Error ? e.message : e); this.show(); }
    return true;
  }

  shortcut(id: string) {
    if (process.platform !== 'win32') throw new Error('Atalhos só no Windows por enquanto.');
    const g = this.games.getGame(id);
    const name = g.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim() || 'Jogo';
    const file = join(app.getPath('desktop'), `${name}.lnk`);
    const args = `${app.isPackaged ? '' : `"${app.getAppPath()}" `}--play ${id}`;
    const ok = shell.writeShortcutLink(file, { target: process.execPath, args, description: `${g.title} pelo Cartucho`, ...(g.exe ? { icon: g.exe, iconIndex: 0 } : {}) });
    if (!ok) throw new Error('Não consegui criar o atalho na Área de Trabalho.');
    return file;
  }

  private makeTray() {
    const img = nativeImage.createFromPath(this.icon).resize({ width: 16, height: 16 });
    this.tray = new Tray(img);
    this.tray.setToolTip('Cartucho');
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Abrir o Cartucho', click: () => this.show() },
      { type: 'separator' },
      { label: 'Sair', click: () => { this.quitting = true; app.quit(); } },
    ]));
    this.tray.on('click', () => this.show());
  }
}
