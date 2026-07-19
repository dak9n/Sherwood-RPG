// С расширением: модуль выполняют и браузер, и тесты, а node без него не найдёт.
import { ITEMS, countOf, takeOne, type Stack } from './items.ts';

/**
 * Кузница: заточка оружия. Чистая логика — ни Phaser, ни DOM, поэтому под тестами.
 *
 * Каждая попытка съедает один свиток заточки (продаётся в магазине) и с шансом
 * поднимает оружие на +1. Шанс падает ступенями — так просил заказчик:
 * до +5 легко, дальше каждый уровень — азарт. Неудача СЖИГАЕТ свиток, но
 * заточку не сбрасывает: терять уровни обиднее, чем свитки, а игра у нас добрая.
 *
 * Заточка числится за КОНКРЕТНЫМ экземпляром оружия, а не за его видом: точишь
 * один меч — соседний такой же остаётся тупым. Уровень хранится на самом
 * предмете (`Stack.sharpen` в сумке, отдельное число у надетого) — см. items.ts
 * и сцену. Поэтому trySharpen не знает ни про какую карту: ей передают текущий
 * уровень ЭТОГО экземпляра, а новый она возвращает — применяет уже вызывающий.
 */

/** Выше этого не заточить. Так решил заказчик. */
export const SHARPEN_MAX = 20;

/** Что съедает одна попытка. Продаётся в магазине. */
export const SCROLL_ID = 'scroll_sharpen';

/**
 * Шанс успеха попытки на указанный УРОВЕНЬ (не с уровня, а НА уровень).
 * Ступени заказчика: до +5 — 80%, до +10 — 40%, до +15 — 20%, до +20 — 10%.
 */
export function sharpenChance(target: number): number {
  if (!Number.isInteger(target) || target < 1 || target > SHARPEN_MAX) return 0;
  if (target <= 5) return 0.8;
  if (target <= 10) return 0.4;
  if (target <= 15) return 0.2;
  return 0.1;
}

/** Прибавка к урону от заточки: +1 за уровень. Формулу знает и окно кузницы. */
export function sharpenBonus(plus: number | undefined): number {
  return Math.max(0, Math.min(SHARPEN_MAX, Math.floor(plus ?? 0)));
}

export type SharpenResult =
  | { ok: true; success: boolean; level: number; target: number }
  | { ok: false; reason: string };

/**
 * Попытка заточки ОДНОГО экземпляра оружия. Мутирует сумку (съедает свиток), но
 * НЕ трогает сам предмет: новый уровень возвращается в `level`, а проставляет его
 * вызывающий — тому виднее, надетое это оружие или ячейка сумки. rng параметром —
 * ради воспроизводимых тестов, как везде в игре.
 *
 * Свиток сгорает В ЛЮБОМ исходе попытки, но НЕ тратится, если попытка вообще
 * невозможна (нет оружия, предел, нет свитков): игрок не должен платить за
 * кнопку, которая ничего не могла сделать.
 */
export function trySharpen(
  currentPlus: number,
  weaponId: string | undefined,
  bag: (Stack | null)[],
  rng: () => number = Math.random,
): SharpenResult {
  if (!weaponId) return { ok: false, reason: 'equip a weapon' };
  // hasOwn, а не ITEMS[id]: id вроде 'constructor' вернул бы унаследованный
  // член прототипа — та же дыра, что уже закрыта в санации сейва.
  if (!Object.hasOwn(ITEMS, weaponId) || ITEMS[weaponId].slot !== 'weapon') {
    return { ok: false, reason: 'not sharpenable' };
  }

  const current = sharpenBonus(currentPlus);
  if (current >= SHARPEN_MAX) return { ok: false, reason: 'sharpened to the max' };

  if (countOf(bag, SCROLL_ID) < 1) return { ok: false, reason: 'no Sharpening Scrolls' };
  const at = bag.findIndex((s) => s && s.id === SCROLL_ID);
  takeOne(bag, at);

  const target = current + 1;
  const success = rng() < sharpenChance(target);

  return { ok: true, success, level: success ? target : current, target };
}
