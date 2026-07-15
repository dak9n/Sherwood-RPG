// С расширением: модуль выполняют и браузер, и тесты, а node без него не найдёт.
import { ITEMS, type EquipSlot, type Stack } from './items.ts';

/**
 * Надетые вещи. Логика чистая: ни Phaser, ни DOM — поэтому проверяется тестами.
 */
export type Equipped = Partial<Record<EquipSlot, string>>;

/** Слоты в том порядке, в каком они стоят в панели персонажа. */
export const SLOTS: { id: EquipSlot; label: string }[] = [
  { id: 'helm', label: 'Шлем' },
  { id: 'amulet', label: 'Амулет' },
  { id: 'body', label: 'Броня' },
  { id: 'ring', label: 'Кольцо' },
  { id: 'weapon', label: 'Оружие' },
  { id: 'shield', label: 'Щит' },
  { id: 'boots', label: 'Сапоги' },
];

export interface Bonuses {
  dmg: number;
  def: number;
  speed: number;
  hp: number;
  mp: number;
}

/** Что в сумме дают надетые вещи. */
export function totalBonuses(eq: Equipped): Bonuses {
  const sum: Bonuses = { dmg: 0, def: 0, speed: 0, hp: 0, mp: 0 };

  for (const id of Object.values(eq)) {
    const bonus = id ? ITEMS[id]?.bonus : undefined;
    if (!bonus) continue;
    sum.dmg += bonus.dmg ?? 0;
    sum.def += bonus.def ?? 0;
    sum.speed += bonus.speed ?? 0;
    sum.hp += bonus.hp ?? 0;
    sum.mp += bonus.mp ?? 0;
  }

  return sum;
}

export interface EquipResult {
  ok: boolean;
  /** Что сняли, если слот был занят: вернётся в сумку. */
  removed?: string;
  reason?: string;
}

/**
 * Надеть предмет из ячейки сумки.
 *
 * Ячейка освобождается, а то, что было надето, кладётся на её место — обмен
 * один в один. Так вещь не может ни потеряться, ни размножиться.
 */
export function equipFromBag(bag: (Stack | null)[], index: number, eq: Equipped): EquipResult {
  const stack = bag[index];
  if (!stack) return { ok: false, reason: 'пусто' };

  const def = ITEMS[stack.id];
  if (!def?.slot) return { ok: false, reason: 'это не надевается' };

  const removed = eq[def.slot];
  eq[def.slot] = stack.id;

  // Надеваемое всегда лежит по одной штуке — за этим следит тест таблицы.
  bag[index] = removed ? { id: removed, qty: 1 } : null;

  return { ok: true, removed };
}

/**
 * Снять вещь и положить в сумку.
 *
 * Если места нет — вещь остаётся надетой: раздевать игрока в никуда нельзя.
 */
export function unequip(
  eq: Equipped,
  slot: EquipSlot,
  putInBag: (id: string) => boolean,
): EquipResult {
  const id = eq[slot];
  if (!id) return { ok: false, reason: 'слот пуст' };

  if (!putInBag(id)) return { ok: false, reason: 'сумка полна' };

  delete eq[slot];
  return { ok: true, removed: id };
}
