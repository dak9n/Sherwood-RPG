// С расширением: модуль выполняют и браузер, и тесты, а node без него не найдёт.
import { ITEMS, addToBag, roomFor, type Stack } from './items.ts';
import { STARTER_WEAPON } from './equipment.ts';

/**
 * Магазин. Чистая логика: ни Phaser, ни DOM — поэтому под тестами.
 *
 * Золото падает с монстров (см. creatures.ts). Здесь его тратят и возвращают:
 * покупают предметы и продают лишнее. Заказчик выбрал и покупку, и продажу.
 *
 * Покупка — по одной штуке за клик: так не ошибиться с местом в сумке.
 * Продажа — целыми стопками через корзину: игрок отбирает вещи в окне
 * (кликом по инвентарю), потом продаёт всё разом.
 */

/**
 * Ценность предмета в золоте. От неё считаются обе цены: покупка — по ней же,
 * продажа — доля от неё. Держим ОДНО число на предмет: две несвязанные цены
 * рано или поздно разъедутся, и дешёвый на вид предмет продавался бы дороже,
 * чем покупается, — это дыра для бесконечного золота.
 *
 * Объект без прототипа: id приходит из сумки, а она хоть и чищена (save.ts),
 * но лишний Object.hasOwn на чужой ключ дешевле, чем однажды словить member
 * из Object.prototype. За полноту (значение есть у каждого предмета) следит тест.
 */
export const VALUE: Record<string, number> = Object.assign(Object.create(null), {
  mush_red: 5,
  mush_brown: 4,
  apple: 6,
  potion_hp: 25,
  potion_mp: 20,
  ore_copper: 15,
  crystal: 40,
  sword_basic: 10,
  bow: 120,
  sword: 90,
  sword_blue: 220,
  shield: 70,
  helm: 110,
  armor: 150,
  boots: 60,
  ring: 90,
  amulet: 160,
});

/** Что стоит на витрине и в каком порядке. Только эти предметы можно купить. */
export const SHOP_STOCK: string[] = ['potion_hp', 'potion_mp', 'apple', 'bow', 'sword', 'shield', 'boots', 'helm'];

/** Доля ценности, которую даёт лавка при продаже. Разница с покупкой — её навар. */
const SELL_RATE = 0.4;

const valueOf = (id: string): number => (Object.hasOwn(VALUE, id) ? VALUE[id] : 0);

/** Цена покупки. null — предмет не продаётся в лавке. */
export function buyPrice(id: string): number | null {
  return SHOP_STOCK.includes(id) ? valueOf(id) : null;
}

/** Сколько дадут за штуку при продаже. 0 — продать нельзя. */
export function sellPrice(id: string): number {
  // Стартовый меч не продаётся: его бесплатно и заново выдаёт ensureStarterWeapon
  // при загрузке, если оружия нет. Позволь его продать — и «снял, продал, перезашёл,
  // получил новый» стало бы бесконечным золотом. Меч привязан к герою.
  if (id === STARTER_WEAPON) return 0;
  const v = valueOf(id);
  return v > 0 ? Math.max(1, Math.floor(v * SELL_RATE)) : 0;
}

export type BuyResult = { ok: true; gold: number; price: number } | { ok: false; reason: string };

/**
 * Купить одну штуку. Возвращает НОВОЕ золото; сумку мутирует, только если покупка
 * состоялась. Золото не списываем, пока не убедились, что предмет и по карману,
 * и влезает в сумку, — иначе игрок терял бы золото за воздух.
 */
export function buyItem(gold: number, bag: (Stack | null)[], id: string): BuyResult {
  const price = buyPrice(id);
  if (price == null || !Object.hasOwn(ITEMS, id)) return { ok: false, reason: 'этого нет в лавке' };
  if (gold < price) return { ok: false, reason: 'не хватает золота' };
  if (roomFor(bag, id) < 1) return { ok: false, reason: 'сумка полна' };

  addToBag(bag, id, 1);
  return { ok: true, gold: gold - price, price };
}

export type SellStackResult =
  | { ok: true; gold: number; id: string; qty: number; total: number }
  | { ok: false; reason: string };

/**
 * Продать ВСЮ стопку из ячейки разом. Для корзины продажи: игрок отбирает вещи,
 * жмёт «продать выбранное», и каждая уходит целиком. Ячейка пустеет, золото
 * прибавляется на цену за штуку, помноженную на количество.
 */
export function sellStack(gold: number, bag: (Stack | null)[], index: number): SellStackResult {
  const slot = bag[index];
  if (!slot) return { ok: false, reason: 'пусто' };

  const price = sellPrice(slot.id);
  if (price <= 0) return { ok: false, reason: 'это не продать' };

  const total = price * slot.qty;
  const { id, qty } = slot;
  bag[index] = null;
  return { ok: true, gold: gold + total, id, qty, total };
}

