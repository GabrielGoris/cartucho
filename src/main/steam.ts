import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';

export function steamManifest(...paths: (string | null | undefined)[]): { appid: string; name: string | null } | null {
  for (const p of paths) {
    const m = p?.match(/^(.*?[\\/]steamapps)[\\/]common[\\/]([^\\/]+)/i);
    if (!m) continue;
    const apps = m[1]!, folder = m[2]!.toLowerCase();
    let files: string[] = [];
    try { files = readdirSync(apps).filter(f => /^appmanifest_\d+\.acf$/i.test(f)); } catch { continue; }
    for (const f of files) {
      let t = '';
      try { t = readFileSync(join(apps, f), 'utf8'); } catch { continue; }
      const dir = t.match(/"installdir"\s+"([^"]+)"/i)?.[1], id = t.match(/"appid"\s+"(\d+)"/i)?.[1];
      if (dir && id && dir.toLowerCase() === folder) return { appid: id, name: t.match(/"name"\s+"([^"]+)"/i)?.[1]?.trim() || null };
    }
  }
  return null;
}

export function windowsAppData(installDir: string, exe: string | null | undefined, gameId?: string): string | null {
  if (!exe || !/\.exe$/i.test(exe)) return null;
  const roaming = (prefix: string, user: string) => join(prefix, 'drive_c', 'users', user, 'AppData', 'Roaming');
  if (gameId) { const own = roaming(join(prefixDir(gameId), 'pfx'), 'steamuser'); if (existsSync(own)) return own; }
  const steam = steamManifest(installDir, exe);
  const lib = (exe.match(/^(.*?[\\/]steamapps)[\\/]/i) ?? installDir.match(/^(.*?[\\/]steamapps)[\\/]/i))?.[1];
  if (steam && lib) { const p = roaming(join(lib, 'compatdata', steam.appid, 'pfx'), 'steamuser'); if (existsSync(p)) return p; }
  let user = ''; try { user = userInfo().username; } catch { }
  const wine = roaming(process.env.WINEPREFIX || join(homedir(), '.wine'), user);
  return existsSync(wine) ? wine : null;
}

export function steamRoots(home = homedir()) {
  return [join(home, '.local', 'share', 'Steam'), join(home, '.steam', 'steam'), join(home, '.steam', 'root')].filter(p => existsSync(join(p, 'steamapps')));
}

export function steamLibraries(root: string) {
  const out = new Set([join(root, 'steamapps')]);
  try {
    const t = readFileSync(join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    for (const m of t.matchAll(/"path"\s+"([^"]+)"/g)) out.add(join(m[1]!.replace(/\\\\/g, '\\'), 'steamapps'));
  } catch { }
  return [...out].filter(p => existsSync(p));
}

export function protonVersion(name: string) {
  const m = name.match(/(\d+)\.(\d+)/);
  return /experimental/i.test(name) ? 1e6 - 1 : m ? Number(m[1]) * 1000 + Number(m[2]) : -1;
}

export function findProton(home = homedir()): { proton: string; root: string } | null {
  for (const root of steamRoots(home)) {
    const found: { dir: string; v: number }[] = [];
    for (const lib of steamLibraries(root)) {
      const common = join(lib, 'common');
      let names: string[] = []; try { names = readdirSync(common); } catch { }
      for (const n of names) if (/^proton/i.test(n) && existsSync(join(common, n, 'proton'))) found.push({ dir: join(common, n), v: protonVersion(n) });
    }
    let tools: string[] = []; try { tools = readdirSync(join(root, 'compatibilitytools.d')); } catch { }
    for (const n of tools) if (existsSync(join(root, 'compatibilitytools.d', n, 'proton'))) found.push({ dir: join(root, 'compatibilitytools.d', n), v: protonVersion(n) - 0.5 });
    found.sort((a, b) => b.v - a.v);
    if (found[0]) return { proton: join(found[0].dir, 'proton'), root };
  }
  return null;
}

export const prefixDir = (gameId: string, home = homedir()) => join(process.env.XDG_DATA_HOME || join(home, '.local', 'share'), 'Cartucho', 'prefixos', gameId.replace(/[^\w-]/g, '_'));
