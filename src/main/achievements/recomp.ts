import { existsSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { Adapter, AdapterContext } from './adapters';
import { readHedgeAch, type Unlock } from './saves';
import { achId } from './steam';
import { tt } from '@shared/i18n';

/**
 * Conquistas e troféus que os próprios recomps guardam (cada projeto do seu jeito).
 * Procura os nomes de arquivo mais usados na pasta do jogo e na pasta do usuário que o recomp cria
 * em AppData, e reconhece o formato pelo conteúdo: ACH-DATA (hedge-dev), linhas de texto, JSON, JSON por linha e INI.
 */
const NAMES = new Set(['ach-data', 'trophies.txt', 'trophies.jsonl', 'trophies.json', 'achievements.txt', 'achievements.json', 'achievements.ini', 'port_achievements.txt']);
const SKIP = /^(steam_settings|node_modules|\.git|shaders?|cache|assets?|data|content|media|music|movies?|video|sound|audio|textures?|game|patched|decrypted|dlc)$/i;

function scan(root: string, maxDepth: number, out: string[]) {
  const q: [string, number][] = [[root, 0]];
  let seen = 0;
  while (q.length && seen < 300) {
    const [d, depth] = q.shift()!; seen++;
    let ents: Dirent[] = [];
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (e.isFile() && NAMES.has(e.name.toLowerCase())) out.push(join(d, e.name));
      else if (e.isDirectory() && depth < maxDepth && !SKIP.test(e.name)) q.push([join(d, e.name), depth + 1]);
    }
  }
}
/** Pastas que o recomp cria em AppData com o nome do programa (ex.: %APPDATA%\TDURecomp). */
function userRoots(ctx: AdapterContext) {
  const out = new Set<string>();
  let exes: string[] = [];
  try { exes = readdirSync(ctx.installDir).filter(n => /\.exe$|recomp$|port$/i.test(n)); } catch { }
  for (const n of exes) {
    const b = basename(n, extname(n));
    for (const base of [ctx.appData, join(ctx.appData, '..', 'Local')]) { const p = join(base, b); if (existsSync(p)) out.add(p); }
  }
  return [...out];
}
const cache = new Map<string, { at: number; files: string[] }>();
export function recompFiles(ctx: AdapterContext): string[] {
  const c = cache.get(ctx.installDir);
  if (c && Date.now() - c.at < 60_000) return c.files;
  const files: string[] = [];
  scan(ctx.installDir, 3, files);
  for (const r of userRoots(ctx)) scan(r, 3, files);
  cache.set(ctx.installDir, { at: Date.now(), files });
  return files;
}

const toMs = (v: unknown) => {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? n : n * 1000;
};
const idOf = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,6}$/.test(v) ? Number(v) : typeof v === 'string' && v ? achId(v) : null);
const nameOf = (v: unknown) => (typeof v === 'string' && v && !/^\d+$/.test(v) ? v : undefined);
function fromObj(o: Record<string, unknown>, key?: string): Unlock | null {
  if (o.unlocked === false || o.earned === false || o.achieved === false || o.achieved === 0) return null;
  const id = idOf(o.id ?? o.trophy ?? o.trophy_id ?? o.trophyId ?? o.achievement ?? o.achievement_id ?? o.key ?? key);
  if (id == null) return null;
  const at = toMs(o.time ?? o.unix ?? o.timestamp ?? o.unlocked_at ?? o.unlockedAt ?? o.earned_time ?? o.date ?? o.at);
  const name = nameOf(o.name) ?? nameOf(o.title) ?? (typeof (o.id ?? key) === 'string' ? nameOf(o.id ?? key) : undefined);
  return { id, at, ...(name ? { name } : {}) };
}

/** Lê um arquivo de conquistas de recomp pelo conteúdo. */
export function readRecompFile(buf: Uint8Array, file = ''): Unlock[] {
  if (/ach-data$/i.test(file) || (buf[0] === 0x41 && buf[1] === 0x43 && buf[2] === 0x48 && buf[3] === 0x20)) return readHedgeAch(buf);
  const text = new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '').trim();
  if (!text) return [];
  const out: Unlock[] = [];
  const push = (u: Unlock | null) => { if (u && !out.some(x => x.id === u.id)) out.push(u); };
  if (/\.jsonl$/i.test(file) || (/^\{/.test(text) && /\}\s*\r?\n\s*\{/.test(text))) {
    for (const line of text.split(/\r?\n/)) { try { push(fromObj(JSON.parse(line) as Record<string, unknown>)); } catch { } }
    return out;
  }
  let j: unknown = undefined;
  if (!/\.ini$/i.test(file) && /^[[{]/.test(text)) { try { j = JSON.parse(text); } catch { j = undefined; } }
  if (j !== undefined) {
    const list = Array.isArray(j) ? j : j && typeof j === 'object' ? ((j as Record<string, unknown>).unlocked ?? (j as Record<string, unknown>).trophies ?? (j as Record<string, unknown>).achievements ?? j) : [];
    if (Array.isArray(list)) for (const x of list) push(typeof x === 'object' && x ? fromObj(x as Record<string, unknown>) : idOf(x) != null ? { id: idOf(x)!, at: null } : null);
    else if (list && typeof list === 'object') for (const [k, v] of Object.entries(list)) push(v && typeof v === 'object' ? fromObj(v as Record<string, unknown>, k) : v === true || typeof v === 'number' ? { id: idOf(k)!, at: typeof v === 'number' ? toMs(v) : null } : null);
    return out;
  }
  if (/^\s*\[[^\]]+\]/m.test(text) || /^\s*\d+\s*=\s*\S/m.test(text)) {
    let sec: string | null = null;
    for (const line of text.split(/\r?\n/)) {
      const s = line.match(/^\s*\[(.+)\]\s*$/); if (s) { sec = s[1]!.trim(); continue; }
      const m = line.match(/^\s*([^=;#]+?)\s*=\s*(.*?)\s*$/); if (!m) continue;
      const [k, v] = [m[1]!, m[2]!];
      if (sec && /^(achieved|unlocked|earned)$/i.test(k) && /^(1|true)$/i.test(v)) push({ id: idOf(sec)!, at: null, ...(nameOf(sec) ? { name: sec } : {}) });
      else if (!sec && /^\d+$/.test(k) && v && !/^(0|false)$/i.test(v)) push({ id: Number(k), at: toMs(v) });
    }
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim(); if (!t || /^[#;/]/.test(t)) continue;
    const parts = t.split(/\t|\s+/);
    const id = idOf(parts[0]); if (id == null) continue;
    const at = parts[1] && /^\d{9,13}$/.test(parts[1]) ? toMs(parts[1]) : null;
    const rest = t.split(/\t/).length > 2 ? t.split(/\t/).slice(at ? 2 : 1).join(' ') : parts.slice(at ? 2 : 1).join(' ');
    push({ id, at, ...(rest && !/^\d+$/.test(rest) ? { name: rest } : nameOf(parts[0]) ? { name: parts[0] } : {}) });
  }
  return out;
}

export const recompLocal: Adapter = {
  id: 'recomp-local',
  label: tt('Conquistas do recomp'),
  repos: [],
  detect: dir => recompFiles({ installDir: dir, appData: process.env.APPDATA ?? join(dir, '__') }).length > 0,
  async definitions() { return { list: [], origin: tt('arquivo de conquistas do próprio recomp') }; },
  unlockFile(ctx) {
    const files = recompFiles(ctx);
    let best: [string, number] | null = null;
    for (const f of files) { try { const t = statSync(f).mtimeMs; if (!best || t > best[1]) best = [f, t]; } catch { } }
    return best?.[0] ?? '';
  },
  watchFiles: ctx => recompFiles(ctx),
  readUnlocks(buf, ctx) { return readRecompFile(buf, recompLocal.unlockFile(ctx)); },
};
