// С расширением: модуль выполняют и браузер, и тесты, а node без него не найдёт.
import { ITEMS, countOf, type EquipSlot, type Stack } from './items.ts';

/** Меч, с которым герой начинает игру. У каждого героя он есть — см. ensureStarterWeapon. */
export const STARTER_WEAPON = 'sword_basic';

/**
 * Надетые вещи. Логика чистая: ни Phaser, ни DOM — поэтому проверяется тестами.
 */
export type Equipped = Partial<Record<EquipSlot, string>>;

/** Слоты в том порядке, в каком они стоят в панели персонажа. */
export const SLOTS: { id: EquipSlot; label: string }[] = [
  { id: 'helm', label: 'Helmet' },
  { id: 'amulet', label: 'Amulet' },
  { id: 'body', label: 'Body' },
  { id: 'ring', label: 'Ring' },
  { id: 'weapon', label: 'Weapon' },
  { id: 'shield', label: 'Shield' },
  { id: 'gloves', label: 'Gloves' },
  { id: 'boots', label: 'Boots' },
];

/**
 * Как гнёзда разложены вокруг портрета: колонка слева и колонка справа.
 *
 * Живёт здесь, а не в окне: окно тянет DOM и тестами не проверяется, а раскладка
 * обязана покрывать ВСЕ слоты. Забыть слот в колонке — значит сделать вещь,
 * которую можно надеть и нельзя снять: гнезда для неё на экране нет. За этим
 * следит тест — добавишь слот в SLOTS и не добавишь сюда, он упадёт.
 */
export const LEFT_SLOTS: EquipSlot[] = ['helm', 'amulet', 'body', 'ring'];
export const RIGHT_SLOTS: EquipSlot[] = ['weapon', 'shield', 'gloves', 'boots'];

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

/**
 * В каком слоте надет этот предмет прямо сейчас. undefined — не надет.
 *
 * Нужно панели быстрого доступа: надетый меч лежит не в сумке, и без этой
 * проверки панель показывала бы его как потерянный.
 */
export function slotWearing(eq: Equipped, id: string): EquipSlot | undefined {
  return (Object.keys(eq) as EquipSlot[]).find((s) => eq[s] === id);
}

/**
 * Дать герою стартовый меч, если оружия у него нет.
 *
 * «У каждого героя есть меч» — так просил заказчик. Новый герой начинает с ним
 * в руке; старым сейвам (сделанным до того, как меч вообще появился) он
 * выдаётся при загрузке. Возвращает true, если меч пришлось выдать.
 *
 * Не выдаём второй, если такой меч уже лежит в сумке: иначе каждая загрузка
 * плодила бы новобранческие мечи. Проверяем именно этот меч, а не «любое оружие»:
 * пустое гнездо при мече в сумке значит, что игрок его снял, — вернём тот же.
 */
export function ensureStarterWeapon(eq: Equipped, bag: (Stack | null)[]): boolean {
  if (eq.weapon) return false;
  if (countOf(bag, STARTER_WEAPON) > 0) return false;
  eq.weapon = STARTER_WEAPON;
  return true;
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
  if (!stack) return { ok: false, reason: 'empty' };

  const def = ITEMS[stack.id];
  if (!def?.slot) return { ok: false, reason: 'not equippable' };

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
  if (!id) return { ok: false, reason: 'slot empty' };

  if (!putInBag(id)) return { ok: false, reason: 'bag full' };

  delete eq[slot];
  return { ok: true, removed: id };
}
