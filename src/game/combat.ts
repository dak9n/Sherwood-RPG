import type { Dir } from './dir';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Прямоугольник удара перед существом.
 *
 * Координата существа — его ноги (origin 0.5/0.75), поэтому зона строится от
 * ног, а не от центра спрайта. Удары вбок бьют на уровне корпуса — чуть выше
 * ног; вверх и вниз зона уже, но глубже.
 *
 * @param x ноги существа
 * @param y ноги существа
 * @param reach на сколько пикселей достаёт
 * @param w ширина зоны поперёк удара
 */
export function hitRect(x: number, y: number, dir: Dir, reach: number, w: number): Rect {
  switch (dir) {
    case 'right':
      return { x, y: y - 14, w: reach, h: w };
    case 'left':
      return { x: x - reach, y: y - 14, w: reach, h: w };
    case 'down':
      return { x: x - w / 2, y, w, h: reach - 6 };
    case 'up':
      return { x: x - w / 2, y: y - reach + 2, w, h: reach - 6 };
  }
}

/** Квадрат расстояния: корень тут не нужен, а стоит он дороже сравнения. */
export function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Урон обычного взмаха: с разбросом, чтобы удары не были под копирку. */
export function rollDamage(min: number, max: number, rng: () => number = Math.random): number {
  return Math.round(min + rng() * (max - min));
}

/**
 * Урон умения «Огненный шар» (слот 1). Растёт с уровнем героя, как и удар. Здесь,
 * а не в fireball.ts, чтобы формулу можно было проверить без Phaser (тот файл
 * тянет движок и параметр-свойства конструктора, которые тесты не грузят).
 */
export function fireballDamage(level: number): number {
  return 16 + Math.max(0, Math.floor(level) - 1) * 3;
}

/**
 * Урон одной волны умения «Град стрел» (слот 2). За залп волн RAIN_TICKS, так что
 * монстр под всем градом получает примерно вчетверо больше — но это AoE и стоит
 * дольше перезаряжается. Растёт с уровнем героя. Тоже здесь, а не в arrow-rain.ts
 * (тот тянет Phaser), — чтобы формулу проверяли тесты.
 */
export function arrowRainDamage(level: number): number {
  return 4 + Math.max(0, Math.floor(level) - 1) * 2;
}
