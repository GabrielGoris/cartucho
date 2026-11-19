export const clockStr = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export const fmtDate = (ms: number) => new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
export function ago(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'agora'; if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60); if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24); if (d === 1) return 'ontem'; if (d < 30) return `há ${d} dias`;
  return `há ${Math.round(d / 30)} ${d < 60 ? 'mês' : 'meses'}`;
}
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** Matiz estável a partir de um texto (capas geradas para jogos sem arte). */
export function hueOf(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
export const initials = (t: string) => t.replace(/^The /, '').replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(w => w.length > 2 || /\d/.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase();
