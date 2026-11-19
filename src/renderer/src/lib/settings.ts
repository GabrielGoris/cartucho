import { useSyncExternalStore } from 'react';

export interface Settings {
  pal: string;
  crtLvl: number;
  flicker: boolean;
  frame: boolean;
  glow: boolean;
  pixel: boolean;
  blur: boolean;
  snd: boolean;
  vol: number;
  bootSnd: boolean;
  pad: 'auto' | 'kb' | 'xbox' | 'ps' | 'nin';
  boot: boolean;
  start: 'act' | 'stage';
  reduce: boolean;
  hidden: string[];
  picked: boolean;
  translate: boolean;
}
export const DEFAULTS: Settings = { pal: 'neon', crtLvl: 30, flicker: true, frame: true, glow: true, pixel: true, blur: true, snd: true, vol: 70, bootSnd: true, pad: 'auto', boot: true, start: 'act', reduce: false, hidden: [], picked: false, translate: true };

const KEY = 'cartucho.set';
let state: Settings = (() => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; } })();
const subs = new Set<() => void>();

export const getSettings = () => state;
export function setSettings(patch: Partial<Settings>) {
  state = { ...state, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {  }
  subs.forEach(f => f());
}
const subscribe = (f: () => void) => { subs.add(f); return () => subs.delete(f); };
export const useSettings = () => useSyncExternalStore(subscribe, getSettings);

export const reduceMotion = () => state.reduce || matchMedia('(prefers-reduced-motion: reduce)').matches;
