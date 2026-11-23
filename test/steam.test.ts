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
