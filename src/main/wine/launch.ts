import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { WineConfig, WineStatus } from '@shared/wine';
import { tt } from '@shared/i18n';
import type { DB } from '../db';
import { prefixDir } from '../steam';
import { loadConfig } from './config';
import {
  DXVK_DLLS, DXVK_NEEDS_VK14_FROM, VKD3D_DLLS, cmpVer, deploy, ensureDxvk, ensureVkd3d, finish, installLatestGE, installWinetricks, listVersions, overrides, peBits, pickDxvk, sender, undeploy, vulkan,
} from './components';
import { detectTools, discoverBuilds, ensureDirs, launchArgs, resolveRunner, runTool, spawnLogged, type Runner, type RunnerError } from './runner';

export interface Launch { cmd: string; args: string[]; env: Record<string, string>; how: string; logFile: string }
type Note = (stage: string, pct: number) => void;

export const runLog = (gameId: string) => join(prefixDir(gameId), 'cartucho-run.log');

export const wineStatus = (): WineStatus => ({ ...detectTools(), vulkan: vulkan(), builds: discoverBuilds() });

function runnerMessage(error: RunnerError | undefined) {
  if (error === 'build-missing') return tt('A versão do Wine/Proton escolhida nas configurações não está mais instalada. Escolha outra em Configurações > Wine.');
  if (error === 'umu' || error === 'proton' || error === 'wine') return tt('O {0} escolhido nas configurações não está instalado.', { 0: error === 'umu' ? 'umu-launcher' : error === 'proton' ? 'Proton' : 'Wine' });
  return tt('Este é um programa do Windows e o Cartucho não achou como rodá-lo. Instale o umu-launcher (ou a Steam com o Proton) ou o Wine, ou baixe um Proton-GE em Configurações > Wine.');
}

function runnerFor(gameId: string, cfg: WineConfig) {
  const { runner, error } = resolveRunner(gameId, cfg);
  if (!runner) throw new Error(runnerMessage(error));
  return runner;
}

/** Error that points at the log; `detail` is the last line of the failing tool's output. */
const failure = (what: string, detail: string, logFile: string) =>
  new Error(tt('{0} Veja o registro em {1}.', { 0: detail.trim() ? `${what} (${detail.trim().split('\n').pop()!.slice(0, 200)})` : what, 1: logFile }));

/** Wine and Proton create the prefix on first run; do it up front so DXVK and winetricks have something to work on. */
async function initPrefix(r: Runner, logFile: string, note: Note) {
  if (!r.firstRun) return;
  note(tt('Preparando o prefixo do Wine pela primeira vez…'), 0.2);
  const out = await runTool(r, ['wineboot', '-u'], { log: logFile, timeout: 300_000 });
  if (!existsSync(join(r.prefix, 'system.reg'))) throw failure(tt('Não consegui criar o prefixo do Wine.'), out.output, logFile);
}

const verbsFile = (r: Runner) => join(r.prefix, '.cartucho-winetricks.json');
const appliedVerbs = (r: Runner): string[] => { try { return JSON.parse(readFileSync(verbsFile(r), 'utf8')) as string[]; } catch { return []; } };

async function runVerb(r: Runner, verb: string, logFile: string) {
  if (r.name === 'umu') return runTool(r, ['winetricks', '-q', verb], { log: logFile, timeout: 3_600_000 });
  if (!r.wineBin) return { code: 1, output: tt('Não achei o executável do Wine neste Proton.') };
  const bin = detectTools().winetricks ?? await installWinetricks();
  return spawnLogged(bin, ['-q', verb], { log: logFile, timeout: 3_600_000, env: { ...r.env, WINEPREFIX: r.prefix, WINE: r.wineBin } });
}

/** Installs the verbs this prefix does not have yet. */
async function installVerbs(r: Runner, verbs: string[], logFile: string, note: Note) {
  const done = appliedVerbs(r), todo = verbs.filter(v => !done.includes(v));
  for (const [i, verb] of todo.entries()) {
    note(tt('Instalando {0} com o winetricks… (pode demorar)', { 0: verb }), 0.7 + 0.25 * (i / todo.length));
    const out = await runVerb(r, verb, logFile);
    if (out.code !== 0) throw failure(tt('O winetricks não conseguiu instalar {0}.', { 0: verb }), out.output, logFile);
    done.push(verb);
    writeFileSync(verbsFile(r), JSON.stringify(done));
  }
}

/**
 * Where the Direct3D DLLs go. Wine reads them from the prefix. Proton rewrites its DLLs in the prefix on
 * every launch, so for Proton and umu they go next to the .exe, where Windows' DLL search finds them first.
 */
function dllPlace(r: Runner, exe: string) {
  if (r.name !== 'wine') return { dir: dirname(exe), targets: peBits(exe) === 32 ? { x64: null, x32: dirname(exe) } : { x64: dirname(exe), x32: null } };
  const system = join(r.prefix, 'drive_c', 'windows');
  // 32-bit prefixes have no syswow64: their system32 holds the 32-bit DLLs
  return { dir: r.prefix, targets: existsSync(join(system, 'syswow64')) ? { x64: join(system, 'system32'), x32: join(system, 'syswow64') } : { x64: null, x32: join(system, 'system32') } };
}

/**
 * Everything a Windows program needs before it can start: runner, prefix, DXVK/VKD3D, winetricks.
 * Slow steps are reported through `note`; a failing step throws with the log path.
 */
export async function prepareWindows(db: DB, gameId: string, exe: string, note: Note, log: (s: string) => void): Promise<Launch> {
  const cfg = loadConfig(db, gameId);
  let r = runnerFor(gameId, cfg);
  if (r.name === 'umu' && !r.build && !cfg.runnerBuild) {
    note(tt('Baixando o Proton-GE…'), 0);
    try { await installLatestGE(); r = runnerFor(gameId, cfg); }
    catch (e) { log(`Proton-GE não baixou: ${(e as Error).message}; o umu tenta sozinho`); }
  }

  mkdirSync(prefixDir(gameId), { recursive: true });
  ensureDirs(r);
  const logFile = runLog(gameId);
  writeFileSync(logFile, `# ${new Date().toISOString()} ${r.how}\n# prefixo ${r.prefix}\n`);
  await initPrefix(r, logFile, note);

  const env: Record<string, string> = { ...r.env };
  const dlls: string[] = [];
  const { dir, targets } = dllPlace(r, exe);
  const wineDirect = r.name === 'wine';

  const { version, async } = cfg.dxvk, dxvkMarker = join(dir, '.cartucho-dxvk.json');
  if (version === 'off' || (!wineDirect && version === 'auto' && !async)) undeploy(dxvkMarker);
  else {
    try {
      note(tt('Preparando o DXVK…'), 0.5);
      const versions = await listVersions(), { supports14, apiVersion } = vulkan();
      const v = pickDxvk(async ? versions.dxvkAsync : versions.dxvk, supports14, version);
      if (!v) throw new Error(tt('Não achei uma versão do DXVK para usar (sem internet e nada baixado antes).'));
      if (supports14 === false && cmpVer(v, DXVK_NEEDS_VK14_FROM) >= 0) log(`aviso: DXVK ${v} pede Vulkan 1.4 e a placa mostra ${apiVersion}`);
      const pack = await ensureDxvk(v, async);
      deploy(pack, DXVK_DLLS, targets, dxvkMarker);
      dlls.push(...DXVK_DLLS);
      if (async) env.DXVK_ASYNC = '1';
      log(`DXVK ${pack.name} (${wineDirect ? 'no prefixo' : 'ao lado do .exe'})`);
    } catch (e) {
      // Plain Wine has no other Direct3D that works well: without DXVK the game does not start. Proton keeps its own.
      if (wineDirect) throw failure(tt('Não consegui preparar o DXVK, que o Wine precisa para os jogos 3D.'), (e as Error).message, logFile);
      log(`DXVK não preparado, usando o do Proton: ${(e as Error).message}`);
    }
  }

  const vkd3dMarker = join(dir, '.cartucho-vkd3d.json');
  if (cfg.vkd3d.version === 'off') undeploy(vkd3dMarker);
  else {
    try {
      note(tt('Preparando o VKD3D-Proton…'), 0.6);
      deploy(await ensureVkd3d(cfg.vkd3d.version), VKD3D_DLLS, targets, vkd3dMarker);
      dlls.push(...VKD3D_DLLS);
    } catch (e) { log(`VKD3D-Proton não preparado: ${(e as Error).message}`); }
  }

  await installVerbs(r, cfg.winetricks, logFile, note);

  const dllOverrides = [wineDirect && 'winemenubuilder.exe=d', env.WINEDLLOVERRIDES, dlls.length && overrides(dlls)].filter(Boolean).join(';');
  if (dllOverrides) env.WINEDLLOVERRIDES = dllOverrides;
  return { cmd: r.cmd, args: launchArgs(r, exe), env, how: r.how, logFile };
}

/** winetricks run from the UI, on the same prefix and runner as the game. Progress shows on the game's key. */
export async function runWinetricks(db: DB, gameId: string, verbs: string[]) {
  const r = runnerFor(gameId, loadConfig(db, gameId)), send = sender(gameId), logFile = runLog(gameId);
  try {
    mkdirSync(prefixDir(gameId), { recursive: true });
    ensureDirs(r);
    await initPrefix(r, logFile, send);
    await installVerbs(r, verbs, logFile, send);
    finish(gameId);
  } catch (e) { finish(gameId, (e as Error).message); throw e; }
}

/** Deletes the prefix Cartucho made for this game. A prefix the user pointed at is never touched. */
export const deletePrefix = (gameId: string) => rmSync(prefixDir(gameId), { recursive: true, force: true });
