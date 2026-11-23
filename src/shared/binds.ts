import { keyMapFor, type Key } from './padmap';

export type Bind = string[];
export interface Binds { summon: Bind; shot: Bind }
export type BindAction = keyof Binds;
export const DEFAULT_BINDS: Binds = { summon: ['Home'], shot: ['Home', 'RB'] };
export const HOLD = 1000;

const KEYS = new Set<string>(['Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'LB', 'RB', 'LT', 'RT', 'X', 'Y', 'Start', 'Select', 'Home'] satisfies Key[]);
export const validToken = (t: string) => KEYS.has(t) || /^#\d{1,2}$/.test(t);

export function cleanBind(b: unknown): Bind | null {
  if (!Array.isArray(b)) return null;
  const out = [...new Set(b.filter((x): x is string => typeof x === 'string' && validToken(x)))].slice(0, 4);
  return out.length ? out : null;
}

export function readBinds(raw: string | null | undefined): Binds {
  try {
    const o = JSON.parse(raw || '{}') as Partial<Record<BindAction, unknown>>;
    return { summon: cleanBind(o.summon) ?? DEFAULT_BINDS.summon, shot: cleanBind(o.shot) ?? DEFAULT_BINDS.shot };
  } catch { return { ...DEFAULT_BINDS }; }
}

export const sameBind = (a: Bind, b: Bind) => a.length === b.length && a.every(x => b.includes(x));

export function padTokens(p: { id: string; mapping: string }, pressed: boolean[]): Set<string> {
  const map = keyMapFor(p, false), out = new Set<string>();
  pressed.forEach((v, i) => { if (v) out.add(map[i] ?? `#${i}`); });
  return out;
}
