import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { getSettings, useSettings } from './settings';
import { sfx } from './sfx';

import { keyMapFor as mapFor, type Key, type PadMap } from '@shared/padmap';
export { padUsbId, type Key } from '@shared/padmap';
type Handler = (k: Key) => void;

const stack: { current: Handler }[] = [];
export function useKeys(fn: Handler, active = true) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const entry = { get current() { return ref.current; } };
    stack.push(entry);
    return () => { const i = stack.indexOf(entry); if (i >= 0) stack.splice(i, 1); };
  }, [active]);
}
let global: ((k: Key) => boolean) | null = null;
export const setGlobalKeys = (fn: (k: Key) => boolean) => { global = fn; };
export const sendKey = (k: Key) => { if (global?.(k)) return; stack.at(-1)?.current(k); };
const send = sendKey;
let last: 'pad' | 'kb' = 'kb';
const lastSubs = new Set<() => void>();
const setLast = (v: 'pad' | 'kb') => { if (last !== v) { last = v; lastSubs.forEach(f => f()); } };
export const lastInput = () => last;
export const useLastInput = () => useSyncExternalStore(f => { lastSubs.add(f); return () => lastSubs.delete(f); }, lastInput);

const KEYMAP: Record<string, Key> = {
  Enter: 'Enter', ' ': 'Enter', Escape: 'Escape', Backspace: 'Escape', Tab: 'Tab',
  ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown',
  q: 'LB', Q: 'LB', e: 'RB', E: 'RB', x: 'X', X: 'X', y: 'Y', Y: 'Y',
  PageUp: 'LT', PageDown: 'RT', F1: 'Start', F2: 'Select', Home: 'Home',
};
const isTyping = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;

let shortcut: ((key: string) => boolean) | null = null;
export const setShortcutHandler = (fn: (key: string) => boolean) => { shortcut = fn; };

if (typeof window !== 'undefined') {
  addEventListener('mousemove', () => setLast('kb'), { passive: true });
  addEventListener('keydown', e => {
    setLast('kb');
    if (e.key === 'F11' || (e.altKey && e.key === 'Enter')) { e.preventDefault(); return; }
    if (e.repeat && (e.key === 'Enter' || e.key === 'Escape')) return;
    if (isTyping(e.target)) { if (e.key === 'Escape') (e.target as HTMLElement).blur(); return; }
    if (!e.ctrlKey && !e.altKey && !e.metaKey && shortcut?.(e.key)) { e.preventDefault(); return; }
    const k = KEYMAP[e.key]; if (!k) return;
    e.preventDefault();
    send(k);
  });
  addEventListener('click', e => { const b = (e.target as HTMLElement).closest?.('button'); if (b) b.blur(); }, true);
}

export type PadKind = 'kb' | 'xbox' | 'ps' | 'nin';
let connected: Gamepad | null = null;
const padSubs = new Set<() => void>();
const refreshPads = () => { connected = [...(navigator.getGamepads?.() ?? [])].find(Boolean) ?? null; padSubs.forEach(f => f()); };
if (typeof window !== 'undefined') { addEventListener('gamepadconnected', refreshPads); addEventListener('gamepaddisconnected', refreshPads); }

function detectKind(): PadKind {
  if (!connected) return 'kb';
  const id = connected.id.toLowerCase();
  if (/xbox|045e|xinput/.test(id)) return 'xbox';
  if (/054c|dualsense|dualshock|playstation|wireless controller/.test(id)) return 'ps';
  if (/057e|nintendo|pro controller|joy-con/.test(id)) return 'nin';
  return 'xbox';
}
export const padKind = (): PadKind => { const f = getSettings().pad; return f === 'auto' ? detectKind() : f; };
export const PAD_NAMES: Record<string, string> = { auto: 'Automático', kb: 'Teclado', xbox: 'Xbox', ps: 'PlayStation', nin: 'Nintendo' };
export function usePadKind(): PadKind {
  useSettings();
  return useSyncExternalStore(f => { padSubs.add(f); return () => padSubs.delete(f); }, padKind);
}

const MAP_KEY = 'cartucho.padmap';
let maps: Record<string, PadMap> = (() => { try { return JSON.parse(localStorage.getItem(MAP_KEY) || '{}') as Record<string, PadMap>; } catch { return {}; } })();
const saveMap = (id: string, m: PadMap) => { maps = { ...maps, [id]: m }; try { localStorage.setItem(MAP_KEY, JSON.stringify(maps)); } catch { } };
export const hasCustomMap = (id: string) => !!maps[id];
export const resetPadMap = (id: string) => { const { [id]: _, ...rest } = maps; maps = rest; try { localStorage.setItem(MAP_KEY, JSON.stringify(maps)); } catch { } };

export const SETUP_STEPS: [Key, string, string][] = [
  ['Enter', 'Confirmar', 'A no Xbox · ✕ no PlayStation'], ['Escape', 'Voltar', 'B no Xbox · ○ no PlayStation'],
  ['X', 'Opções', 'X no Xbox · □ no PlayStation'], ['Y', 'Buscar', 'Y no Xbox · △ no PlayStation'],
  ['LB', 'Seção anterior', 'LB · L1'], ['RB', 'Próxima seção', 'RB · R1'], ['LT', 'Rolar para cima', 'LT · L2'], ['RT', 'Rolar para baixo', 'RT · R2'],
  ['Select', 'Select', 'Back · Select · Create'], ['Start', 'Menu do Cartucho', 'Start · Options'],
];
export interface PadSetup { id: string; step: number; map: PadMap }
let setup: PadSetup | null = null;
const setupSubs = new Set<() => void>();
const setupEmit = () => setupSubs.forEach(f => f());
export const usePadSetup = () => useSyncExternalStore(f => { setupSubs.add(f); return () => setupSubs.delete(f); }, () => setup);
export function startPadSetup(): boolean {
  const p = activePad(); if (!p) return false;
  setup = { id: p.id, step: 0, map: {} }; for (const q of pads()) prevs.set(q.index, btns(q)); setupEmit(); return true;
}
export const cancelPadSetup = () => { setup = null; setupEmit(); };
function setupPress(i: number) {
  const s = setup!; const [k] = SETUP_STEPS[s.step]!;
  if (s.step >= 2 && i === s.map.Enter) setup = { ...s, step: s.step + 1 };
  else if (Object.values(s.map).includes(i)) return;
  else setup = { ...s, step: s.step + 1, map: { ...s.map, [k]: i } };
  sfx.play('ok');
  if (setup.step >= SETUP_STEPS.length) { saveMap(setup.id, setup.map); setup = null; }
  setupEmit();
}

const hatAxis = new Map<string, number>();
const HAT: (Key | null)[] = ['ArrowUp', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
function hatDir(p: Gamepad): Key | null {
  const seen = p.axes.findIndex(v => Math.abs(v) > 1.05);
  if (seen >= 0) hatAxis.set(p.id, seen);
  const h = hatAxis.get(p.id); if (h == null) return null;
  const v = p.axes[h] ?? 2;
  return Math.abs(v) > 1.01 ? null : HAT[Math.round((v + 1) * 3.5) & 7] ?? null;
}

const prevs = new Map<number, boolean[]>(), hats = new Map<number, Key | null>();
let axisAt = 0, held: Key | null = null, heldAt = 0, away = false;
let gameRunning = false;
export const setGameRunning = (v: boolean) => { gameRunning = v; };
export const keyMapFor = (p: { id: string; mapping: string }, nin: boolean) => mapFor(p, nin, maps[p.id]);
const DIRS = new Set<Key>(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const btns = (p: Gamepad) => p.buttons.map(x => x.pressed || x.value > 0.5);
function pads() { return [...(navigator.getGamepads?.() ?? [])].filter((x): x is Gamepad => !!x); }
function touch(p: Gamepad) { if (p.index !== connected?.index || p.id !== connected?.id) { connected = p; padSubs.forEach(f => f()); } }
function activePad() {
  const all = pads();
  if (!all.length) return null;
  const p = all.find(x => x.index === connected?.index) ?? all[0]!;
  touch(p);
  return p;
}
function poll() {
  if (document.hidden || (gameRunning && !document.hasFocus())) { away = true; held = null; return; }
  const all = pads();
  if (!all.length) return;
  const now = performance.now();
  if (away) { away = false; for (const p of all) prevs.set(p.index, btns(p)); axisAt = now + 400; return; }
  let dir = false, stick: Key | null = null;
  for (const p of all) {
    const b = btns(p), old = prevs.get(p.index) ?? b;
    prevs.set(p.index, b);
    const pressed = b.findIndex((v, i) => v && !old[i]);
    if (setup) { if (p.id === setup.id && pressed >= 0) setupPress(pressed); continue; }
    const map = keyMapFor(p, padKind() === 'nin');
    if (pressed >= 0) { setLast('pad'); touch(p); }
    for (const i in map) if (b[+i] && !old[+i]) { send(map[i]!); if (DIRS.has(map[i]!)) { held = map[i]!; heldAt = now + 250; } }
    const hat = hatDir(p);
    if (hat && hat !== hats.get(p.index)) { setLast('pad'); touch(p); send(hat); held = hat; heldAt = now + 250; }
    hats.set(p.index, hat);
    if (hat || Object.keys(map).some(i => b[+i] && DIRS.has(map[+i]!))) dir = true;
    const [ax = 0, ay = 0] = p.axes;
    if (!stick && (Math.abs(ax) > 0.6 || Math.abs(ay) > 0.6)) { touch(p); stick = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'ArrowRight' : 'ArrowLeft') : (ay > 0 ? 'ArrowDown' : 'ArrowUp'); }
  }
  if (setup) return;
  if (!dir) held = null;
  else if (held && now > heldAt) { send(held); heldAt = now + 110; }
  if (stick) { setLast('pad'); if (now - axisAt > 180) { axisAt = now; send(stick); } } else axisAt = 0;
}
if (typeof window !== 'undefined') setInterval(poll, 16);

type Act = 'ok' | 'back' | 'x' | 'y' | 'lb' | 'rb' | 'lt' | 'rt' | 'menu' | 'sel' | 'ud' | 'lr';
const PS: Record<string, ReactNode> = {
  ok: <svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5L5 15" stroke="#8fb0ff" strokeWidth="2.6" strokeLinecap="round" /></svg>,
  back: <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="5.2" fill="none" stroke="#ff6f6f" strokeWidth="2.4" /></svg>,
  x: <svg viewBox="0 0 20 20"><rect x="5" y="5" width="10" height="10" fill="none" stroke="#f08ad8" strokeWidth="2.4" /></svg>,
  y: <svg viewBox="0 0 20 20"><path d="M10 4.5l5.8 10H4.2z" fill="none" stroke="#4fd6a8" strokeWidth="2.3" strokeLinejoin="round" /></svg>,
};
const GL: Record<PadKind, Record<Act, string | [string, string] | ReactNode>> = {
  kb: { ok: 'Enter', back: 'Esc', x: 'X', y: 'Y', lb: 'Q', rb: 'E', lt: 'PgUp', rt: 'PgDn', menu: 'F1', sel: 'F2', ud: '↑↓', lr: '←→' },
  xbox: { ok: ['A', '#6ad13a'], back: ['B', '#ff5a4f'], x: ['X', '#4a95ff'], y: ['Y', '#ffc928'], lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', menu: '☰', sel: '⧉', ud: '✚', lr: '✚' },
  ps: { ok: PS.ok, back: PS.back, x: PS.x, y: PS.y, lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', menu: 'OPTIONS', sel: 'CREATE', ud: '✚', lr: '✚' },
  nin: { ok: ['A', '#fff'], back: ['B', '#fff'], x: ['Y', '#fff'], y: ['X', '#fff'], lb: 'L', rb: 'R', lt: 'ZL', rt: 'ZR', menu: '+', sel: '−', ud: '✚', lr: '✚' },
};
export function Glyph({ a, pad }: { a: Act; pad?: boolean }) {
  const kind = usePadKind(), k = pad && kind === 'kb' ? 'xbox' : kind, v = GL[k][a];
  if (k === 'kb') return <span className="gp kb">{v as string}</span>;
  if (Array.isArray(v) && typeof v[0] === 'string') return <span className="gp r" style={{ color: v[1] as string }}>{v[0]}</span>;
  if (typeof v === 'string') return <span className="gp pill">{v}</span>;
  return <span className="gp r">{v}</span>;
}
export function Hints({ items }: { items: [Act, string][] }) {
  return <footer className="hints">{items.map(([a, t]) => <span key={a + t}><Glyph a={a} />{t}</span>)}</footer>;
}
