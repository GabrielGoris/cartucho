/**
 * Imagens e dados dos jogos a partir do LaunchBox Games Database (gamesdb.launchbox-app.com).
 * Adaptado do Harbour (MIT-0).
 *
 * O LaunchBox publica o banco inteiro num Metadata.zip (~100 MB). O Cartucho baixa no máximo uma vez por mês,
 * lê o XML uma vez como fluxo e guarda um índice pequeno em disco:
 *   media/_index/launchbox-index.json   nomes → ids, id → arquivos de imagem, por plataforma
 */
import { createReadStream, statSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { join } from 'node:path';
import { createInflateRaw } from 'node:zlib';
import type { Readable } from 'node:stream';

/** Console do Cartucho → plataforma no LaunchBox. */
export const PLATFORMS: Record<string, string> = {
  snes: 'Super Nintendo Entertainment System', n64: 'Nintendo 64', gc: 'Nintendo GameCube', wii: 'Nintendo Wii',
  switch: 'Nintendo Switch', switch2: 'Nintendo Switch 2', ps1: 'Sony Playstation', ps2: 'Sony Playstation 2', ps3: 'Sony Playstation 3',
  ps4: 'Sony Playstation 4', ps5: 'Sony Playstation 5', psp: 'Sony PSP', x360: 'Microsoft Xbox 360', pc: 'Windows',
  // "Outros": pela plataforma de origem que o Recompendium informa
  nes: 'Nintendo Entertainment System', xbox: 'Microsoft Xbox', wiiu: 'Nintendo Wii U', nds: 'Nintendo DS', '3ds': 'Nintendo 3DS',
  gb: 'Nintendo Game Boy', gbc: 'Nintendo Game Boy Color', gba: 'Nintendo Game Boy Advance', megadrive: 'Sega Genesis',
  dreamcast: 'Sega Dreamcast', saturn: 'Sega Saturn', mastersystem: 'Sega Master System', vita: 'Sony Playstation Vita', arcade: 'Arcade',
};

/** Tipos de imagem do LaunchBox que valem para cada tipo do Cartucho, em ordem de preferência. */
export const KINDS = {
  cover: ['Box - Front', 'Box - Front - Reconstructed'],
  logo: ['Clear Logo'],
  fanart: ['Fanart - Background'],
  screenshot: ['Screenshot - Gameplay'],
} as const;
export type ArtKind = keyof typeof KINDS;

const INDEX_VERSION = 1;
const REFRESH_AFTER = 30 * 86400_000;
const IMAGES_KEPT = 4;

/** Imagens da América do Norte / mundo primeiro, depois Europa, depois o resto. */
function regionScore(region: string) {
  if (!region) return 1;
  if (/North America|United States|Canada|World/.test(region)) return 0;
  if (/Europe|United Kingdom|Australia|Oceania/.test(region)) return 2;
  return 3;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (t: string) => t.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, n: string) =>
  n[0] !== '#' ? ENTITIES[n.toLowerCase()] ?? whole : String.fromCodePoint(n[1] === 'x' || n[1] === 'X' ? parseInt(n.slice(2), 16) : Number(n.slice(1))));
function tagText(record: string, tag: string) {
  const start = record.indexOf(`<${tag}>`);
  if (start < 0) return '';
  const from = start + tag.length + 2, end = record.indexOf(`</${tag}>`, from);
  return end < 0 ? '' : unescapeXml(record.slice(from, end)).trim();
}

/** Abre um arquivo de dentro de um zip como fluxo, pelo diretório central (sem ferramenta de unzip). */
export async function openZipEntry(zipFile: string, wanted: string): Promise<Readable> {
  const file = await fsp.open(zipFile, 'r');
  try {
    const { size } = await file.stat();
    const tailLength = Math.min(size, 0xffff + 22);
    const tail = Buffer.alloc(tailLength);
    await file.read(tail, 0, tailLength, size - tailLength);
    const end = tail.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'));
    if (end < 0) throw new Error('O banco do LaunchBox baixado não é um zip.');
    const dirSize = tail.readUInt32LE(end + 12), dirStart = tail.readUInt32LE(end + 16);
    const dir = Buffer.alloc(dirSize);
    await file.read(dir, 0, dirSize, dirStart);
    for (let at = 0; at + 46 <= dir.length && dir.readUInt32LE(at) === 0x02014b50;) {
      const nameLength = dir.readUInt16LE(at + 28), name = dir.toString('utf8', at + 46, at + 46 + nameLength);
      if (name === wanted) {
        const method = dir.readUInt16LE(at + 10), packed = dir.readUInt32LE(at + 20), localHeader = dir.readUInt32LE(at + 42);
        const local = Buffer.alloc(30);
        await file.read(local, 0, 30, localHeader);
        const dataStart = localHeader + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
        const raw = createReadStream(zipFile, { start: dataStart, end: dataStart + packed - 1 });
        if (method === 0) return raw;
        if (method === 8) return raw.pipe(createInflateRaw());
        throw new Error('O banco do LaunchBox usa uma compressão que o Cartucho não lê.');
      }
      at += 46 + nameLength + dir.readUInt16LE(at + 30) + dir.readUInt16LE(at + 32);
    }
    throw new Error(`O banco do LaunchBox não tem ${wanted}.`);
  } finally {
    await file.close();
  }
}

type Table<T> = Record<string, T>;
export interface LaunchBoxIndex { version: number; built: number; names: Table<Table<string[]>>; images: Table<Table<Partial<Record<ArtKind, string[]>>>> }

/** Lê o Metadata.xml uma vez, guardando só as plataformas e os tipos de imagem que interessam. */
export async function readDatabase(zipFile: string, key: (s: string) => string): Promise<LaunchBoxIndex> {
  const wanted = new Set(Object.values(PLATFORMS));
  const kindOf = new Map<string, { kind: ArtKind; rank: number }>();
  for (const [kind, types] of Object.entries(KINDS)) types.forEach((t, rank) => kindOf.set(t, { kind: kind as ArtKind, rank }));
  const table = <T>() => Object.create(null) as Table<T>;
  const names = table<Table<string[]>>(), raw = table<Table<Partial<Record<ArtKind, { f: string; s: number }[]>>>>();
  const platformOf = new Map<string, string>();
  const addName = (platform: string, name: string, id: string) => {
    const k = key(name); if (!k) return;
    const ids = ((names[platform] ??= table())[k] ??= []);
    if (!ids.includes(id)) ids.push(id);
  };

  const stream = await openZipEntry(zipFile, 'Metadata.xml');
  stream.setEncoding('utf8');
  const record = /<(Game|GameAlternateName|GameImage)>([\s\S]*?)<\/\1>/g;
  let pending = '';
  for await (const chunk of stream) {
    pending += chunk as string;
    record.lastIndex = 0;
    let used = 0;
    for (let m: RegExpExecArray | null; (m = record.exec(pending)); used = record.lastIndex) {
      const id = tagText(m[2]!, 'DatabaseID'); if (!id) continue;
      if (m[1] === 'Game') {
        const platform = tagText(m[2]!, 'Platform');
        if (!wanted.has(platform)) continue;
        platformOf.set(id, platform);
        addName(platform, tagText(m[2]!, 'Name'), id);
      } else if (m[1] === 'GameImage') {
        const platform = platformOf.get(id), type = kindOf.get(tagText(m[2]!, 'Type')), f = tagText(m[2]!, 'FileName');
        if (!platform || !type || !/^[\w.-]+\.(png|jpe?g)$/i.test(f)) continue;
        ((raw[platform] ??= table())[id] ??= {})[type.kind] ??= [];
        raw[platform]![id]![type.kind]!.push({ f, s: type.rank * 10 + regionScore(tagText(m[2]!, 'Region')) });
      } else if (platformOf.has(id)) addName(platformOf.get(id)!, tagText(m[2]!, 'AlternateName'), id);
    }
    pending = pending.slice(used);
    if (pending.length > 4e6) pending = pending.slice(-1e6);   // um registro quebrado não cresce sem fim
  }
  if (!platformOf.size) throw new Error('Nenhum jogo foi lido do banco do LaunchBox.');
  const images = table<Table<Partial<Record<ArtKind, string[]>>>>();
  for (const [p, byGame] of Object.entries(raw))
    for (const [id, kinds] of Object.entries(byGame))
      for (const [k, list] of Object.entries(kinds))
        ((images[p] ??= table())[id] ??= {})[k as ArtKind] = list!.sort((a, b) => a.s - b.s).slice(0, IMAGES_KEPT).map(i => i.f);
  return { version: INDEX_VERSION, built: Date.now(), names, images };
}

export interface LaunchBoxOpts {
  folder: string;                                  // media/_index
  key: (s: string) => string;
  download: (url: string, file: string, onBytes: (got: number, total: number) => void) => Promise<void>;
  onStatus?: (msg: string | null) => void;
  metadataUrl?: string;
  imageUrl?: string;
}

export function createLaunchBox({ folder, key, download, onStatus = () => {}, metadataUrl = 'https://gamesdb.launchbox-app.com/Metadata.zip', imageUrl = 'https://images.launchbox-app.com' }: LaunchBoxOpts) {
  const indexFile = join(folder, 'launchbox-index.json');
  let current: Promise<LaunchBoxIndex> | null = null, building: Promise<LaunchBoxIndex> | null = null;

  const readIndex = async () => {
    const i = JSON.parse(await fsp.readFile(indexFile, 'utf8')) as LaunchBoxIndex;
    if (i?.version !== INDEX_VERSION) throw new Error('índice de outra versão');
    return i;
  };
  const age = () => { try { return Date.now() - statSync(indexFile).mtimeMs; } catch { return Infinity; } };

  async function rebuild() {
    await fsp.mkdir(folder, { recursive: true });
    const zip = join(folder, 'launchbox-metadata.zip');
    onStatus('Baixando o banco de imagens do LaunchBox (uns 100 MB, uma vez por mês)…');
    let last = 0;
    await download(metadataUrl, zip, (got, total) => {
      if (Date.now() - last < 500) return; last = Date.now();
      const mb = (n: number) => (n / 1048576).toFixed(0);
      onStatus(`Baixando o banco de imagens do LaunchBox: ${mb(got)}${total ? ` de ${mb(total)}` : ''} MB…`);
    });
    onStatus('Lendo o banco de imagens do LaunchBox…');
    const index = await readDatabase(zip, key);
    await fsp.writeFile(indexFile + '.tmp', JSON.stringify(index));
    await fsp.rename(indexFile + '.tmp', indexFile);
    await fsp.unlink(zip).catch(() => {});
    onStatus(null);
    return index;
  }

  /** O índice. offline: só o que está em disco, nunca baixa. */
  function load({ offline = false, force = false } = {}): Promise<LaunchBoxIndex> {
    if (offline) return current ?? readIndex().then(i => (current ??= Promise.resolve(i)));
    const stale = force || age() >= REFRESH_AFTER;
    if (current && !stale) return current;
    if (building) return building;   // um download por vez, mesmo com muitas capas pedindo ao mesmo tempo
    const job = (stale ? Promise.reject(new Error('velho')) : readIndex()).catch(() => rebuild());
    current = building = job;
    job.catch(e => { onStatus(`Não deu para baixar o banco de imagens do LaunchBox: ${(e as Error).message}`); if (current === job) current = null; })
      .finally(() => { if (building === job) building = null; });
    return job;
  }

  /** URLs das imagens de um jogo e tipo, a melhor primeiro; [] quando o LaunchBox não conhece. */
  async function find(platformKey: string, names: string[], kind: ArtKind, opts: { offline?: boolean } = {}) {
    const platform = PLATFORMS[platformKey]; if (!platform) return [];
    const index = await load(opts);
    const byName = index.names[platform] ?? {}, byGame = index.images[platform] ?? {};
    const ids = [...new Set(names.map(key).filter(Boolean).flatMap(k => (Object.hasOwn(byName, k) ? byName[k]! : [])))];
    for (const id of ids) { const files = Object.hasOwn(byGame, id) ? byGame[id]![kind] : null; if (files?.length) return files.map(f => `${imageUrl}/${encodeURIComponent(f)}`); }
    return [];
  }

  return { find, load, building: () => !!building };
}
export type LaunchBox = ReturnType<typeof createLaunchBox>;
