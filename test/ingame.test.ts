import { describe, expect, it } from 'vitest';
import { Combos, padKeys, safeName } from '../src/main/ingame';

const xbox = (pressed: number[]) => ({ index: 0, id: 'Xbox Wireless Controller', mapping: 'standard', b: Array.from({ length: 17 }, (_, i) => (pressed.includes(i) ? '1' : '0')).join('') });
const ps2 = (pressed: number[]) => ({ index: 1, id: 'Twin USB Joystick (Vendor: 0810 Product: 0001)', mapping: '', b: Array.from({ length: 12 }, (_, i) => (pressed.includes(i) ? '1' : '0')).join('') });

describe('atalhos do controle durante o jogo', () => {
  it('só o botão Home chama o Cartucho', () => {
    const c = new Combos();
    expect(c.feed(0, padKeys(xbox([])))).toEqual([]);
    expect(c.feed(0, padKeys(xbox([16])))).toEqual(['summon']);
    expect(c.feed(0, padKeys(xbox([16])))).toEqual([]);
    const p = new Combos();
    p.feed(1, padKeys(ps2([])));
    expect([...p.feed(1, padKeys(ps2([8, 9]))), ...p.feed(1, padKeys(ps2([])))]).not.toContain('summon');
  });

  it('Select+Start tira a captura uma vez, também no adaptador de PS2', () => {
    const c = new Combos();
    c.feed(0, padKeys(xbox([])));
    expect(c.feed(0, padKeys(xbox([8])))).toEqual([]);
    expect(c.feed(0, padKeys(xbox([8, 9])))).toEqual(['shot']);
    expect(c.feed(0, padKeys(xbox([8, 9])))).toEqual([]);
    expect(c.feed(0, padKeys(xbox([])))).toEqual([]);
    c.feed(1, padKeys(ps2([])));
    expect(c.feed(1, padKeys(ps2([8, 9])))).toEqual(['shot']);
  });

  it('nome da pasta das capturas sem caracteres proibidos no Windows', () => {
    expect(safeName('Zelda: Majora\'s Mask?')).toBe("Zelda Majora's Mask");
    expect(safeName('...')).toBe('Jogo');
  });
});
