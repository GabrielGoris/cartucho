import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { getSettings, useSettings } from './settings';

export type Key = 'Enter' | 'Escape' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Tab' | 'LB' | 'RB' | 'X' | 'Y';
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
const send = (k: Key) => stack.at(-1)?.current(k);

const KEYMAP: Record<string, Key> = {
  Enter: 'Enter', ' ': 'Enter', Escape: 'Escape', Backspace: 'Escape', Tab: 'Tab',
  ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown',
  q: 'LB', Q: 'LB', e: 'RB', E: 'RB', x: 'X', X: 'X', y: 'Y', Y: 'Y',
};
const isTyping = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;

let shortcut: ((key: string) => boolean) | null = null;
export const setShortcutHandler = (fn: (key: string) => boolean) => { shortcut = fn; };

if (typeof window !== 'undefined') {
  addEventListener('keydown', e => {
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

let prev: boolean[] = [], axisAt = 0;
function poll() {
  const p = navigator.getGamepads?.()[connected?.index ?? 0];
  if (p) {
    const b = p.buttons.map(x => x.pressed), hit = (i: number) => b[i] && !prev[i]; prev = b;
    const nin = padKind() === 'nin';
    const map: Record<number, Key> = { 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight', [nin ? 1 : 0]: 'Enter', [nin ? 0 : 1]: 'Escape', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 9: 'Tab' };
    for (const i in map) if (hit(+i)) send(map[i]!);
    const now = performance.now(), [ax = 0, ay = 0] = p.axes;
    if (now - axisAt > 180 && (Math.abs(ax) > 0.6 || Math.abs(ay) > 0.6)) {
      axisAt = now;
      send(Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'ArrowRight' : 'ArrowLeft') : (ay > 0 ? 'ArrowDown' : 'ArrowUp'));
    }
  }
  requestAnimationFrame(poll);
}
if (typeof window !== 'undefined') requestAnimationFrame(poll);

type Act = 'ok' | 'back' | 'x' | 'y' | 'lb' | 'rb' | 'menu' | 'ud' | 'lr';
const PS: Record<string, ReactNode> = {
  ok: <svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5L5 15" stroke="#8fb0ff" strokeWidth="2.6" strokeLinecap="round" /></svg>,
  back: <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="5.2" fill="none" stroke="#ff6f6f" strokeWidth="2.4" /></svg>,
  x: <svg viewBox="0 0 20 20"><rect x="5" y="5" width="10" height="10" fill="none" stroke="#f08ad8" strokeWidth="2.4" /></svg>,
  y: <svg viewBox="0 0 20 20"><path d="M10 4.5l5.8 10H4.2z" fill="none" stroke="#4fd6a8" strokeWidth="2.3" strokeLinejoin="round" /></svg>,
};
const GL: Record<PadKind, Record<Act, string | [string, string] | ReactNode>> = {
  kb: { ok: 'Enter', back: 'Esc', x: 'X', y: 'Y', lb: 'Q', rb: 'E', menu: 'Tab', ud: '↑↓', lr: '←→' },
  xbox: { ok: ['A', '#6ad13a'], back: ['B', '#ff5a4f'], x: ['X', '#4a95ff'], y: ['Y', '#ffc928'], lb: 'LB', rb: 'RB', menu: '☰', ud: '✚', lr: '✚' },
  ps: { ok: PS.ok, back: PS.back, x: PS.x, y: PS.y, lb: 'L1', rb: 'R1', menu: 'OPTIONS', ud: '✚', lr: '✚' },
  nin: { ok: ['A', '#fff'], back: ['B', '#fff'], x: ['Y', '#fff'], y: ['X', '#fff'], lb: 'L', rb: 'R', menu: '+', ud: '✚', lr: '✚' },
};
export function Glyph({ a }: { a: Act }) {
  const k = usePadKind(), v = GL[k][a];
  if (k === 'kb') return <span className="gp kb">{v as string}</span>;
  if (Array.isArray(v) && typeof v[0] === 'string') return <span className="gp r" style={{ color: v[1] as string }}>{v[0]}</span>;
  if (typeof v === 'string') return <span className="gp pill">{v}</span>;
  return <span className="gp r">{v}</span>;
}
export function Hints({ items }: { items: [Act, string][] }) {
  return <footer className="hints">{items.map(([a, t]) => <span key={a + t}><Glyph a={a} />{t}</span>)}</footer>;
}
