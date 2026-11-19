import type { ConsoleId, PlayStatus } from './types';

/** `consola` do Recompendium → console do palco. O que não estiver aqui vai para "other". */
const MAP: Record<string, ConsoleId> = {
  nes: 'nes', famicom: 'nes', nds: 'nds', ds: 'nds', xbox: 'xbox',
  // famílias: um lugar no palco para o aparelho e seus irmãos/acessórios (cada jogo guarda a plataforma de origem)
  gb: 'gb', gbc: 'gb', gba: 'gb', gameboy: 'gb', gameboycolor: 'gb', gameboyadvance: 'gb',
  megadrive: 'megadrive', genesis: 'megadrive', megacd: 'megadrive', segacd: 'megadrive', '32x': 'megadrive',
  snes: 'snes', superfamicom: 'snes', n64: 'n64', gc: 'gc', gamecube: 'gc', ngc: 'gc', wii: 'wii',
  switch: 'switch', nsw: 'switch', switch2: 'switch2', ns2: 'switch2',
  ps1: 'ps1', psx: 'ps1', ps2: 'ps2', psp: 'psp', ps3: 'ps3', ps4: 'ps4', ps5: 'ps5',
  x360: 'x360', xbox360: 'x360', pc: 'pc', dos: 'pc', windows: 'pc',
};
export const toConsoleId = (consola: string | null | undefined): ConsoleId => MAP[(consola ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')] ?? 'other';

const STATUS: Record<string, PlayStatus> = { fully: 'full', playable: 'play', experimental: 'wip' };
export const toStatus = (estado: string | null | undefined): PlayStatus => STATUS[(estado ?? '').toLowerCase()] ?? 'wip';

export const STATUS_LABEL: Record<PlayStatus, string> = { full: 'Totalmente jogável', play: 'Jogável', wip: 'Em progresso' };
export const CONSOLE_NAME: Record<ConsoleId, string> = {
  nes: 'NES', gb: 'Game Boy', nds: 'Nintendo DS', xbox: 'Xbox', megadrive: 'Mega Drive',
  snes: 'Super Nintendo', n64: 'Nintendo 64', gc: 'GameCube', wii: 'Wii', switch: 'Nintendo Switch', switch2: 'Nintendo Switch 2',
  ps1: 'PlayStation', ps2: 'PlayStation 2', psp: 'PSP', ps3: 'PlayStation 3', ps4: 'PlayStation 4', ps5: 'PlayStation 5',
  x360: 'Xbox 360', pc: 'PC', other: 'Outros',
};

/**
 * Consoles cujos recomps o Cartucho não baixa nem atualiza sozinho: a geração que a fabricante ainda vende
 * e protege na Justiça. Para eles o catálogo é só informativo: mostra quais jogos têm recomp, sem link nem nome
 * do projeto; o usuário pesquisa e instala por conta própria (com a cópia dele do jogo) e adiciona a pasta aqui.
 */
export const SELF_INSTALL: ReadonlySet<ConsoleId> = new Set<ConsoleId>(['switch', 'switch2']);
export const isSelfInstall = (c: ConsoleId | string | null | undefined) => SELF_INSTALL.has(c as ConsoleId);
export const SELF_INSTALL_NOTE = 'O Cartucho não baixa recomps deste console. Instale o recomp por conta própria, com a sua cópia do jogo, e depois adicione a pasta aqui.';
