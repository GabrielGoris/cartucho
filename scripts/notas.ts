import { readFileSync, writeFileSync } from 'node:fs';
import { toConsoleId } from '../src/shared/consoles';
import { artPlatform } from '../src/main/artwork/service';
import { type Notas, wikidataScore } from '../src/main/artwork/info';

const [prevFile, outFile = 'notas.json'] = process.argv.slice(2);
const CATALOG = process.env.CARTUCHO_CATALOG_URL || 'https://recompendium.com/unricopie/catalogo.json';
const UA = 'Cartucho/1.0 (https://github.com/GabrielGoris/cartucho)';
const DAY = 86400_000, KEEP_FOUND = 30 * DAY, KEEP_MISSING = 7 * DAY;
const MAX = Number(process.env.NOTAS_MAX || 3000), PAUSE = Number(process.env.NOTAS_PAUSE ?? 150);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function json<T>(url: string): Promise<T> {
  for (let tries = 1; ; tries++) {
    await sleep(PAUSE);
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) }).catch(e => e as Error);
    if (!(r instanceof Error) && r.ok) return r.json() as Promise<T>;
    const busy = r instanceof Error || r.status === 429 || r.status >= 500;
    if (!busy || tries >= 4) throw new Error(r instanceof Error ? r.message : `erro ${r.status} em ${url}`);
    const wait = Number(!(r instanceof Error) && r.headers.get('retry-after')) || 5 * tries;
    await sleep(wait * 1000);
  }
}

interface Entry { entry?: string; nombre?: string; consola?: string | null; consola_nombre?: string | null; retirado?: boolean | null }

let prev: Notas = {};
try { if (prevFile) prev = JSON.parse(readFileSync(prevFile, 'utf8')) as Notas; } catch { prev = {}; }

const cat = await json<{ entradas?: Entry[] }>(CATALOG);
const now = Date.now(), out: Required<Notas> = { gerado: new Date(now).toISOString(), jogos: {} };
let asked = 0, found = 0, kept = 0, failed = 0;

for (const e of cat.entradas ?? []) {
  if (!e.entry || !e.nombre || e.retirado) continue;
  const old = prev.jogos?.[e.entry];
  if (old && now - old.t < (old.n ? KEEP_FOUND : KEEP_MISSING)) { out.jogos[e.entry] = old; kept++; continue; }
  if (asked >= MAX) { if (old) out.jogos[e.entry] = old; continue; }
  asked++;
  const cid = toConsoleId(e.consola), platform = artPlatform(cid, e.consola_nombre ?? e.consola ?? 'Outros');
  try {
    const n = await wikidataScore(json, e.nombre, platform);
    out.jogos[e.entry] = { n, t: now };
    if (n) found++;
  } catch (err) {
    failed++;
    if (old) out.jogos[e.entry] = old;
    console.warn(`${e.nombre}: ${(err as Error).message}`);
  }
}

writeFileSync(outFile, JSON.stringify(out));
const total = Object.keys(out.jogos).length, withScore = Object.values(out.jogos).filter(v => v.n).length;
console.log(`${total} jogos · ${withScore} com nota · ${asked} consultados agora (${found} com nota, ${failed} com erro) · ${kept} reaproveitados`);
