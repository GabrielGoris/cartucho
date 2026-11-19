/** Sons sintetizados na hora (nada de áudio copiado de console nenhum). */
import { getSettings } from './settings';

type Kind = 'move' | 'ok' | 'back' | 'boot';
let ctx: AudioContext | null = null;

export function initAudio() {
  if (!ctx) try { ctx = new AudioContext(); } catch { return; }
  if (ctx.state === 'suspended') void ctx.resume();
}
const vol = () => getSettings().vol / 100;
const enabled = () => getSettings().snd && !!ctx;

function tone(f: number, d: number, type: OscillatorType = 'sine', v = 0.05, wait = 0, f2?: number) {
  if (!enabled()) return;
  const t = ctx!.currentTime + wait, o = ctx!.createOscillator(), g = ctx!.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * vol(), t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g).connect(ctx!.destination); o.start(t); o.stop(t + d + 0.02);
}
function noise(d: number, v = 0.04, hp = 3000) {
  if (!enabled()) return;
  const b = ctx!.createBuffer(1, Math.floor(ctx!.sampleRate * d), ctx!.sampleRate), a = b.getChannelData(0);
  for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 2 - 1) * (1 - i / a.length);
  const s = ctx!.createBufferSource(), f = ctx!.createBiquadFilter(), g = ctx!.createGain();
  f.type = 'highpass'; f.frequency.value = hp; g.gain.value = v * vol();
  s.buffer = b; s.connect(f).connect(g).connect(ctx!.destination); s.start();
}
const arp = (ns: number[], type: OscillatorType, v: number, gap: number, d: number) => ns.forEach((f, i) => tone(f, d, type, v, i * gap));

// Fora dos consoles o Cartucho usa o som "soft"; cada hub terá o seu.
const SOFT: Record<Kind, () => void> = {
  move: () => tone(1480, 0.06, 'sine', 0.035),
  ok: () => arp([988, 1480], 'sine', 0.045, 0.05, 0.2),
  back: () => tone(740, 0.14, 'sine', 0.04),
  boot: () => [392, 494, 587, 784].forEach((f, i) => tone(f, 1.8, 'sine', 0.022, i * 0.14)),
};

export const sfx = {
  play(k: Kind) { SOFT[k](); },
  /** Vinheta da abertura: arpejo de 8 bits + "clique" do cartucho entrando. */
  jingle() {
    if (!getSettings().bootSnd) return;
    initAudio();
    arp([523, 659, 784, 1047, 1319], 'square', 0.025, 0.08, 0.14);
    tone(2093, 0.35, 'square', 0.02, 0.55); noise(0.04, 0.05, 1500);
  },
};
