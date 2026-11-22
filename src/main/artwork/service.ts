import { EventEmitter } from 'node:events';
import { createWriteStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Fetch } from '../ports/github';
import { type ArtKind, KINDS, type LaunchBoxInfo, PLATFORMS, createLaunchBox } from './launchbox';

export type ArtSet = Partial<Record<ArtKind, string>>;

const FORMAT_TAG = /(\.(xiso|iso|cso|chd|rvz|wbfs|nsp|xci|z64|n64|v64|nds|3ds|gba|gbc|gb|sfc|smc|nes))+$/i;
export const cleanTitle = (n: string) => n.replace(FORMAT_TAG, '').replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/_/g, ' ').replace(/^\d{3,5}\s*-?\s+(?=\S)/, '').replace(/\s+/g, ' ').trim() || n;
export const looseKey = (s: string) => cleanTitle(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&|\band\b|\bthe\b/g, '').replace(/[^a-z0-9]/g, '');

const OTHER: [RegExp, string][] = [
  [/mega ?drive|genesis/i, 'megadrive'], [/dreamcast/i, 'dreamcast'], [/wii ?u/i, 'wiiu'], [/3ds/i, '3ds'], [/nintendo ds\b/i, 'nds'],
  [/game ?boy advance/i, 'gba'], [/game ?boy color/i, 'gbc'], [/game ?boy/i, 'gb'], [/\bnes\b|famicom/i, 'nes'], [/^xbox$/i, 'xbox'],
  [/saturn/i, 'saturn'], [/master system/i, 'mastersystem'], [/vita/i, 'vita'], [/arcade/i, 'arcade'],
];
const BY_NAME = new Set(['other', 'gb', 'megadrive']);
export const artPlatform = (console: string, platformName?: string | null) =>
  !BY_NAME.has(console) ? console : OTHER.find(([re]) => re.test(platformName ?? ''))?.[1] ?? (console !== 'other' ? console : platformName?.trim() ? null : 'pc');

const MAX_IMAGE = 20 * 1048576;
const NONE_VERSION = '2';
type SteamArt = Record<ArtKind, string[]>;
const NOT_FOUND_RETRY = 14 * 86400_000;
const isImage = (b: Buffer) => (b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0xff && b[1] === 0xd8) || b.subarray(8, 12).toString('latin1') === 'WEBP';
const extOf = (b: Buffer) => (b[0] === 0x89 ? 'png' : b[0] === 0xff ? 'jpg' : 'webp');

export class Artwork {
  readonly events = new EventEmitter<{ changed: []; status: [string | null] }>();
  status: string | null = null;
  private lb;
  private queue: (() => Promise<void>)[] = [];
  private running = 0;
  private pending = new Set<string>();

  private steamCache = new Map<string, Promise<SteamArt | null>>();
  private steam: { store: string; api: string; cdn: string };

  constructor(private dir: string, private fetch: Fetch, opts: { metadataUrl?: string; imageUrl?: string; steamStore?: string; steamApi?: string; steamCdn?: string } = {}) {
    const { steamStore, steamApi, steamCdn, ...lbOpts } = opts;
    this.steam = { store: steamStore ?? 'https://store.steampowered.com', api: steamApi ?? 'https://api.steampowered.com', cdn: steamCdn ?? 'https://shared.akamai.steamstatic.com/store_item_assets/' };
    this.lb = createLaunchBox({
      folder: join(dir, '_index'), key: looseKey, ...lbOpts,
      download: (url, file, onBytes) => this.download(url, file, onBytes),
      onStatus: s => { this.status = s; this.events.emit('status', s); },
    });
  }

  private async download(url: string, file: string, onBytes: (g: number, t: number) => void) {
    const r = await this.fetch(url, { headers: { 'User-Agent': 'Cartucho' }, signal: AbortSignal.timeout(20 * 60_000) });
    if (!r.ok || !r.body) throw new Error(`erro ${r.status}`);
    const total = Number(r.headers.get('content-length')) || 0;
    if (total > 600 * 1048576) throw new Error('arquivo grande demais');
    let got = 0;
    const part = file + '.part';
    try {
      await pipeline(Readable.fromWeb(r.body as import('node:stream/web').ReadableStream), async function* (src) { for await (const c of src) { got += (c as Buffer).length; onBytes(got, total); yield c; } }, createWriteStream(part));
      await fsp.rename(part, file);
    } catch (e) { await fsp.unlink(part).catch(() => {}); throw e; }
  }

  async info(console: string, platformName: string | null | undefined, names: string[], offline = false): Promise<LaunchBoxInfo | null> {
    const platform = artPlatform(console, platformName);
    if (!platform || !PLATFORMS[platform]) return null;
    return this.lb.info(platform, names, { offline }).catch(() => null);
  }

  knows(console: string, names: string[]) {
    if (!PLATFORMS[console] || this.lb.building()) return Promise.resolve(false);
    return this.lb.has(console, names).catch(() => false);
  }

  indexReady() { return this.lb.building() ? Promise.resolve(false) : this.lb.load({ offline: true }).then(() => true, () => false); }

  notify() { this.changed(); }

  private folder(platform: string, kind: ArtKind) { return join(this.dir, platform, kind); }

  private existing(platform: string, kind: ArtKind, key: string) {
    const f = this.folder(platform, kind);
    if (!existsSync(f)) return null;
    for (const ext of ['png', 'jpg', 'webp']) if (existsSync(join(f, `${key}.${ext}`))) return `${key}.${ext}`;
    return null;
  }
  private missingRecently(platform: string, kind: ArtKind, key: string) {
    const f = join(this.folder(platform, kind), `${key}.none`);
    try { return Date.now() - statSync(f).mtimeMs < NOT_FOUND_RETRY && readFileSync(f, 'utf8') === NONE_VERSION; } catch { return false; }
  }

  get(console: string, platformName: string | null | undefined, names: string[], kinds: ArtKind[] = ['cover', 'fanart', 'logo']): ArtSet {
    const platform = artPlatform(console, platformName);
    const key = looseKey(names[0] ?? '');
    if (!platform || !PLATFORMS[platform] || !key) return {};
    const out: ArtSet = {};
    for (const kind of kinds) {
      const f = this.existing(platform, kind, key);
      if (f) out[kind] = `media://art/${platform}/${kind}/${f}`;
      else if (!this.missingRecently(platform, kind, key)) this.enqueue(platform, kind, key, names);
    }
    return out;
  }

  shots(console: string, platformName: string | null | undefined, names: string[]): string[] {
    const platform = artPlatform(console, platformName);
    const key = looseKey(names[0] ?? '');
    if (!platform || !PLATFORMS[platform] || !key) return [];
    const folder = this.folder(platform, 'screenshot');
    const files = existsSync(folder) ? readdirSync(folder).filter(f => f.startsWith(`${key}-`) && /^\d+\.(png|jpg|webp)$/.test(f.slice(key.length + 1))).sort() : [];
    if (files.length) return files.map(f => `media://art/${platform}/screenshot/${f}`);
    let recent = false;
    try { recent = Date.now() - statSync(join(folder, `${key}.shots`)).mtimeMs < NOT_FOUND_RETRY; } catch { recent = false; }
    if (!recent) this.enqueueShots(platform, key, names);
    return [];
  }

  private enqueueShots(platform: string, key: string, names: string[]) {
    const id = `${platform}/shots/${key}`;
    if (this.pending.has(id)) return;
    this.pending.add(id);
    this.queue.push(async () => {
      try {
        const urls = (await this.lb.find(platform, names, 'screenshot')).slice(0, 4);
        const folder = this.folder(platform, 'screenshot');
        await fsp.mkdir(folder, { recursive: true });
        let n = 0;
        for (const url of urls) {
          const b = await this.image(url).catch(() => null);
          if (b) await fsp.writeFile(join(folder, `${key}-${n++}.${extOf(b)}`), b);
        }
        await fsp.writeFile(join(folder, `${key}.shots`), String(n));
        if (n) this.changed();
      } catch { } finally { this.pending.delete(id); }
    });
    this.pump();
  }

  private enqueue(platform: string, kind: ArtKind, key: string, names: string[]) {
    const id = `${platform}/${kind}/${key}`;
    if (this.pending.has(id)) return;
    this.pending.add(id);
    this.queue.push(async () => {
      try {
        let urls = await this.lb.find(platform, names, kind);
        if (!urls.length && platform === 'pc') urls = (await this.steamArt(names))?.[kind] ?? [];
        const folder = this.folder(platform, kind);
        await fsp.mkdir(folder, { recursive: true });
        for (const url of urls) {
          const b = await this.image(url);
          if (b) { await fsp.writeFile(join(folder, `${key}.${extOf(b)}`), b); this.changed(); return; }
        }
        await fsp.writeFile(join(folder, `${key}.none`), NONE_VERSION);
      } catch { }
      finally { this.pending.delete(id); }
    });
    this.pump();
  }
  private pump() {
    while (this.running < 4 && this.queue.length) {
      const job = this.queue.shift()!;
      this.running++;
      void job().finally(() => { this.running--; this.pump(); });
    }
  }
  private steamArt(names: string[]): Promise<SteamArt | null> {
    const key = looseKey(names[0] ?? '');
    let p = this.steamCache.get(key);
    if (!p) { p = this.findSteamArt(names).catch(() => null); this.steamCache.set(key, p); }
    return p;
  }

  private async findSteamArt(names: string[]): Promise<SteamArt | null> {
    const keys = new Set(names.map(looseKey).filter(Boolean));
    const get = async <T>(url: string) => {
      const r = await this.fetch(url, { headers: { 'User-Agent': 'Cartucho' }, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`erro ${r.status}`);
      return (await r.json()) as T;
    };
    const found = await get<{ items?: { type?: string; id?: number; name?: string }[] }>(`${this.steam.store}/api/storesearch/?term=${encodeURIComponent(cleanTitle(names[0] ?? ''))}&l=english&cc=US`);
    const app = (found.items ?? []).find(x => x.type === 'app' && x.id && keys.has(looseKey(x.name ?? '')));
    if (!app) return null;
    const input = { ids: [{ appid: app.id }], context: { language: 'english', country_code: 'US' }, data_request: { include_assets: true } };
    const d = await get<{ response?: { store_items?: { assets?: Record<string, string> }[] } }>(`${this.steam.api}/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`);
    const a = d.response?.store_items?.[0]?.assets;
    const fmt = a?.asset_url_format;
    if (!a || !fmt) return null;
    const url = (f?: string) => (f ? [`${this.steam.cdn}${fmt.replace('${FILENAME}', f)}`] : []);
    return {
      cover: [...url(a.library_capsule_2x), ...url(a.library_capsule)],
      fanart: url(a.library_hero),
      logo: url(a.library_logo),
      screenshot: [],
    };
  }

  private async image(url: string): Promise<Buffer | null> {
    const r = await this.fetch(url, { headers: { 'User-Agent': 'Cartucho' }, signal: AbortSignal.timeout(20_000) });
    if (r.status === 404 || !r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    return b.length && b.length <= MAX_IMAGE && isImage(b) ? b : null;
  }
  private timer: NodeJS.Timeout | undefined;
  private changed() { clearTimeout(this.timer); this.timer = setTimeout(() => this.events.emit('changed'), 300); }

  async refresh() {
    for (const p of existsSync(this.dir) ? readdirSync(this.dir) : []) for (const k of Object.keys(KINDS)) {
      const f = this.folder(p, k as ArtKind);
      if (existsSync(f)) for (const n of readdirSync(f)) if (n.endsWith('.none') || n.endsWith('.shots')) await fsp.unlink(join(f, n)).catch(() => {});
    }
    await this.lb.load({ force: true });
    this.changed();
  }

  resolve(rel: string) {
    const parts = rel.split('/').filter(Boolean);
    if (parts.length !== 3 || parts.some(p => p === '..' || /[\\:]/.test(p))) return null;
    return join(this.dir, ...parts);
  }
}
