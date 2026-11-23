import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBinaryKV, writeBinaryKV } from '../src/main/achievements/vdf';
import { achId, crackFiles, parseSchema, parseUserStats, readEmuUnlocks, scanCrack, steamEmu } from '../src/main/achievements/steam';
import { gogProductId } from '../src/main/achievements/gog';
import { adapterForDir } from '../src/main/achievements/adapters';

const tmp = () => mkdtempSync(join(tmpdir(), 'cart-ach-'));
const SCHEMA = writeBinaryKV({
  '620': {
    gamename: 'Portal 2', version: 3,
    stats: {
      '1': { type: 4, id: 1, bits: {
        '0': { name: 'ACH_SURVIVE', bit: 0, display: { name: { english: 'Survive', brazilian: 'Sobreviva', token: 'X' }, desc: { english: 'Stay alive' }, hidden: '0', icon: 'aa.jpg' } },
        '1': { name: 'ACH_WIN', bit: 1, display: { name: { english: 'Win' }, desc: { english: 'Win it' }, hidden: '1', icon: 'bb.jpg' } },
      } },
      '7': { type: 1, name: 'kills' },
    },
  },
});

describe('conquistas de PC', () => {
  it('lê KeyValues binário da Steam (ida e volta)', () => {
    const kv = parseBinaryKV(writeBinaryKV({ a: { b: 'x', n: 5, big: 9007199254740993n } }));
    expect(kv).toEqual({ a: { b: 'x', n: 5, big: 9007199254740993n } });
  });

  it('lista da Steam: nome em português quando tem, e só os stats de conquista', () => {
    const s = parseSchema(SCHEMA);
    expect(s.map(a => [a.api, a.stat, a.bit, a.name])).toEqual([['ACH_SURVIVE', '1', 0, 'Sobreviva'], ['ACH_WIN', '1', 1, 'Win']]);
    expect(s[1]!.hidden).toBe(true);
  });

  it('desbloqueios da Steam: campo de bits e datas por bit', () => {
    const user = writeBinaryKV({ cache: { crc: 123, '1': { data: 0b10, AchievementTimes: { '1': 1700000000 } } } });
    expect(parseUserStats(user, parseSchema(SCHEMA))).toEqual([{ id: achId('ACH_WIN'), at: 1700000000_000, name: 'ACH_WIN' }]);
  });

  it('Goldberg/GSE: achievements.json', () => {
    const buf = new TextEncoder().encode(JSON.stringify({ A: { earned: true, earned_time: 1600000000 }, B: { earned: false, earned_time: 0 } }));
    expect(readEmuUnlocks(buf)).toEqual([{ id: achId('A'), at: 1600000000_000, name: 'A' }]);
  });

  it('CODEX/RUNE: achievements.ini', () => {
    const ini = '[SteamAchievements]\nCount=2\n00000=A\n\n[A]\nAchieved=1\nCurProgress=0\nUnlockTime=1650000000\n\n[B]\nAchieved=0\nUnlockTime=0\n';
    expect(readEmuUnlocks(new TextEncoder().encode(ini))).toEqual([{ id: achId('A'), at: 1650000000_000, name: 'A' }]);
  });

  it('acha o número do jogo na pasta do crack e os arquivos de save', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'bin', 'steam_settings'), { recursive: true });
    writeFileSync(join(dir, 'bin', 'steam_settings', 'steam_appid.txt'), '1145360\n');
    writeFileSync(join(dir, 'bin', 'local_save.txt'), 'saves');
    const info = scanCrack(dir)!;
    expect(info.appid).toBe('1145360');
    const files = crackFiles({ installDir: dir, appData: join(dir, 'Roaming') }, info);
    expect(files).toContain(join(dir, 'Roaming', 'GSE Saves', '1145360', 'achievements.json'));
    expect(files).toContain(join(dir, 'bin', 'saves', '1145360', 'achievements.json'));
    expect(adapterForDir(dir)?.id).toBe('steam-emu');
  });

  it('lista que veio com o crack (steam_settings/achievements.json)', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'steam_settings', 'img'), { recursive: true });
    writeFileSync(join(dir, 'steam_emu.ini'), '[Settings]\nAppId=480\n');
    writeFileSync(join(dir, 'steam_settings', 'img', 'a.jpg'), Buffer.from([0xff, 0xd8, 1]));
    writeFileSync(join(dir, 'steam_settings', 'achievements.json'), JSON.stringify([{ name: 'A', displayName: { english: 'Alpha', brazilian: 'Alfa' }, description: 'd', icon: 'img/a.jpg' }]));
    const d = await steamEmu.definitions({ installDir: dir, appData: dir });
    expect(d.list).toEqual([{ id: achId('A'), name: 'Alfa', description: 'd', points: null }]);
    expect(d.images?.get(achId('A'))?.[0]).toBe(0xff);
  });

  it('jogo da GOG pelo goggame-*.info', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'goggame-1207658924.info'), JSON.stringify({ gameId: '1207658924', name: 'x' }));
    expect(gogProductId(dir)).toBe('1207658924');
    expect(adapterForDir(dir)?.id).toBe('gog');
  });
});
