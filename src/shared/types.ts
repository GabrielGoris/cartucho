/** Consoles do palco. Tudo que não tem console próprio cai em "other". */
export const CONSOLE_IDS = ['nes', 'gb', 'snes', 'n64', 'gc', 'nds', 'wii', 'switch', 'switch2', 'ps1', 'ps2', 'psp', 'ps3', 'ps4', 'ps5', 'xbox', 'x360', 'megadrive', 'pc', 'other'] as const;
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
  /** Plataforma de origem segundo o catálogo (ex.: "Game Boy Advance"); null fora do catálogo. */
  platformName: string | null;
  installDir: string;
  adapter: string | null;
  adapterLabel: string | null;
  catalogId: string | null;
  coverUrl: string | null;
  addedAt: number;
  achievements: { unlocked: number; total: number } | null;
  /** Programa que o Jogar abre (null = ainda não sabemos qual é). */
  exe: string | null;
  /** Projeto no GitHub de onde vêm as atualizações. */
  sourceRepo: string | null;
  /** Versão instalada, quando conhecida. */
  version: string | null;
  /** Instalado pelo Cartucho (pode desinstalar). */
  managed: boolean;
  playMs: number;
  lastPlayed: number | null;
  running: boolean;
  missing: boolean;
}

export interface InstalledRelease { tag: string; assetId: number; date: string | null; uploader: string | null }
export interface UpdateInfo {
  repo: string | null;
  installed: string | null;              // versão instalada (tag)
  latest: { tag: string; name: string; date: string | null; notes: string; page: string; size: number; assetName: string } | null;
  /** true/false; null = não dá para saber (versão instalada desconhecida). */
  updateAvailable: boolean | null;
  checkedAt: number | null;
  error?: string;
}
export interface InstallProgress { key: string; stage: string; pct: number; done?: boolean; error?: string }
export interface PlayEvent { gameId: string; title: string; running: boolean; sessionMs?: number }
export interface PlayStats { totalMs: number; sessions: number; lastPlayed: number | null; /** horas por dia, últimos 14 dias (o último é hoje) */ days: number[] }

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
  perConsole: Record<string, { recomps: number; installed: number; fresh: number; platforms: number }>;
  installed: number;
  playMs: number;
  radar: { unseen: number; fresh: number; updates: number };
  achievements: { unlocked: number; total: number };
}
