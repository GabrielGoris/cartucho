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

// Cada console tem o seu jeito de soar; fora deles o Cartucho usa o "soft".
type Profile = Record<Kind, () => void>;
const PROFILES: Record<string, Profile> = {
  square: { move: () => tone(1200, 0.04, 'square', 0.025), ok: () => arp([784, 1175], 'square', 0.03, 0.06, 0.08), back: () => tone(392, 0.09, 'square', 0.03, 0, 260), boot: () => arp([523, 659, 784, 1047, 1319], 'square', 0.025, 0.08, 0.14) },
  tri: { move: () => tone(660, 0.06, 'triangle', 0.07), ok: () => arp([523, 784, 1047], 'triangle', 0.07, 0.05, 0.1), back: () => tone(440, 0.12, 'triangle', 0.07, 0, 220), boot: () => { arp([262, 330, 392, 523], 'triangle', 0.07, 0.12, 0.5); tone(1047, 1.2, 'sine', 0.03, 0.5); } },
  deep: { move: () => tone(880, 0.05, 'sine', 0.04), ok: () => tone(1320, 0.18, 'sine', 0.05), back: () => tone(440, 0.15, 'sine', 0.04), boot: () => { tone(55, 2.2, 'sine', 0.12, 0, 110); tone(880, 1.8, 'sine', 0.02, 0.4); tone(1320, 1.6, 'sine', 0.015, 0.7); } },
  soft: { move: () => tone(1480, 0.06, 'sine', 0.035), ok: () => arp([988, 1480], 'sine', 0.045, 0.05, 0.2), back: () => tone(740, 0.14, 'sine', 0.04), boot: () => [392, 494, 587, 784].forEach((f, i) => tone(f, 1.8, 'sine', 0.022, i * 0.14)) },
  bubble: { move: () => tone(900, 0.07, 'sine', 0.05, 0, 1400), ok: () => tone(600, 0.14, 'sine', 0.06, 0, 1600), back: () => tone(1200, 0.12, 'sine', 0.05, 0, 500), boot: () => arp([523, 698, 880, 1047], 'sine', 0.05, 0.1, 0.3) },
  click: { move: () => noise(0.025, 0.05, 4000), ok: () => { noise(0.03, 0.06, 2500); tone(1600, 0.05, 'triangle', 0.03); }, back: () => tone(700, 0.06, 'triangle', 0.04, 0, 500), boot: () => { noise(0.05, 0.05); tone(1046, 0.12, 'triangle', 0.04, 0.08); tone(1568, 0.2, 'triangle', 0.04, 0.16); } },
};
let profile = 'soft';
/** O hub de cada console troca o perfil de som enquanto está aberto. */
export const setSfxProfile = (p: string) => { profile = PROFILES[p] ? p : 'soft'; };

export const sfx = {
  play(k: Kind) { PROFILES[profile]![k](); },
  /** Vinheta da abertura: arpejo de 8 bits + "clique" do cartucho entrando. */
  jingle() {
    if (!getSettings().bootSnd) return;
    initAudio();
    arp([523, 659, 784, 1047, 1319], 'square', 0.025, 0.08, 0.14);
    tone(2093, 0.35, 'square', 0.02, 0.55); noise(0.04, 0.05, 1500);
  },
};
