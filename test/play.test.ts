import { describe, expect, it } from 'vitest';
import { parseTasklist } from '../src/main/play';

describe('parseTasklist', () => {
  it('agrupa os PIDs pelo nome do executável, sem diferenciar maiúsculas', () => {
    const csv = '"System Idle Process","0","Services","0","8 K"\r\n"Zelda64Recompiled.exe","4120","Console","1","512.000 K"\r\n"zelda64recompiled.exe","5000","Console","1","10 K"\r\n"explorer.exe","900","Console","1","90.000 K"\r\n';
    const m = parseTasklist(csv);
    expect(m.get('zelda64recompiled.exe')).toEqual([4120, 5000]);
    expect(m.get('explorer.exe')).toEqual([900]);
  });

  it('ignora linhas que não são de processo', () => {
    expect(parseTasklist('INFO: No tasks are running which match the specified criteria.\r\n').size).toBe(0);
  });
});
