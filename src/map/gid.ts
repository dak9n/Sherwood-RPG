/**
 * Номер тайла в карте (raw) — это номер тайла плюс флаги отражения в трёх старших битах.
 * Кодировка досталась от Tiled; читать её при рендере не нужно, для этого есть
 * Phaser.Tilemaps.Parsers.Tiled.ParseGID.
 */

export const FLIP_H = 0x80000000;
export const FLIP_V = 0x40000000;
export const FLIP_D = 0x20000000;

const GID_MASK = 0x1fffffff;

export interface Flips {
  h: boolean;
  v: boolean;
  d: boolean;
}

export function unpackGid(raw: number): { gid: number; flips: Flips } {
  return {
    gid: raw & GID_MASK,
    flips: {
      h: (raw & FLIP_H) !== 0,
      v: (raw & FLIP_V) !== 0,
      d: (raw & FLIP_D) !== 0,
    },
  };
}

export function packGid(gid: number, flips: Partial<Flips> = {}): number {
  let raw = gid & GID_MASK;
  if (flips.h) raw |= FLIP_H;
  if (flips.v) raw |= FLIP_V;
  if (flips.d) raw |= FLIP_D;
  // Без >>> 0 результат уедет в минус: в JS битовые операции знаковые, а в карте
  // есть значения до 3221233965. Отрицательное число запишется в json молча.
  return raw >>> 0;
}
