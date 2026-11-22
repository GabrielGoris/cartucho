import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { BrowserWindow, desktopCapturer, ipcMain, Notification, screen } from 'electron';
import { type Key, keyMapFor } from '@shared/padmap';

export interface PadState { index: number; id: string; mapping: string; b: string }
export type Action = 'summon' | 'shot';

const PAD_PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent"><script>
const { ipcRenderer } = require('electron');
let last = '';
setInterval(() => {
  const s = [...navigator.getGamepads()].filter(Boolean).map(p => ({ index: p.index, id: p.id, mapping: p.mapping, b: p.buttons.map(x => (x.pressed || x.value > 0.5 ? 1 : 0)).join('') }));
  const k = JSON.stringify(s);
  if (k !== last) { last = k; ipcRenderer.send('cartucho:pads', s); }
}, 40);
</script>`;

export function padKeys(p: PadState): Set<Key> {
  const map = keyMapFor(p, false), down = new Set<Key>();
  [...p.b].forEach((v, i) => { if (v === '1' && map[i]) down.add(map[i]!); });
  return down;
}

export class Combos {
  private down = new Map<number, Set<Key>>();

  feed(index: number, now: Set<Key>): Action[] {
    const before = this.down.get(index) ?? now, out: Action[] = [];
    this.down.set(index, now);
    const pair = (k: Set<Key>) => k.has('Select') && k.has('Start');
    if (now.has('Home') && !before.has('Home')) out.push('summon');
    if (pair(now) && !pair(before)) out.push('shot');
    return out;
  }

  clear() { this.down.clear(); }
}

export const safeName = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '') || 'Jogo';
const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};

export class InGame {
  readonly events = new EventEmitter<{ summon: []; shot: [{ title: string; file: string }] }>();
  private pad: BrowserWindow | null = null;
  private combos = new Combos();
  private busy = false;

  constructor(private root: string, private current: () => { id: string; title: string } | null, private reveal: () => void, private icon?: string) {
    ipcMain.on('cartucho:pads', (_e, list: PadState[]) => this.onPads(list));
  }

  setActive(on: boolean) {
    if (on && !this.pad) {
      const d = screen.getPrimaryDisplay().workArea;
      this.pad = new BrowserWindow({
        width: 1, height: 1, x: d.x + d.width - 1, y: d.y + d.height - 1, frame: false, transparent: true, resizable: false, movable: false,
        focusable: false, skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: false,
        webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false },
      });
      this.pad.setIgnoreMouseEvents(true);
      this.pad.webContents.on('will-navigate', e => e.preventDefault());
      void this.pad.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAD_PAGE)}`);
      this.pad.once('ready-to-show', () => this.pad?.showInactive());
      this.pad.on('closed', () => { this.pad = null; });
    } else if (!on && this.pad) {
      this.pad.destroy();
      this.pad = null;
      this.combos.clear();
    }
  }

  onPads(list: PadState[]) {
    for (const p of list) this.run(this.combos.feed(p.index, padKeys(p)));
  }

  private run(actions: Action[]) {
    for (const a of actions) {
      if (a === 'summon') this.summon();
      else void this.capture();
    }
  }

  summon() {
    this.reveal();
    this.events.emit('summon');
  }

  folder(title: string) { return join(this.root, safeName(title)); }

  async capture() {
    const g = this.current();
    if (!g || this.busy) return null;
    this.busy = true;
    try {
      const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
      const src = sources.find(s => s.display_id === String(d.id)) ?? sources[0];
      if (!src || src.thumbnail.isEmpty()) throw new Error('nada para capturar');
      const dir = this.folder(g.title);
      mkdirSync(dir, { recursive: true });
      const base = stamp();
      let file = join(dir, `${base}.png`);
      for (let n = 2; existsSync(file); n++) file = join(dir, `${base} (${n}).png`);
      writeFileSync(file, src.thumbnail.toPNG());
      if (Notification.isSupported()) new Notification({ title: 'Captura salva', body: g.title, silent: true, ...(this.icon ? { icon: this.icon } : {}) }).show();
      this.events.emit('shot', { title: g.title, file });
      return file;
    } catch {
      if (Notification.isSupported()) new Notification({ title: 'Não deu para capturar a tela', body: g.title, silent: true }).show();
      return null;
    } finally { this.busy = false; }
  }

  list(title: string) {
    const dir = this.folder(title);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter(f => /\.(png|jpe?g)$/i.test(f))
      .map(f => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)
      .map(x => `media://shots/${encodeURIComponent(safeName(title))}/${encodeURIComponent(x.f)}`);
  }

  resolve(rel: string) {
    const full = resolve(this.root, ...rel.split('/').filter(Boolean).map(decodeURIComponent));
    const r = relative(this.root, full);
    return r && !r.startsWith('..') && !r.includes(`..${sep}`) ? full : null;
  }
}
