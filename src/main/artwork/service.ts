/**
 * Capas, fundos e logos em boa resolução, guardados em userData/media e servidos para a tela por media://.
 * Fonte: LaunchBox Games Database (sem conta nem chave). Quando ele não tem o jogo, a tela usa a capa do Recompendium.
 */
import { EventEmitter } from 'node:events';
import { createWriteStream, existsSync, readdirSync, statSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Fetch } from '../ports/github';
import { type ArtKind, KINDS, PLATFORMS, createLaunchBox } from './launchbox';

export type ArtSet = Partial<Record<ArtKind, string>>;

const FORMAT_TAG = /(\.(xiso|iso|cso|chd|rvz|wbfs|nsp|xci|z64|n64|v64|nds|3ds|gba|gbc|gb|sfc|smc|nes))+$/i;
const cleanTitle = (n: string) => n.replace(FORMAT_TAG, '').replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/_/g, ' ').replace(/^\d{3,5}\s*-?\s+(?=\S)/, '').replace(/\s+/g, ' ').trim() || n;
/** Chave solta para comparar nomes: sem acento, sem artigo, sem pontuação ("The Legend of Zelda: X (2026)" → "legendofzeldax"). */
export const looseKey = (s: string) => cleanTitle(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&|\band\b|\bthe\b/g, '').replace(/[^a-z0-9]/g, '');

/** Plataforma de origem dos jogos em "Outros", pelo nome que o Recompendium dá. */
const OTHER: [RegExp, string][] = [
  [/mega ?drive|genesis/i, 'megadrive'], [/dreamcast/i, 'dreamcast'], [/wii ?u/i, 'wiiu'], [/3ds/i, '3ds'], [/nintendo ds\b/i, 'nds'],
  [/game ?boy advance/i, 'gba'], [/game ?boy color/i, 'gbc'], [/game ?boy/i, 'gb'], [/\bnes\b|famicom/i, 'nes'], [/^xbox$/i, 'xbox'],
  [/saturn/i, 'saturn'], [/master system/i, 'mastersystem'], [/vita/i, 'vita'], [/arcade/i, 'arcade'],
];
export const artPlatform = (console: string, platformName?: string | null) =>
  console !== 'other' ? console : OTHER.find(([re]) => re.test(platformName ?? ''))?.[1] ?? null;

const MAX_IMAGE = 20 * 1048576;
const NOT_FOUND_RETRY = 14 * 86400_000;   // jogo que o LaunchBox não tinha: tenta de novo depois de 2 semanas
const isImage = (b: Buffer) => (b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0xff && b[1] === 0xd8) || b.subarray(8, 12).toString('latin1') === 'WEBP';
const extOf = (b: Buffer) => (b[0] === 0x89 ? 'png' : b[0] === 0xff ? 'jpg' : 'webp');

export class Artwork {
  readonly events = new EventEmitter<{ changed: []; status: [string | null] }>();
  status: string | null = null;
  private lb;
  private queue: (() => Promise<void>)[] = [];
  private running = 0;
  private pending = new Set<string>();

  constructor(private dir: string, private fetch: Fetch, opts: { metadataUrl?: string; imageUrl?: string } = {}) {
    this.lb = createLaunchBox({
      folder: join(dir, '_index'), key: looseKey, ...opts,
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

  private folder(platform: string, kind: ArtKind) { return join(this.dir, platform, kind); }

  /** Arquivo já baixado (nome sem extensão = chave do título). */
  private existing(platform: string, kind: ArtKind, key: string) {
    const f = this.folder(platform, kind);
    if (!existsSync(f)) return null;
    for (const ext of ['png', 'jpg', 'webp']) if (existsSync(join(f, `${key}.${ext}`))) return `${key}.${ext}`;
    return null;
  }
  private missingRecently(platform: string, kind: ArtKind, key: string) {
    try { return Date.now() - statSync(join(this.folder(platform, kind), `${key}.none`)).mtimeMs < NOT_FOUND_RETRY; } catch { return false; }
  }

  /** As imagens que já estão em disco; as que faltam são buscadas em segundo plano (avisa com "changed"). */
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

  private enqueue(platform: string, kind: ArtKind, key: string, names: string[]) {
    const id = `${platform}/${kind}/${key}`;
    if (this.pending.has(id)) return;
    this.pending.add(id);
    this.queue.push(async () => {
      try {
        const urls = await this.lb.find(platform, names, kind);
        const folder = this.folder(platform, kind);
        await fsp.mkdir(folder, { recursive: true });
        for (const url of urls) {
          const b = await this.image(url);
          if (b) { await fsp.writeFile(join(folder, `${key}.${extOf(b)}`), b); this.changed(); return; }
        }
        await fsp.writeFile(join(folder, `${key}.none`), '');   // o LaunchBox não tem: não pergunta de novo tão cedo
      } catch { /* sem rede ou banco ainda não baixado: tenta na próxima vez que a tela pedir */ }
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
  private async image(url: string): Promise<Buffer | null> {
    const r = await this.fetch(url, { headers: { 'User-Agent': 'Cartucho' }, signal: AbortSignal.timeout(20_000) });
    if (r.status === 404 || !r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    return b.length && b.length <= MAX_IMAGE && isImage(b) ? b : null;
  }
  private timer: NodeJS.Timeout | undefined;
  private changed() { clearTimeout(this.timer); this.timer = setTimeout(() => this.events.emit('changed'), 300); }

  /** Baixa o banco do LaunchBox de novo agora e esquece os "não encontrados". */
  async refresh() {
    for (const p of existsSync(this.dir) ? readdirSync(this.dir) : []) for (const k of Object.keys(KINDS)) {
      const f = this.folder(p, k as ArtKind);
      if (existsSync(f)) for (const n of readdirSync(f)) if (n.endsWith('.none')) await fsp.unlink(join(f, n)).catch(() => {});
    }
    await this.lb.load({ force: true });
    this.changed();
  }

  /** Caminho em disco de um media://art/... (para o protocolo), ou null se sair da pasta. */
  resolve(rel: string) {
    const parts = rel.split('/').filter(Boolean);
    if (parts.length !== 3 || parts.some(p => p === '..' || /[\\:]/.test(p))) return null;
    return join(this.dir, ...parts);
  }
}
