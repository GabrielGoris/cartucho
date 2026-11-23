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

export function windowsAppData(installDir: string, exe: string | null | undefined): string | null {
  if (!exe || !/\.exe$/i.test(exe)) return null;
  const roaming = (prefix: string, user: string) => join(prefix, 'drive_c', 'users', user, 'AppData', 'Roaming');
  const steam = steamManifest(installDir, exe);
  const lib = (exe.match(/^(.*?[\\/]steamapps)[\\/]/i) ?? installDir.match(/^(.*?[\\/]steamapps)[\\/]/i))?.[1];
  if (steam && lib) { const p = roaming(join(lib, 'compatdata', steam.appid, 'pfx'), 'steamuser'); if (existsSync(p)) return p; }
  let user = ''; try { user = userInfo().username; } catch { }
  const wine = roaming(process.env.WINEPREFIX || join(homedir(), '.wine'), user);
  return existsSync(wine) ? wine : null;
}
