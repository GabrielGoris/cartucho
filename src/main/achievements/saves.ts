/**
 * Leitores dos arquivos onde cada recomp grava as conquistas desbloqueadas.
 * Todos são little-endian (gravados pelo próprio PC).
 */
import { Reader } from './binary';

export interface Unlock { id: number; at: number | null }   // at em ms; null quando o arquivo não guarda a data

/**
 * hedge-dev (UnleashedRecomp `ACH-DATA`, MarathonRecomp `SonicNextAchievementData.bin`), user/achievement_data.h:
 *   'ACH ' | version u32 | checksum u32 | reserved u32 | N × { id u16, time_t i64, reserved u16×3 }  (pack 1)
 * Registros com id 0 encerram a lista. O checksum é o XOR de todos os bytes dos registros.
 */
export function readHedgeAch(buf: Uint8Array): Unlock[] {
  const r = new Reader(buf, true);
  if (r.ascii(4) !== 'ACH ') throw new Error('arquivo de conquistas sem assinatura ACH');
  const version = r.u32(), checksum = r.u32(); r.u32();
  if (version !== 1) throw new Error(`versão de conquistas desconhecida (${version})`);
  if ((buf.byteLength - 16) % 16 !== 0) throw new Error('tamanho inesperado do arquivo de conquistas');
  let x = 0; for (let i = 16; i < buf.byteLength; i++) x ^= buf[i]!;
  if (x !== checksum) throw new Error('checksum das conquistas não confere (arquivo sendo gravado?)');
  const out: Unlock[] = [];
  while (r.remaining >= 16) {
    const id = r.u16(), t = r.i64(); r.skip(6);
    if (!id) break;
    out.push({ id, at: t > 0n ? Number(t) * 1000 : null });
  }
  return out;
}

/**
 * Oxygen Engine (Sonic 3 A.I.R.), oxygen/simulation/PersistentData.cpp:
 *   'OXY.PDATA' (9) | version u16 | count u32 | count × { key: len u32 + bytes, data: len u32 + bytes }
 * A chave "Achievements" guarda: count u32 | count × { id u32, state u32 }  (state ≠ 0 = conquistado)
 */
export function readOxygenAchievements(buf: Uint8Array): Unlock[] {
  const r = new Reader(buf, true);
  if (r.ascii(9) !== 'OXY.PDATA') throw new Error('não é um arquivo de dados do Oxygen Engine');
  const version = r.u16();
  if (version < 0x100 || version > 0x1ff) throw new Error(`versão de dados desconhecida (${version})`);
  const entries = r.u32();
  for (let i = 0; i < entries; i++) {
    const key = r.utf8(r.u32()), data = r.bytes(r.u32());
    if (key !== 'Achievements') continue;
    const d = new Reader(data, true), n = d.u32(), out: Unlock[] = [];
    for (let j = 0; j < n; j++) { const id = d.u32(), state = d.u32(); if (state) out.push({ id, at: null }); }
    return out;
  }
  return [];
}

/**
 * Retro Engine v4 (Sonic 1 e 2 de 2013), RSDKv4/Userdata.cpp `UData.bin`:
 *   64 × status i32 (100 = conquistado) | 128 × placar i32
 */
export function readRsdkUserdata(buf: Uint8Array): Unlock[] {
  const r = new Reader(buf, true), out: Unlock[] = [];
  for (let i = 0; i < 64 && r.remaining >= 4; i++) if (r.u32() === 100) out.push({ id: i, at: null });
  return out;
}
