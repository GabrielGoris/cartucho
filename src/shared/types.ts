/** Consoles do palco. Tudo que não tem console próprio cai em "other". */
export const CONSOLE_IDS = ['snes', 'n64', 'gc', 'wii', 'switch', 'switch2', 'ps1', 'ps2', 'psp', 'ps3', 'ps4', 'ps5', 'x360', 'pc', 'other'] as const;
export type ConsoleId = (typeof CONSOLE_IDS)[number];

export type PlayStatus = 'full' | 'play' | 'wip';

export interface CatalogGame {
  id: string;            // "recomps/007-agent-under-fire" (campo `entry` do Recompendium)
  title: string;
  repo: string | null;
  console: ConsoleId;
  platformName: string;  // nome da plataforma de origem (útil no "Outros")
  status: PlayStatus;
  version: string | null;
  date: string | null;
  stars: number;
  year: number | null;
  developer: string | null;
  needs: string | null;
  description: string | null;
  coverUrl: string | null;
  /** O Recompendium lista o projeto mas não põe link para ele. */
  noLink: boolean;
  firstSeenAt: number;
}

export type RadarKind = 'new' | 'up' | 'upd';
export interface RadarEvent { id: number; gameId: string; title: string; console: ConsoleId; kind: RadarKind; detail: string; at: number }

export type AchievementSource = 'xdbf' | 'builtin';
export interface AchievementView {
  id: number;
  name: string;
  description: string;
  points: number | null;
  unlockedAt: number | null;   // ms; null = bloqueada
  icon: string | null;         // data:image/png;base64,... (ícone original, quando o jogo tem)
}
export interface InstalledGame {
  id: string;
  title: string;
  console: ConsoleId;
  installDir: string;
  adapter: string | null;
  adapterLabel: string | null;
  catalogId: string | null;
  coverUrl: string | null;
  addedAt: number;
  achievements: { unlocked: number; total: number } | null;
}

export interface GameAchievements {
  game: InstalledGame;
  /** De onde veio a lista (arquivo do jogo ou lista embutida). */
  origin: string | null;
  /** Arquivo de desbloqueios que estamos observando. */
  unlockFile: string | null;
  /** Problemas ao ler a lista ou os desbloqueios, em português, para mostrar na tela. */
  errors: string[];
  list: AchievementView[];
}

export interface UnlockEvent { gameId: string; gameTitle: string; achId: number; name: string; at: number }

export interface RecentUnlock { gameId: string; gameTitle: string; achId: number; name: string; points: number | null; at: number }

/** Resumo para a abertura, a Home e o palco. */
export interface LibrarySummary {
  catalogTotal: number;
  platforms: number;                                   // plataformas distintas em "Outros"
  perConsole: Record<string, { recomps: number; installed: number; fresh: number }>;
  installed: number;
  radar: { unseen: number; fresh: number; updates: number };
  achievements: { unlocked: number; total: number };
}
