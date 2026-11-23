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

import { hasBit, PadState } from '../src/main/linux';
import { bindsFor } from '../src/shared/binds';

describe('controle no Linux', () => {
  it('reconhece um controle pelos botões que ele declara', () => {
    expect(hasBit('7cdb000000000000 0 0 0', 0x130)).toBe(false);
    expect(hasBit('7cdb000000000000 0 0 0 0', 0x130)).toBe(true);
  });
  it('converte eventos do evdev no mesmo formato do XInput', () => {
    const s = new PadState(true);
    s.event(1, 0x13c, 1); s.event(1, 0x137, 1);
    expect(s.mask).toBe(0x0400 | 0x0200);
    s.event(3, 0x11, -1); expect(s.mask & 0x0001).toBe(1);
    s.event(3, 0x02, 200); expect(s.mask & 0x10000).toBe(0x10000);
    s.event(1, 0x13c, 0); s.event(3, 0x11, 0); s.event(3, 0x02, 0);
    expect(s.mask).toBe(0x0200);
  });
  it('acha os atalhos do mesmo controle mesmo com outro nome', () => {
    const all = { 'Xbox 360 pad (STANDARD GAMEPAD Vendor: 045e Product: 028e)': { shot: ['Select', 'Start'] } };
    expect(bindsFor(all, 'Microsoft X-Box 360 pad (STANDARD GAMEPAD Vendor: 045e Product: 028e)').shot).toEqual(['Select', 'Start']);
    expect(bindsFor(all, 'Outro (Vendor: 1234 Product: 5678)').shot).toEqual(['Home', 'RB']);
  });
});
