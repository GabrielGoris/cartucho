/**
 * Configurações do Cartucho, salvas neste computador (localStorage da janela).
 * Por enquanto: atalhos de teclado mudam algumas; a tela de configurações vem na próxima etapa.
 */
import { useSyncExternalStore } from 'react';

export interface Settings {
  pal: string;          // paleta
  crtLvl: number;       // 0–100, 0 = sem filtro
  flicker: boolean;
  frame: boolean;       // moldura de TV
  glow: boolean;
  pixel: boolean;       // palco 3D em baixa resolução
  blur: boolean;        // desfoque do palco atrás da Home
  snd: boolean;
  vol: number;          // 0–100
  bootSnd: boolean;
  pad: 'auto' | 'kb' | 'xbox' | 'ps' | 'nin';
  boot: boolean;        // mostrar a abertura
  start: 'act' | 'stage';
  reduce: boolean;      // menos movimento
  hidden: string[];     // consoles fora do palco (os jogos deles aparecem em Outros)
  picked: boolean;      // já escolheu quais consoles mostrar (a pergunta aparece só na primeira vez)
}
export const DEFAULTS: Settings = { pal: 'neon', crtLvl: 30, flicker: true, frame: true, glow: true, pixel: true, blur: true, snd: true, vol: 70, bootSnd: true, pad: 'auto', boot: true, start: 'act', reduce: false, hidden: [], picked: false };

const KEY = 'cartucho.set';
let state: Settings = (() => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; } })();
const subs = new Set<() => void>();

export const getSettings = () => state;
export function setSettings(patch: Partial<Settings>) {
  state = { ...state, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* sem armazenamento: vale só nesta sessão */ }
  subs.forEach(f => f());
}
const subscribe = (f: () => void) => { subs.add(f); return () => subs.delete(f); };
export const useSettings = () => useSyncExternalStore(subscribe, getSettings);

export const reduceMotion = () => state.reduce || matchMedia('(prefers-reduced-motion: reduce)').matches;
