/**
 * Adaptadores de conquistas, um por recomp que já tem conquistas próprias.
 *
 * Camada 1: ler o arquivo onde o próprio recomp grava os desbloqueios.
 * Camada 2: tirar a lista original de conquistas da cópia do jogo que o usuário instalou (Xbox 360: XDBF).
 *
 * Os adaptadores só leem arquivos; nunca escrevem nada nas pastas do jogo nem nos saves.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Xdbf } from './xdbf';
import { xdbfFromExecutable } from './xex';
import { readHedgeAch, readOxygenAchievements, readRsdkUserdata, type Unlock } from './saves';
import { SONIC3AIR } from './data/sonic3air';
import { SONIC1_2013, SONIC2_2013 } from './data/rsdk4';

export interface AdapterContext {
  installDir: string;
  appData: string;          // %APPDATA% (Roaming) no Windows; ~/.config no Linux; ~/Library/Application Support no macOS
  title?: string;           // título do catálogo, para adaptadores que atendem mais de um jogo
}
export interface AchievementDef { id: number; name: string; description: string; points: number | null; imageId?: number }
export interface Definitions { list: AchievementDef[]; images?: Map<number, Uint8Array>; origin: string }

export interface Adapter {
  id: string;
  label: string;
  /** Nome do repositório no GitHub (só a parte depois da barra, minúsculo). */
  repos: string[];
  /** A pasta parece ser deste recomp? */
  detect(dir: string): boolean;
  definitions(ctx: AdapterContext): Promise<Definitions>;
  /** Onde o recomp grava os desbloqueios, na ordem em que ele mesmo procura. */
  unlockFile(ctx: AdapterContext): string;
  readUnlocks(buf: Uint8Array): Unlock[];
}

const hasFile = (dir: string, ...names: string[]) => names.some(n => existsSync(join(dir, n)));

/** Lista original de um jogo de 360, lida do executável que o recomp deixou na pasta. */
async function xdbfDefinitions(paths: string[]): Promise<Definitions> {
  let lastErr: unknown = new Error('executável do jogo não encontrado');
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const x = new Xdbf(xdbfFromExecutable(new Uint8Array(await readFile(p))));
      const texts = x.achievementTexts();
      const images = new Map<number, Uint8Array>();
      for (const a of texts) { const img = x.image(a.imageId); if (img) images.set(a.id, img); }
      return { list: texts.map(a => ({ id: a.id, name: a.name, description: a.description, points: a.gamerscore, imageId: a.imageId })), images, origin: p };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/** hedge-dev: dados do usuário em %APPDATA%/<Nome>, ou na pasta do jogo se existir portable.txt. */
const hedgeUserDir = (ctx: AdapterContext, folder: string) => existsSync(join(ctx.installDir, 'portable.txt')) ? ctx.installDir : join(ctx.appData, folder);

export const unleashedRecomp: Adapter = {
  id: 'unleashed-recomp',
  label: 'UnleashedRecomp',
  repos: ['unleashedrecomp'],
  detect: dir => hasFile(dir, 'UnleashedRecomp.exe', 'UnleashedRecomp'),
  definitions: ctx => xdbfDefinitions([join(ctx.installDir, 'patched', 'default.xex'), join(ctx.installDir, 'game', 'default.xex')]),
  unlockFile: ctx => join(hedgeUserDir(ctx, 'UnleashedRecomp'), 'save', 'ACH-DATA'),
  readUnlocks: readHedgeAch,
};

export const marathonRecomp: Adapter = {
  id: 'marathon-recomp',
  label: 'MarathonRecomp',
  repos: ['marathonrecomp'],
  detect: dir => hasFile(dir, 'MarathonRecomp.exe', 'MarathonRecomp'),
  definitions: ctx => xdbfDefinitions([join(ctx.installDir, 'decrypted', 'default.bin'), join(ctx.installDir, 'game', 'default.xex')]),
  unlockFile: ctx => join(hedgeUserDir(ctx, 'MarathonRecomp'), 'save', 'SonicNextAchievementData.bin'),
  readUnlocks: readHedgeAch,
};

export const sonic3air: Adapter = {
  id: 'sonic3air',
  label: 'Sonic 3 A.I.R.',
  repos: ['sonic3air'],
  detect: dir => hasFile(dir, 'Sonic3AIR.exe', 'sonic3air_linux', 'sonic3air'),
  definitions: async () => ({ list: SONIC3AIR.map(a => ({ ...a, points: null })), origin: 'lista do próprio Sonic 3 A.I.R.' }),
  // Com uma pasta "savedata" ao lado do executável o jogo grava nela; senão, em %APPDATA%/Sonic3AIR.
  unlockFile: ctx => existsSync(join(ctx.installDir, 'savedata'))
    ? join(ctx.installDir, 'savedata', 'storage', 's3air_achievements.bin')
    : join(ctx.appData, 'Sonic3AIR', 'storage', 's3air_achievements.bin'),
  readUnlocks: readOxygenAchievements,
};

export const rsdkv4: Adapter = {
  id: 'rsdkv4',
  label: 'Sonic 1/2 (2013)',
  repos: ['rsdkv4-decompilation', 'sonic-1-2-2013-decompilation'],
  detect: dir => hasFile(dir, 'RSDKv4.exe', 'RSDKv4') && hasFile(dir, 'Data.rsdk'),
  // O mesmo executável roda o Sonic 1 e o Sonic 2; o Data.rsdk decide. Usamos o título do catálogo.
  definitions: async ctx => {
    const two = /sonic\s*(the\s*hedgehog\s*)?2\b|sonic 2/i.test(ctx.title ?? '');
    return { list: (two ? SONIC2_2013 : SONIC1_2013).map(a => ({ ...a, points: null })), origin: `lista do Retro Engine v4 (${two ? 'Sonic 2' : 'Sonic 1'})` };
  },
  unlockFile: ctx => join(ctx.installDir, 'UData.bin'),
  readUnlocks: readRsdkUserdata,
};

export const ADAPTERS: Adapter[] = [unleashedRecomp, marathonRecomp, sonic3air, rsdkv4];

export const adapterForRepo = (repo: string | null | undefined) => {
  const name = (repo ?? '').split('/').pop()?.toLowerCase() ?? '';
  return ADAPTERS.find(a => a.repos.includes(name)) ?? null;
};
export const adapterForDir = (dir: string) => ADAPTERS.find(a => a.detect(dir)) ?? null;
export const adapterById = (id: string | null | undefined) => ADAPTERS.find(a => a.id === id) ?? null;
