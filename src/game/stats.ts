// С расширением: модуль выполняют и браузер, и тесты, а node без него не найдёт.
import { xpToNext } from './creatures.ts';

/**
 * Очки характеристик: за уровень дают три, игрок вкладывает их сам.
 *
 * Логика чистая: ни Phaser, ни DOM — поэтому проверяется тестами.
 *
 * Очки идут СВЕРХ обычного роста: уровень по-прежнему сам добавляет здоровье,
 * ману и урон. Так вложения — это выбор, а не обязанность: игрок, который не
 * открыл окно, всё равно становится сильнее и не оказывается наказан.
 */

export type Stat = 'dmg' | 'hp' | 'mp' | 'def';

export const POINTS_PER_LEVEL = 3;

/**
 * Что даёт одно очко. Числа взяты не с потолка: здоровье и мана совпадают с тем,
 * что уровень добавляет сам (+10 и +5), а урон и защита — с шагом снаряжения
 * (меч даёт +3, шлем +1). Очко должно ощущаться как треть уровня, не больше.
 */
export const STATS: { id: Stat; label: string; per: number; hint: string }[] = [
  { id: 'dmg', label: 'Атака', per: 1, hint: '+1 к урону за очко' },
  { id: 'hp', label: 'Здоровье', per: 10, hint: '+10 к запасу здоровья за очко' },
  { id: 'mp', label: 'Мана', per: 5, hint: '+5 к запасу маны за очко' },
  { id: 'def', label: 'Защита', per: 1, hint: '+1 к защите за очко' },
];

/** Сколько очков вложено в каждую характеристику. */
export type Spent = Record<Stat, number>;

export const emptySpent = (): Spent => ({ dmg: 0, hp: 0, mp: 0, def: 0 });

/** Сколько очков выдано всего за путь до этого уровня. На первом — ноль. */
export function earned(level: number): number {
  return Math.max(0, level - 1) * POINTS_PER_LEVEL;
}

const used = (spent: Spent): number => STATS.reduce((n, s) => n + spent[s.id], 0);

/** Сколько очков осталось потратить. */
export function unspent(level: number, spent: Spent): number {
  return earned(level) - used(spent);
}

/**
 * Вложить очко. Возвращает false, если вкладывать нечего.
 *
 * Отказ молчаливый по смыслу, но не по последствиям: интерфейс обязан показать
 * игроку, что кнопка не сработала, — иначе он будет жать её и гадать.
 */
export function spendPoint(spent: Spent, stat: Stat, level: number): boolean {
  if (unspent(level, spent) <= 0) return false;
  spent[stat]++;
  return true;
}

export interface StatBonus {
  dmg: number;
  hp: number;
  mp: number;
  def: number;
}

/** Во что превратились вложенные очки. */
export function bonusFrom(spent: Spent): StatBonus {
  const out: StatBonus = { dmg: 0, hp: 0, mp: 0, def: 0 };
  for (const s of STATS) out[s.id] = spent[s.id] * s.per;
  return out;
}

/**
 * Уровень по накопленному опыту — для проверки, что очки не разъехались с
 * ростом. Считает тем же шагом, что и сама игра при получении уровня.
 */
export function levelFromXp(totalXp: number): number {
  let level = 1;
  let left = totalXp;
  while (left >= xpToNext(level)) {
    left -= xpToNext(level);
    level++;
  }
  return level;
}
