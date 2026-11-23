import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { BrowserWindow, desktopCapturer, type Display, ipcMain, type NativeImage, screen, shell } from 'electron';
import { type Key, keyMapFor } from '@shared/padmap';
import { moveTo, ownedBy, type Rect, type Win32 } from './win32';
import { tt } from '@shared/i18n';

export interface PadState { index: number; id: string; mapping: string; b: string }
export type Action = 'summon' | 'shot';
export const HOLD = 1500;

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
  private held = new Map<number, number>();

  feed(index: number, now: Set<Key>, at = Date.now()): Action[] {
    const before = this.down.get(index) ?? now, out: Action[] = [];
    this.down.set(index, now);
    const pair = (k: Set<Key>) => k.has('Select') && k.has('Start');
    if (now.has('Home') && !before.has('Home')) this.held.set(index, at);
    if (!now.has('Home')) this.held.delete(index);
    if (pair(now) && !pair(before)) out.push('shot');
    return [...out, ...this.tick(at)];
  }

  tick(at = Date.now()): Action[] {
    for (const [i, since] of this.held) {
      if (since >= 0 && at - since >= HOLD) { this.held.set(i, -1); return ['summon']; }
    }
    return [];
  }

  next(at = Date.now()) {
    const w = [...this.held.values()].filter(s => s >= 0).map(s => Math.max(0, s + HOLD - at));
    return w.length ? Math.min(...w) : null;
  }

  clear() { this.down.clear(); this.held.clear(); }
}

export const safeName = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '') || 'Jogo';
const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};
const sameRect = (a: Rect, b: Rect) => a.every((v, i) => v === b[i]);
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const toastPage = (thumb: string, title: string, label: string) => `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden;font-family:"Segoe UI",system-ui,sans-serif}
.t{position:absolute;inset:8px;display:flex;align-items:center;gap:14px;padding:10px 18px 10px 10px;border-radius:14px;background:rgba(14,8,26,.94);border:1px solid rgba(255,79,168,.6);box-shadow:0 10px 30px rgba(0,0,0,.5);color:#fff;animation:in .28s cubic-bezier(.2,.9,.3,1.2),out .3s ease-in 2.4s forwards}
img{height:76px;border-radius:8px;flex:none}
b{display:block;font-size:17px;color:#ff4fa8}
span{display:block;font-size:14px;opacity:.85;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}
@keyframes in{from{transform:translateY(30px);opacity:0}}
@keyframes out{to{transform:translateY(20px);opacity:0}}
</style><div class="t"><img src="data:image/jpeg;base64,${thumb}"><div><b>📷 ${esc(label)}</b><span>${esc(title)}</span></div></div><script>
try {
  const a = new AudioContext(), n = a.sampleRate * .09, buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
  const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  f.type = 'highpass'; f.frequency.value = 1800; g.gain.value = .5;
  s.buffer = buf; s.connect(f); f.connect(g); g.connect(a.destination); s.start();
  const o = a.createOscillator(), og = a.createGain(); o.frequency.value = 2400; og.gain.setValueAtTime(.12, a.currentTime + .06); og.gain.exponentialRampToValueAtTime(.001, a.currentTime + .14);
  o.connect(og); og.connect(a.destination); o.start(a.currentTime + .06); o.stop(a.currentTime + .15);
} catch {}
</script>`;

export interface InGameDeps {
  root: string;
  w32: Win32;
  current: () => { id: string; title: string } | null;
  reveal: () => void;
  minimize: () => void;
  own: () => number | null;
  visible: () => boolean;
  sameScreen: () => boolean;
  dirsOf: (id: string) => string[];
}

export class InGame {
  readonly events = new EventEmitter<{ summon: []; shot: [{ title: string; file: string }] }>();
  private pad: BrowserWindow | null = null;
  private combos = new Combos();
  private busy = false;
  private timer: NodeJS.Timeout | null = null;
  private game: number | null = null;
  private follow = 0;

  constructor(private d: InGameDeps) {
    ipcMain.on('cartucho:pads', (_e, list: PadState[]) => this.onPads(list));
  }

  get root() { return this.d.root; }

  setActive(on: boolean) {
    if (on && !this.pad) {
      this.d.w32.warm();
      const a = screen.getPrimaryDisplay().workArea;
      this.pad = new BrowserWindow({
        width: 1, height: 1, x: a.x + a.width - 1, y: a.y + a.height - 1, frame: false, transparent: true, resizable: false, movable: false,
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
      this.game = null;
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    }
  }

  onPads(list: PadState[]) {
    for (const p of list) this.run(this.combos.feed(p.index, padKeys(p)));
    this.schedule();
  }

  private schedule() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const n = this.combos.next();
    if (n != null) this.timer = setTimeout(() => { this.timer = null; this.run(this.combos.tick()); this.schedule(); }, n + 5);
  }

  private run(actions: Action[]) {
    for (const a of actions) {
      if (a === 'summon') void this.summon();
      else void this.capture();
    }
  }

  async summon() {
    const fg = await this.d.w32.foreground();
    if (fg && fg.pid !== process.pid) this.game = fg.hwnd;
    this.d.reveal();
    this.events.emit('summon');
  }

  private async gameWindow() {
    if (this.game) return this.game;
    const g = this.d.current(); if (!g) return null;
    const dirs = this.d.dirsOf(g.id);
    const w = (await this.d.w32.windows())?.find(x => x.pid !== process.pid && ownedBy(x, new Set(), dirs));
    return w?.hwnd ?? null;
  }

  async back() {
    const h = await this.gameWindow(), own = this.d.own();
    let same = true;
    if (h && own) {
      const [a, b] = await Promise.all([this.d.w32.monitor(h), this.d.w32.monitor(own)]);
      if (a && b) same = sameRect(a.m, b.m);
    }
    if (h) await this.d.w32.front(h);
    if (same || !h) this.d.minimize();
  }

  async place(dirs: string[], pid?: number) {
    const token = ++this.follow;
    if (!this.d.sameScreen() || screen.getAllDisplays().length < 2 || !this.d.visible()) return;
    const own = this.d.own(); if (!own) return;
    const target = await this.d.w32.monitor(own); if (!target) return;
    const pids = new Set(pid ? [pid] : []), moved = new Map<number, number>(), end = Date.now() + 45_000;
    const tick = async () => {
      if (token !== this.follow) return;
      for (const w of (await this.d.w32.windows()) ?? []) {
        if (w.pid === process.pid || !ownedBy(w, pids, dirs)) continue;
        const r = moveTo(w, target), n = moved.get(w.hwnd) ?? 0;
        if (!r || n >= 2) continue;
        moved.set(w.hwnd, n + 1);
        await this.d.w32.place(w.hwnd, r);
      }
      if (Date.now() < end) setTimeout(() => void tick(), 1000);
    };
    setTimeout(() => void tick(), 600);
  }

  folder(title: string) { return join(this.d.root, safeName(title)); }

  private async display(): Promise<Display> {
    const fg = await this.d.w32.foreground();
    if (fg) {
      try {
        const [l, tp, r, b] = fg.m;
        return screen.getDisplayMatching(screen.screenToDipRect(null, { x: l, y: tp, width: r - l, height: b - tp }));
      } catch { }
    }
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  }

  async capture() {
    const g = this.d.current();
    if (!g || this.busy) return null;
    this.busy = true;
    try {
      const d = await this.display();
      const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
      const src = sources.find(s => s.display_id === String(d.id)) ?? (sources.length === 1 ? sources[0] : undefined);
      if (!src || src.thumbnail.isEmpty()) throw new Error(tt('nada para capturar'));
      const dir = this.folder(g.title);
      mkdirSync(dir, { recursive: true });
      const base = stamp();
      let file = join(dir, `${base}.png`);
      for (let n = 2; existsSync(file); n++) file = join(dir, `${base} (${n}).png`);
      writeFileSync(file, src.thumbnail.toPNG());
      this.toast(d, src.thumbnail, g.title, tt('Captura salva'));
      this.events.emit('shot', { title: g.title, file });
      return file;
    } catch {
      return null;
    } finally { this.busy = false; }
  }

  private toast(d: Display, img: NativeImage, title: string, label: string) {
    const W = 460, H = 112, a = d.workArea;
    const w = new BrowserWindow({
      width: W, height: H, x: Math.round(a.x + (a.width - W) / 2), y: a.y + a.height - H - 48, frame: false, transparent: true, resizable: false, movable: false,
      focusable: false, skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: false,
      webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setIgnoreMouseEvents(true);
    w.webContents.on('will-navigate', e => e.preventDefault());
    const thumb = img.resize({ height: 152 }).toJPEG(80).toString('base64');
    void w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(toastPage(thumb, title, label))}`);
    w.once('ready-to-show', () => { if (!w.isDestroyed()) w.showInactive(); });
    setTimeout(() => { if (!w.isDestroyed()) w.destroy(); }, 3000);
  }

  list(title: string) {
    const dir = this.folder(title);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter(f => /\.(png|jpe?g)$/i.test(f))
      .map(f => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)
      .map(x => `media://shots/${encodeURIComponent(safeName(title))}/${encodeURIComponent(x.f)}`);
  }

  async remove(url: string) {
    const m = url.match(/^media:\/\/shots(\/.+)$/);
    const file = m ? this.resolve(m[1]!) : null;
    if (!file || !/\.(png|jpe?g)$/i.test(file) || !existsSync(file)) return false;
    try { await shell.trashItem(file); } catch { unlinkSync(file); }
    return true;
  }

  resolve(rel: string) {
    const full = resolve(this.d.root, ...rel.split('/').filter(Boolean).map(decodeURIComponent));
    const r = relative(this.d.root, full);
    return r && !r.startsWith('..') && !r.includes(`..${sep}`) ? full : null;
  }
}
