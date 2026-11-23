export type RunnerKind = 'auto' | 'umu' | 'proton' | 'wine';
export type SyncMode = 'default' | 'esync' | 'fsync' | 'none';

export interface WineConfig {
  runner: RunnerKind;
  /** Absolute folder of a Proton-style (has `proton`) or Wine-style (has `bin/wine`) build. null = best one found. */
  runnerBuild: string | null;
  /** Existing prefix to use instead of the per-game one. Only per game. */
  prefixPath: string | null;
  env: Record<string, string>;
  /** version: 'auto' (latest for Wine, the build's own for Proton), 'off', or a release such as '3.1.1'. */
  dxvk: { version: string; async: boolean };
  /** 'off' or a release such as '3.1'. */
  vkd3d: { version: string };
  winetricks: string[];
  sync: SyncMode;
}

export const WINE_DEFAULTS: WineConfig = {
  runner: 'auto', runnerBuild: null, prefixPath: null, env: {},
  dxvk: { version: 'auto', async: false }, vkd3d: { version: 'off' }, winetricks: [], sync: 'default',
};

export interface WinePatch {
  runner?: RunnerKind;
  runnerBuild?: string | null;
  prefixPath?: string | null;
  env?: Record<string, string>;
  dxvk?: { version?: string; async?: boolean };
  vkd3d?: { version?: string };
  winetricks?: string[];
  sync?: SyncMode;
}

const RUNNERS: Record<RunnerKind, true> = { auto: true, umu: true, proton: true, wine: true };
const SYNCS: Record<SyncMode, true> = { default: true, esync: true, fsync: true, none: true };
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const VERB = /^[a-z0-9_.-]{1,40}$/i;

/** Accepts anything (e.g. JSON from the db) and keeps only valid fields. */
export function cleanPatch(raw: unknown): WinePatch {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, out: WinePatch = {};
  if (typeof o.runner === 'string' && Object.hasOwn(RUNNERS, o.runner)) out.runner = o.runner as RunnerKind;
  if (o.runnerBuild === null || (typeof o.runnerBuild === 'string' && o.runnerBuild.startsWith('/'))) out.runnerBuild = o.runnerBuild as string | null;
  if (o.prefixPath === null || (typeof o.prefixPath === 'string' && o.prefixPath.startsWith('/'))) out.prefixPath = o.prefixPath as string | null;
  if (o.env && typeof o.env === 'object') {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(o.env)) if (ENV_KEY.test(k) && typeof v === 'string') env[k] = v;
    out.env = env;
  }
  const d = o.dxvk as Record<string, unknown> | undefined;
  if (d && typeof d === 'object') {
    out.dxvk = {};
    if (typeof d.version === 'string' && /^(auto|off|\d+(\.\d+){0,2})$/.test(d.version)) out.dxvk.version = d.version;
    if (typeof d.async === 'boolean') out.dxvk.async = d.async;
  }
  const k = o.vkd3d as Record<string, unknown> | undefined;
  if (k && typeof k === 'object' && typeof k.version === 'string' && /^(off|\d+(\.\d+){0,2}[a-z]?)$/.test(k.version)) out.vkd3d = { version: k.version };
  if (Array.isArray(o.winetricks)) out.winetricks = [...new Set(o.winetricks.filter((v): v is string => typeof v === 'string' && VERB.test(v)))];
  if (typeof o.sync === 'string' && Object.hasOwn(SYNCS, o.sync)) out.sync = o.sync as SyncMode;
  return out;
}

/** Later patches win. `winetricks` is the union, `env` merges key by key. */
export function mergeConfig(...patches: WinePatch[]): WineConfig {
  const c: WineConfig = { ...WINE_DEFAULTS, env: {}, dxvk: { ...WINE_DEFAULTS.dxvk }, vkd3d: { ...WINE_DEFAULTS.vkd3d }, winetricks: [] };
  for (const p of patches) {
    if (p.runner) c.runner = p.runner;
    if (p.runnerBuild !== undefined) c.runnerBuild = p.runnerBuild;
    if (p.prefixPath !== undefined) c.prefixPath = p.prefixPath;
    if (p.env) c.env = { ...c.env, ...p.env };
    if (p.dxvk) c.dxvk = { ...c.dxvk, ...p.dxvk };
    if (p.vkd3d) c.vkd3d = { ...c.vkd3d, ...p.vkd3d };
    if (p.winetricks) c.winetricks = [...new Set([...c.winetricks, ...p.winetricks])];
    if (p.sync) c.sync = p.sync;
  }
  return c;
}

export interface RunnerBuild {
  /** absolute folder, or 'system' for the `wine` found in PATH */
  id: string;
  name: string;
  kind: 'proton' | 'wine';
  family: 'ge' | 'cachyos' | 'valve' | 'other' | 'wine';
  where: 'cartucho' | 'steam' | 'system';
}

export interface VulkanInfo { apiVersion: string | null; supports14: boolean | null }

export interface WineStatus {
  umu: string | null;
  wine: string | null;
  winetricks: string | null;
  vulkan: VulkanInfo;
  builds: RunnerBuild[];
}

export interface WineVersions { dxvk: string[]; dxvkAsync: string[]; vkd3d: string[]; dxvkDefault: string | null }

export interface RemoteBuild { id: string; name: string; family: 'ge' | 'cachyos' | 'wine'; installed: boolean }
