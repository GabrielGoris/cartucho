/**
 * Baixar, conferir, desempacotar e copiar uma versão para a pasta do jogo. Adaptado do Harbour (MIT-0).
 *
 * Segurança do download: o hash publicado pelo GitHub é conferido quando existe, o Windows Defender
 * examina o arquivo antes de desempacotar, e uma atualização só entra se veio da mesma conta que publicou
 * a versão instalada.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readdirSync, statSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Fetch, Release } from './github';

export interface Progress { stage: string; pct: number; done?: boolean; error?: string }
type Send = (p: Progress) => void;

export const ARCHIVE = /\.(zip|7z|rar|tar|tgz|tar\.(gz|xz|zst|bz2))$/i;
/** Programas que não são o jogo. */
export const HELPER_EXE = /unins|setup|install|crash|report|redist|vcredist|dxsetup|updater|update|ffmpeg|ffprobe|7z|helper|cli\.exe$|dotnet|vc_|createdump/i;
/** Arquivos de configuração e saves: uma atualização nunca escreve por cima deles. */
export const KEEP_FILES = /\.(ini|toml|cfg|conf|ya?ml|sav|save)$/i;

export class NotReadyToRun extends Error {}

function run(cmd: string, args: string[]) {
  return new Promise<void>((ok, fail) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', d => (err += d));
    p.on('error', fail);
    p.on('close', c => (c === 0 ? ok() : fail(new Error(`Não consegui desempacotar: ${err.trim() || 'código ' + c}`))));
  });
}
/** O Windows já vem com o bsdtar (tar.exe), que abre zip e 7z. No Linux, tentamos as ferramentas comuns. */
export async function extract(archive: string, dest: string) {
  if (process.platform === 'win32') return run(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', archive, '-C', dest]);
  const tries: [string, string[]][] = [['bsdtar', ['-xf', archive, '-C', dest]]];
  if (/\.zip$/i.test(archive)) tries.push(['unzip', ['-o', '-q', archive, '-d', dest]], ['7z', ['x', '-y', `-o${dest}`, archive]]);
  else if (/\.7z$/i.test(archive)) tries.push(['7z', ['x', '-y', `-o${dest}`, archive]]);
  else tries.push(['tar', ['-xf', archive, '-C', dest]]);
  for (const [cmd, args] of tries) {
    try { return await run(cmd, args); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  throw new Error(`Não consegui abrir ${basename(archive)}: instale o bsdtar ou o ${/\.zip$/i.test(archive) ? 'unzip' : '7-Zip'}.`);
}

export async function sha256File(file: string) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest('hex');
}

/** Windows Defender examina o download antes de qualquer coisa ser desempacotada. Sem Defender, o exame é pulado. */
export function defenderScan(file: string): Promise<'clean' | 'skipped'> {
  const exe = join(process.env.ProgramFiles || 'C:\\Program Files', 'Windows Defender', 'MpCmdRun.exe');
  if (process.platform !== 'win32' || !existsSync(exe)) return Promise.resolve('skipped');
  return new Promise((ok, fail) => {
    const p = spawn(exe, ['-Scan', '-ScanType', '3', '-File', file, '-DisableRemediation'], { windowsHide: true });
    let out = '';
    p.stdout.on('data', d => (out += d));
    p.on('error', () => ok('skipped'));
    p.on('close', code => {
      if (code === 0) return ok('clean');
      if (code === 2 || (/threat/i.test(out) && !/no threats/i.test(out))) return fail(new Error('O Windows Defender acusou o download. Nada foi instalado.'));
      ok('skipped');
    });
  });
}

/** Baixa o arquivo da versão para `tmp`, confere o hash e passa no Defender. */
export async function fetchRelease(rel: Release, tmp: string, send: Send, fetch: Fetch, token: string | null) {
  const archive = join(tmp, basename(rel.assetName));
  let r = await fetch(rel.url, { headers: { 'User-Agent': 'Cartucho' } });
  // Projeto privado: o download precisa do login do gh, pelo endereço da API (o redirecionamento para o arquivo não leva o token).
  if (r.status === 404 && rel.api?.startsWith('https://api.github.com/') && token)
    r = await fetch(rel.api, { headers: { 'User-Agent': 'Cartucho', Accept: 'application/octet-stream', Authorization: `Bearer ${token}` } });
  if (!r.ok || !r.body) throw new Error(`O download falhou (erro ${r.status}). Tente mais tarde.`);
  const total = Number(r.headers.get('content-length')) || rel.size || 0;
  let got = 0, last = 0;
  await pipeline(Readable.fromWeb(r.body as import('node:stream/web').ReadableStream), async function* (src) {
    for await (const chunk of src) {
      got += (chunk as Buffer).length;
      if (Date.now() - last > 150) { last = Date.now(); send({ stage: `Baixando ${rel.assetName}`, pct: total ? got / total : 0 }); }
      yield chunk;
    }
  }, createWriteStream(archive));
  send({ stage: 'Conferindo o download…', pct: 1 });
  if (rel.digest && /^sha256:/i.test(rel.digest)) {
    if (rel.digest.slice(7).toLowerCase() !== await sha256File(archive)) throw new Error('O download não bate com o hash publicado no GitHub. Nada foi instalado.');
  }
  send({ stage: 'Windows Defender examinando…', pct: 1 });
  const scan = await defenderScan(archive);
  return { archive, scan };
}

/** Desempacota numa pasta de trabalho; se o pacote tem uma pasta só por dentro, devolve ela. */
export async function unpackRelease(rel: Release, archive: string, tmp: string, send: Send) {
  const stage = join(tmp, 'x');
  await fsp.mkdir(stage);
  if (ARCHIVE.test(rel.assetName)) { send({ stage: 'Desempacotando…', pct: 1 }); await extract(archive, stage); }
  else await fsp.rename(archive, join(stage, basename(rel.assetName)));
  const top = readdirSync(stage, { withFileTypes: true });
  return top.length === 1 && top[0]!.isDirectory() ? join(stage, top[0]!.name) : stage;
}

/** O .exe do jogo numa pasta: o único na raiz, ou o único em até dois níveis. */
export function findGameExe(folder: string): string | null {
  const found: { p: string; depth: number }[] = [];
  const walk = (dir: string, depth: number) => {
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory() && depth < 2 && !/^(_cartucho-backup|_harbour-backup|disc|data|saves?|mods|cache|shaders?)$/i.test(e.name)) walk(p, depth + 1);
      else if (e.isFile() && /\.exe$/i.test(e.name) && !HELPER_EXE.test(e.name)) found.push({ p, depth });
    }
  };
  walk(folder, 0);
  const top = found.filter(f => f.depth === 0);
  return (top.length === 1 ? top : found.length === 1 ? found : []).map(f => f.p)[0] ?? null;
}

/** Quando há vários .exe: o que tem o nome do projeto, depois o maior. */
export function guessProgram(dir: string, repo: string | null): string | null {
  const files: string[] = [], stack = [dir];
  while (stack.length) {
    const d = stack.shift()!;
    for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) stack.push(p); else files.push(p); }
  }
  const win = process.platform === 'win32';
  const hint = String(repo || '').split('/').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '');
  const candidates = files.filter(f => {
    const n = basename(f).toLowerCase();
    if (/unins|uninstall|update|crash|redist|vc_?redist|setup|installer|helper|elevate|dxwebsetup/.test(n)) return false;
    return win ? n.endsWith('.exe') : n.endsWith('.exe') || n.endsWith('.appimage') || !/\.\w+$/.test(n);
  });
  const rank = (f: string) => {
    const n = basename(f).toLowerCase().replace(/[^a-z0-9]/g, '');
    let v = statSync(f).size / 1e9;
    if (hint && (n.includes(hint) || hint.includes(n.replace(/exe$|appimage$/, '')))) v += 10;
    if (/qt|gui/.test(n)) v += 1;
    if (/cli|cmd|test|bench/.test(n)) v -= 2;
    return v;
  };
  return candidates.sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

/** Onde os arquivos de uma versão nova entram: alinha o .exe de dentro do pacote com o que você usa. */
export function placeRelease(src: string, exe: string | null): string | null {
  if (!exe) return null;
  const want = basename(exe).toLowerCase(), found: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (r.split('/').length < 6) walk(join(dir, e.name), r); }
      else if (e.name.toLowerCase() === want) found.push(r);
    }
  };
  walk(src, '');
  const same = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
  for (const rel of found.sort((a, b) => a.split('/').length - b.split('/').length)) {
    const parts = rel.split('/');
    let root = dirname(exe);
    for (let i = 1; i < parts.length; i++) root = dirname(root);
    if (same(join(root, ...parts), exe) && existsSync(root)) return root;
  }
  return null;
}

async function copyUpdate(src: string, dest: string, backup: string, kept: string[]) {
  for (const e of await fsp.readdir(src, { withFileTypes: true })) {
    const from = join(src, e.name), to = join(dest, e.name), bak = join(backup, e.name);
    if (e.isDirectory()) { await fsp.mkdir(to, { recursive: true }); await copyUpdate(from, to, bak, kept); continue; }
    if (existsSync(to)) {
      if (KEEP_FILES.test(e.name)) { kept.push(to); continue; }
      await fsp.mkdir(backup, { recursive: true });
      await fsp.copyFile(to, bak);
    }
    await fsp.copyFile(from, to);
  }
}

/**
 * Atualização: copia os arquivos novos por cima. Os substituídos vão para _cartucho-backup\<versão antiga>,
 * configurações ficam, e só as duas cópias de segurança mais novas são mantidas.
 */
export async function installInto(folder: string, src: string, oldTag: string | null, send: Send) {
  send({ stage: 'Instalando…', pct: 1 });
  const root = join(folder, '_cartucho-backup');
  const backup = join(root, (oldTag || 'antes-' + new Date().toISOString().slice(0, 10)).replace(/[^\w.-]+/g, '_'));
  const kept: string[] = [];
  try { await copyUpdate(src, folder, backup, kept); }
  catch (e) { if (/EBUSY|EPERM|EACCES/.test((e as NodeJS.ErrnoException).code || '')) throw new Error('Um arquivo está em uso ou protegido. Feche o jogo e tente de novo.'); throw e; }
  try {
    const old = readdirSync(root).map(n => ({ p: join(root, n), t: statSync(join(root, n)).mtimeMs })).sort((a, b) => b.t - a.t).slice(2);
    for (const o of old) await fsp.rm(o.p, { recursive: true, force: true });
  } catch { /* sem cópias antigas */ }
  return { kept, backup: existsSync(backup) ? backup : null };
}

/** Todos os arquivos de uma pasta, com caminho relativo (barra normal). */
export async function filesIn(dir: string, base = dir, out: string[] = []) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await filesIn(p, base, out); else out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
}

/** Lista do que veio no download (nome → tamanho), para desinstalar sem apagar arquivos seus. */
export async function manifestOf(dir: string) {
  const out: Record<string, number> = {};
  for (const rel of await filesIn(dir)) { try { out[rel.toLowerCase()] = (await fsp.stat(join(dir, rel))).size; } catch { /* sumiu */ } }
  return out;
}

/** Apaga o que a instalação pôs (arquivos alterados depois são seus e ficam) e as pastas que ficarem vazias. */
export async function removeInstalled(folder: string, manifest: Record<string, number>) {
  let removed = 0, left = 0;
  for (const rel of await filesIn(folder)) {
    const file = join(folder, rel);
    let size: number; try { size = (await fsp.stat(file)).size; } catch { continue; }
    if (manifest[rel.toLowerCase()] === size) { await fsp.unlink(file); removed++; } else left++;
  }
  const prune = async (dir: string) => {
    for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) if (e.isDirectory()) await prune(join(dir, e.name));
    if (!(await fsp.readdir(dir).catch(() => ['x'])).length) await fsp.rmdir(dir).catch(() => {});
  };
  await prune(folder);
  return { removed, left };
}

/** O programa (pelo nome do arquivo) está aberto agora? Só no Windows; nos outros, supõe que não. */
export function isRunning(exe: string | null) {
  if (process.platform !== 'win32' || !exe) return false;
  const r = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${basename(exe)}`, '/NH'], { windowsHide: true, encoding: 'utf8' });
  return (r.stdout || '').toLowerCase().includes(basename(exe).toLowerCase());
}
