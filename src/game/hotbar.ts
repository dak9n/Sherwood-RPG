// С расширением: модуль выполняют и браузер, и тесты, а node без него не найдёт.
import { ITEMS, type Stack } from './items.ts';

/**
 * Панель быстрого доступа.
 *
 * Логика чистая: ни Phaser, ни DOM — поэтому проверяется тестами.
 *
 * ГЛАВНОЕ РЕШЕНИЕ: ячейка помнит ВИД предмета (id), а не номер места в сумке.
 * Номера в сумке живут недолго — их меняет и подбор добычи, и кнопка
 * «Разложить». Привязка по номеру после первой же раскладки показывала бы
 * не то, и клавиша 1 вместо зелья пила бы что попало.
 */

/** Столько гнёзд нарисовано на планке в наборе — под клавиши 1-9 и 0. */
export const HOTBAR_SIZE = 10;

/** Что привязано к каждой ячейке. null — ячейка пуста. */
export type Hotbar = (string | null)[];

export const emptyHotbar = (): Hotbar => new Array<string | null>(HOTBAR_SIZE).fill(null);

/**
 * Можно ли класть предмет на панель.
 *
 * Кладём то, на что клик в сумке что-то делает: еду и снаряжение. Медный слиток
 * повесить нельзя — нажатие по нему не сделало бы ничего, а мёртвая клавиша
 * хуже пустой ячейки.
 */
export function canBind(id: string): boolean {
  const def = ITEMS[id];
  return !!def && (!!def.use || !!def.slot);
}

/**
 * Привязать предмет к ячейке.
 *
 * Если этот предмет уже висит в другой ячейке, ячейки меняются местами: один
 * вид — одна ячейка, иначе одна и та же еда расползлась бы по всей панели.
 */
export function bind(bar: Hotbar, slot: number, id: string): boolean {
  if (slot < 0 || slot >= bar.length) return false;
  if (!canBind(id)) return false;

  const was = bar.indexOf(id);
  const prev = bar[slot];
  bar[slot] = id;
  if (was >= 0 && was !== slot) bar[was] = prev;
  return true;
}

/** Переставить ячейки местами — перетаскиванием внутри самой панели. */
export function swap(bar: Hotbar, a: number, b: number): boolean {
  if (a < 0 || b < 0 || a >= bar.length || b >= bar.length) return false;
  [bar[a], bar[b]] = [bar[b], bar[a]];
  return true;
}

export function unbind(bar: Hotbar, slot: number): void {
  if (slot >= 0 && slot < bar.length) bar[slot] = null;
}

/**
 * Где в сумке лежит то, что привязано к ячейке. -1, если привязки нет или
 * предмет кончился.
 *
 * Привязку при этом НЕ снимаем: набрал грибов — и клавиша снова работает.
 */
export function findInBag(bar: Hotbar, slot: number, bag: (Stack | null)[]): number {
  const id = bar[slot];
  if (!id) return -1;
  return bag.findIndex((s) => s?.id === id);
}

/** Сколько таких предметов осталось: число на ячейке. */
export function countFor(bar: Hotbar, slot: number, bag: (Stack | null)[]): number {
  const id = bar[slot];
  if (!id) return 0;
  return bag.reduce((n, s) => n + (s?.id === id ? s.qty : 0), 0);
}
