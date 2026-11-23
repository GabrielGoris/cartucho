import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { steamManifest } from '../src/main/steam';

describe('jogos da Steam', () => {
  it('pega o nome do jogo no manifesto, não o nome da pasta', () => {
    const lib = join(mkdtempSync(join(tmpdir(), 'steam-')), 'steamapps');
    const dir = join(lib, 'common', 'CONCRETE FUNERAL');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(lib, 'appmanifest_123.acf'), '"AppState"\n{\n\t"appid"\t\t"123"\n\t"name"\t\t"Concrete Burial"\n\t"installdir"\t\t"CONCRETE FUNERAL"\n}\n');
    expect(steamManifest(dir)).toEqual({ appid: '123', name: 'Concrete Burial' });
    expect(steamManifest(join(dir, 'BrutalistHorror.exe'))).toEqual({ appid: '123', name: 'Concrete Burial' });
    expect(steamManifest(join(lib, 'common', 'Outro'))).toBeNull();
  });
});

import { parseWmctrl, winePath } from '../src/main/play';
import { desktopEntry } from '../src/main/background';

describe('Linux', () => {
  it('entende o caminho de um jogo rodando pelo Proton/Wine', () => {
    expect(winePath('Z:\\home\\g\\.local\\share\\Steam\\steamapps\\common\\Jogo\\Jogo.exe')).toBe('/home/g/.local/share/Steam/steamapps/common/Jogo/Jogo.exe');
    expect(winePath('/home/g/Jogo/Jogo.exe')).toBe('/home/g/Jogo/Jogo.exe');
    expect(winePath('C:\\windows\\system32\\steam.exe')).toBeNull();
  });
  it('lê o título das janelas pelo wmctrl', () => {
    const m = parseWmctrl('0x04400003  0 4242   pc DuckStation - Castlevania: Symphony of the Night\n0x0480000a -1 99 pc Painel', new Map([[4242, '/usr/bin/duckstation-qt']]));
    expect(m.get(4242)).toEqual({ path: '/usr/bin/duckstation-qt', title: 'DuckStation - Castlevania: Symphony of the Night' });
    expect(m.has(99)).toBe(false);
  });
  it('gera o atalho .desktop', () => {
    const e = desktopEntry({ name: 'Zelda', comment: 'Zelda pelo Cartucho', args: '--play abc', icon: '/x/icon.png' });
    expect(e).toContain('Name=Zelda');
    expect(e).toMatch(/^Exec=".+" .*--play abc$/m);
  });
});
