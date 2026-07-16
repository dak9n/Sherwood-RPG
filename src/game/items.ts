/**
 * Предметы. Единственное место, где они описываются.
 *
 * Как и характеристики существ, это данные, а не код: добавить предмет — значит
 * дописать строку. Файл намеренно не знает про Phaser, поэтому проверяется
 * тестами без браузера.
 */

export type Tab = 'weapon' | 'armor' | 'resource' | 'food';
export type EquipSlot = 'helm' | 'body' | 'weapon' | 'shield' | 'boots' | 'ring' | 'amulet';

/**
 * Редкость. Красит рамку ячейки, но это не украшение: цвет обязан совпадать с
 * тем, как трудно предмет достать. За этим следит тест — иначе синяя рамка на
 * первом попавшемся грибе врала бы игроку.
 */
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic';

/**
 * Кусок картинки: прямоугольник, а не номер в сетке.
 *
 * Иконки лежат неровно: в Icons.png сетка 16x16, а грибы приходится резать из
 * тайлсета карты кусками 14x12 — они там нарисованы вместе с травой.
 */
export interface Icon {
  /**
   * Какой лист: 'icons' — набор интерфейса, 'Objects' — тайлсет карты,
   * 'scroll' — наш дорисованный свиток (в наборе свитка не оказалось нигде,
   * пришлось нарисовать самим в палитре набора: assets/interface/ui/scroll.png).
   */
  sheet: 'icons' | 'Objects' | 'scroll';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ItemDef {
  id: string;
  name: string;
  tab: Tab;
  /** Как выглядит в сумке. */
  icon: Icon;
  /** Как лежит на земле. У грибов — вместе с травой: на земле она уместна. */
  world?: Icon;
  /** Сколько влезает в одну ячейку. */
  stack: number;
  /** Что делает, если применить. */
  use?: { hp?: number; mp?: number };
  /** Насколько трудно достать. Без указания — обычное. */
  rarity?: Rarity;
  /** Куда надевается. */
  slot?: EquipSlot;
  /** Что даёт надетым. */
  bonus?: { dmg?: number; def?: number; speed?: number; hp?: number; mp?: number };
  /**
   * Оружие дальнего боя: надетым превращает взмах в выстрел стрелой в сторону
   * курсора. Стрелы бесконечны — отдельного боезапаса нет (так решил заказчик).
   */
  ranged?: boolean;
}

/** Стреляет ли надетое этим оружие. Лук — да, меч — нет. */
export const isRanged = (id: string | undefined): boolean =>
  !!(id && Object.hasOwn(ITEMS, id) && ITEMS[id].ranged);

/**
 * Иконка из набора интерфейса: там сетка 16x16.
 *
 * ОСТОРОЖНО: сетка ровная только в рядах 0-10 и 17-18. Ряды 11-16 нарисованы на
 * сетке 32x32 — обращение к ним через ico() даст четвертинку большой картинки.
 * Исключение — слитки в правом нижнем углу той области: (4,15), (5,15), (4,16),
 * (5,16) лежат честными клетками 16x16.
 */
const ico = (col: number, row: number): Icon => ({ sheet: 'icons', x: col * 16, y: row * 16, w: 16, h: 16 });

/**
 * Грибы режутся из тайлсета карты Objects.png — в наборе интерфейса грибов нет,
 * а пауки у нас грибные, и ронять они должны грибы.
 *
 * Иконка берётся без травы (0 зелёных пикселей в этом прямоугольнике), а на
 * земле гриб рисуется вместе с ней — так он выглядит частью леса.
 */
const MUSH_RED: Icon = { sheet: 'Objects', x: 440, y: 374, w: 14, h: 12 };
const MUSH_RED_WORLD: Icon = { sheet: 'Objects', x: 440, y: 374, w: 16, h: 19 };
const MUSH_BROWN: Icon = { sheet: 'Objects', x: 440, y: 406, w: 15, h: 12 };
const MUSH_BROWN_WORLD: Icon = { sheet: 'Objects', x: 440, y: 406, w: 16, h: 19 };

export const ITEMS: Record<string, ItemDef> = {
  mush_red: {
    id: 'mush_red', name: 'Красный гриб', tab: 'food',
    icon: MUSH_RED, world: MUSH_RED_WORLD, stack: 99, use: { hp: 30 },
  },
  mush_brown: {
    id: 'mush_brown', name: 'Бурый гриб', tab: 'food',
    icon: MUSH_BROWN, world: MUSH_BROWN_WORLD, stack: 99, use: { mp: 25 },
  },
  apple: { id: 'apple', name: 'Яблоко', tab: 'food', icon: ico(5, 5), stack: 20, use: { hp: 12 } },
  potion_hp: {
    id: 'potion_hp', name: 'Зелье здоровья', tab: 'food',
    icon: ico(5, 17), stack: 10, use: { hp: 60 }, rarity: 'uncommon',
  },
  potion_mp: {
    id: 'potion_mp', name: 'Зелье маны', tab: 'food',
    icon: ico(4, 17), stack: 10, use: { mp: 40 }, rarity: 'uncommon',
  },

  // Слиток, а не руда: руды в наборе нет вовсе, а называть слиток рудой — врать
  // на ровном месте.
  ore_copper: { id: 'ore_copper', name: 'Медный слиток', tab: 'resource', icon: ico(4, 16), stack: 99 },
  crystal: { id: 'crystal', name: 'Кристалл', tab: 'resource', icon: ico(5, 10), stack: 99, rarity: 'uncommon' },

  // Меч новобранца — с ним герой начинает игру. Раньше меча не было вовсе:
  // персонаж махал и наносил урон, а в сумке оружия не было, и это сбивало с
  // толку. Бонус НУЛЕВОЙ намеренно: урон обычного взмаха уже заложен в HERO.dmg,
  // и этот меч не добавляет силы, а лишь делает её видимой — оружием в руке.
  sword_basic: {
    id: 'sword_basic', name: 'Меч новобранца', tab: 'weapon',
    icon: ico(1, 0), stack: 1, slot: 'weapon',
  },
  // Лук — оружие дальнего боя. Надетым превращает взмах в выстрел стрелой в
  // сторону курсора. Урон чуть выше базового меча, но бить приходится издалека
  // и целиться. Стрелы бесконечны (так решил заказчик).
  bow: {
    id: 'bow', name: 'Лук', tab: 'weapon',
    icon: ico(3, 7), stack: 1, slot: 'weapon', ranged: true, bonus: { dmg: 2 }, rarity: 'uncommon',
  },
  sword: {
    id: 'sword', name: 'Стальной меч', tab: 'weapon',
    icon: ico(0, 8), stack: 1, slot: 'weapon', bonus: { dmg: 3 }, rarity: 'uncommon',
  },
  sword_blue: {
    id: 'sword_blue', name: 'Синий меч', tab: 'weapon',
    icon: ico(3, 8), stack: 1, slot: 'weapon', bonus: { dmg: 6 }, rarity: 'epic',
  },
  shield: {
    id: 'shield', name: 'Щит', tab: 'armor',
    icon: ico(1, 8), stack: 1, slot: 'shield', bonus: { def: 1 }, rarity: 'uncommon',
  },
  helm: {
    id: 'helm', name: 'Шлем', tab: 'armor',
    icon: ico(4, 6), stack: 1, slot: 'helm', bonus: { def: 1, hp: 10 }, rarity: 'rare',
  },
  armor: {
    id: 'armor', name: 'Латы', tab: 'armor',
    // Броня тяжёлая: защищает, но замедляет — иначе надевать нечего думать.
    icon: ico(5, 6), stack: 1, slot: 'body', bonus: { def: 2, speed: -4 }, rarity: 'rare',
  },
  boots: {
    id: 'boots', name: 'Сапоги', tab: 'armor',
    icon: ico(2, 8), stack: 1, slot: 'boots', bonus: { speed: 8 }, rarity: 'uncommon',
  },
  ring: {
    id: 'ring', name: 'Кольцо', tab: 'armor',
    icon: ico(5, 8), stack: 1, slot: 'ring', bonus: { dmg: 2 }, rarity: 'rare',
  },
  amulet: {
    id: 'amulet', name: 'Амулет', tab: 'armor',
    icon: ico(0, 9), stack: 1, slot: 'amulet', bonus: { mp: 15 }, rarity: 'epic',
  },
};

/** Порядок от частого к редкому. Используется и в подсказках, и в тесте. */
export const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic'];

export const RARITY_NAME: Record<Rarity, string> = {
  common: 'Обычное',
  uncommon: 'Необычное',
  rare: 'Редкое',
  epic: 'Эпическое',
};

export const rarityOf = (id: string): Rarity => ITEMS[id]?.rarity ?? 'common';

/** Одна ячейка сумки. */
export interface Stack {
  id: string;
  qty: number;
}

/**
 * Кладёт предметы в сумку, досыпая в начатые стопки.
 *
 * Возвращает, сколько НЕ влезло: сумка не резиновая, и молча терять добычу
 * нельзя — игрок должен узнать, что она полна.
 */
export function addToBag(bag: (Stack | null)[], id: string, qty: number): number {
  const def = ITEMS[id];
  if (!def) return qty;

  let left = qty;

  // Сначала досыпаем в начатые стопки, иначе сумка забьётся огрызками.
  for (const slot of bag) {
    if (left <= 0) break;
    if (!slot || slot.id !== id || slot.qty >= def.stack) continue;
    const room = def.stack - slot.qty;
    const put = Math.min(room, left);
    slot.qty += put;
    left -= put;
  }

  for (let i = 0; i < bag.length && left > 0; i++) {
    if (bag[i]) continue;
    const put = Math.min(def.stack, left);
    bag[i] = { id, qty: put };
    left -= put;
  }

  return left;
}

/** Убирает одну штуку из ячейки. Пустая ячейка освобождается. */
export function takeOne(bag: (Stack | null)[], index: number): string | null {
  const slot = bag[index];
  if (!slot) return null;

  slot.qty--;
  if (slot.qty <= 0) bag[index] = null;
  return slot.id;
}

/** Сколько всего таких предметов в сумке. */
export function countOf(bag: (Stack | null)[], id: string): number {
  return bag.reduce((n, s) => n + (s && s.id === id ? s.qty : 0), 0);
}

/**
 * Сколько ещё таких предметов влезет в сумку: пустые ячейки плюс место в начатых
 * стопках. Нужно магазину — проверить место ДО списания золота, не трогая сумку:
 * addToBag кладёт по месту, а откатывать наполовину заполненную покупку — грязь.
 */
export function roomFor(bag: (Stack | null)[], id: string): number {
  const def = Object.hasOwn(ITEMS, id) ? ITEMS[id] : undefined;
  if (!def) return 0;
  let room = 0;
  for (const s of bag) {
    if (!s) room += def.stack;
    else if (s.id === id && s.qty < def.stack) room += def.stack - s.qty;
  }
  return room;
}

/** Порядок вкладок — по нему же раскладывается сумка. */
const TAB_ORDER: Tab[] = ['weapon', 'armor', 'resource', 'food'];

/**
 * Разложить сумку: слить огрызки одинаковых стопок, сгруппировать по виду и
 * сдвинуть всё к началу.
 *
 * Ничего не теряет и не создаёт: после раскладки количество каждого предмета
 * ровно то же, что было. За этим следит тест — иначе кнопка «Разложить» стала
 * бы способом размножить или потерять добычу.
 */
export function sortBag(bag: (Stack | null)[]): void {
  const total = new Map<string, number>();
  for (const s of bag) if (s) total.set(s.id, (total.get(s.id) ?? 0) + s.qty);

  const ids = [...total.keys()].sort((a, b) => {
    const da = ITEMS[a];
    const db = ITEMS[b];
    const tab = TAB_ORDER.indexOf(da.tab) - TAB_ORDER.indexOf(db.tab);
    if (tab) return tab;
    // Внутри вкладки редкое — выше: за ним игрок и лезет в сумку.
    const rare = RARITY_ORDER.indexOf(rarityOf(b)) - RARITY_ORDER.indexOf(rarityOf(a));
    if (rare) return rare;
    return da.name.localeCompare(db.name, 'ru');
  });

  bag.fill(null);
  let at = 0;
  for (const id of ids) {
    let left = total.get(id)!;
    while (left > 0 && at < bag.length) {
      const put = Math.min(ITEMS[id].stack, left);
      bag[at++] = { id, qty: put };
      left -= put;
    }
  }
}
