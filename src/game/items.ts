/**
 * Предметы. Единственное место, где они описываются.
 *
 * Как и характеристики существ, это данные, а не код: добавить предмет — значит
 * дописать строку. Файл намеренно не знает про Phaser, поэтому проверяется
 * тестами без браузера.
 */

export type Tab = 'weapon' | 'armor' | 'resource' | 'food';
export type EquipSlot = 'helm' | 'body' | 'weapon' | 'shield' | 'boots' | 'ring' | 'amulet' | 'gloves';

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
   * пришлось нарисовать самим в палитре набора: assets/interface/ui/scroll.png),
   * 'armor' — атлас брони, склеенный из сотни отдельных PNG набора armor-icons
   * (см. armor_atlas.png: иконка N лежит в клетке (N-1)%10, (N-1)/10, все 32x32).
   */
  sheet: 'icons' | 'Objects' | 'scroll' | 'armor';
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
  /**
   * Картинка оружия В РУКЕ героя (набор weapon-icons, 32x32, клинок по диагонали
   * вверх-вправо). Надел — этот спрайт появляется в руке и машет при ударе.
   * Поменять вид меча = поменять номер иконки здесь.
   */
  held?: string;
  /**
   * Как броня выглядит НА герое: палитра перекраски (см. ARMOR_PALETTES в
   * player.ts). Нагрудник перекрашивает тунику, шлем — волосы (они облегают
   * голову и сами становятся формой шлема). Именно перекраска, а не спрайт
   * поверх: иконки предметов детальные, и ужатые до чиби-героя (голова —
   * пол-персонажа) они превращались в кашу, закрывающую лицо, — проверено.
   * Есть только у шлемов и нагрудников: перчатки и сапоги на герое — 2-3 пикселя.
   */
  tint?: 'leather' | 'iron' | 'azure';
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

/** Иконка брони из атласа armor_atlas.png по номеру файла Icons_6_NN (1..100). */
const aico = (n: number): Icon => ({ sheet: 'armor', x: ((n - 1) % 10) * 32, y: Math.floor((n - 1) / 10) * 32, w: 32, h: 32 });

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
    id: 'mush_red', name: 'Red Mushroom', tab: 'food',
    icon: MUSH_RED, world: MUSH_RED_WORLD, stack: 99, use: { hp: 30 },
  },
  mush_brown: {
    id: 'mush_brown', name: 'Brown Mushroom', tab: 'food',
    icon: MUSH_BROWN, world: MUSH_BROWN_WORLD, stack: 99, use: { mp: 25 },
  },
  apple: { id: 'apple', name: 'Apple', tab: 'food', icon: ico(5, 5), stack: 20, use: { hp: 12 } },
  potion_hp: {
    id: 'potion_hp', name: 'Health Potion', tab: 'food',
    icon: ico(5, 17), stack: 10, use: { hp: 60 }, rarity: 'uncommon',
  },
  potion_mp: {
    id: 'potion_mp', name: 'Mana Potion', tab: 'food',
    icon: ico(4, 17), stack: 10, use: { mp: 40 }, rarity: 'uncommon',
  },

  // Слиток, а не руда: руды в наборе нет вовсе, а называть слиток рудой — врать
  // на ровном месте.
  ore_copper: { id: 'ore_copper', name: 'Copper Ingot', tab: 'resource', icon: ico(4, 16), stack: 99 },
  crystal: { id: 'crystal', name: 'Crystal', tab: 'resource', icon: ico(5, 10), stack: 99, rarity: 'uncommon' },

  // Свиток заточки: съедается кузницей (K) за попытку поднять оружие на +1.
  // Лист 'scroll' — наш дорисованный: свитка в наборе не нашлось ни в одном листе.
  scroll_sharpen: {
    id: 'scroll_sharpen', name: 'Sharpening Scroll', tab: 'resource',
    icon: { sheet: 'scroll', x: 0, y: 0, w: 16, h: 16 }, stack: 20, rarity: 'uncommon',
  },

  // Меч новобранца — с ним герой начинает игру. Раньше меча не было вовсе:
  // персонаж махал и наносил урон, а в сумке оружия не было, и это сбивало с
  // толку. Бонус НУЛЕВОЙ намеренно: урон обычного взмаха уже заложен в HERO.dmg,
  // и этот меч не добавляет силы, а лишь делает её видимой — оружием в руке.
  sword_basic: {
    id: 'sword_basic', name: 'Recruit Sword', tab: 'weapon',
    icon: ico(1, 0), stack: 1, slot: 'weapon',
    held: 'assets/weapon-icons/Icons/icon_02.png', // простой меч без прикрас
  },
  // Лук — оружие дальнего боя. Надетым превращает взмах в выстрел стрелой в
  // сторону курсора. Урон чуть выше базового меча, но бить приходится издалека
  // и целиться. Стрелы бесконечны (так решил заказчик).
  bow: {
    id: 'bow', name: 'Bow', tab: 'weapon',
    icon: ico(3, 7), stack: 1, slot: 'weapon', ranged: true, bonus: { dmg: 2 }, rarity: 'uncommon',
    held: 'assets/weapon-icons/Icons/icon_33.png', // простой деревянный лук
  },
  sword: {
    id: 'sword', name: 'Steel Sword', tab: 'weapon',
    icon: ico(0, 8), stack: 1, slot: 'weapon', bonus: { dmg: 3 }, rarity: 'uncommon',
    held: 'assets/weapon-icons/Icons/icon_04.png', // стальной клинок
  },
  sword_blue: {
    id: 'sword_blue', name: 'Azure Sword', tab: 'weapon',
    icon: ico(3, 8), stack: 1, slot: 'weapon', bonus: { dmg: 6 }, rarity: 'epic',
    held: 'assets/weapon-icons/Icons/icon_09.png', // лазурная гарда — под имя
  },
  shield: {
    id: 'shield', name: 'Shield', tab: 'armor',
    icon: ico(1, 8), stack: 1, slot: 'shield', bonus: { def: 1 }, rarity: 'uncommon',
  },
  helm: {
    id: 'helm', name: 'Helmet', tab: 'armor',
    icon: ico(4, 6), stack: 1, slot: 'helm', bonus: { def: 1, hp: 10 }, rarity: 'rare',
  },
  armor: {
    id: 'armor', name: 'Plate Armor', tab: 'armor',
    // Броня тяжёлая: защищает, но замедляет — иначе надевать нечего думать.
    icon: ico(5, 6), stack: 1, slot: 'body', bonus: { def: 2, speed: -4 }, rarity: 'rare',
  },
  boots: {
    id: 'boots', name: 'Boots', tab: 'armor',
    icon: ico(2, 8), stack: 1, slot: 'boots', bonus: { speed: 8 }, rarity: 'uncommon',
  },
  ring: {
    id: 'ring', name: 'Ring', tab: 'armor',
    icon: ico(5, 8), stack: 1, slot: 'ring', bonus: { dmg: 2 }, rarity: 'rare',
  },
  amulet: {
    id: 'amulet', name: 'Amulet', tab: 'armor',
    icon: ico(0, 9), stack: 1, slot: 'amulet', bonus: { mp: 15 }, rarity: 'epic',
  },

  // --- Комплекты брони (набор armor-icons) ---
  //
  // Три комплекта по четыре части: кожа (лёгкая, для скорости), железо (тяжёлая,
  // для защиты), лазурь (топ, в цвет Azure Sword). Иконки выбраны из сотни по
  // монтажу: aico(N) — номер файла Icons_6_NN. Шлем и нагрудник видны на
  // модельке героя (поле worn), перчатки и сапоги дают только статы.
  leather_helm: {
    id: 'leather_helm', name: 'Leather Cap', tab: 'armor',
    icon: aico(41), stack: 1, slot: 'helm', bonus: { def: 1 }, rarity: 'uncommon',
    tint: 'leather',
  },
  leather_chest: {
    id: 'leather_chest', name: 'Leather Jerkin', tab: 'armor',
    // Кожа не мешает бегать — этим и берёт против железа.
    icon: aico(51), stack: 1, slot: 'body', bonus: { def: 1, speed: 2 }, rarity: 'uncommon',
    tint: 'leather',
  },
  leather_gloves: {
    id: 'leather_gloves', name: 'Leather Gloves', tab: 'armor',
    icon: aico(61), stack: 1, slot: 'gloves', bonus: { dmg: 1 }, rarity: 'uncommon',
  },
  leather_boots: {
    id: 'leather_boots', name: 'Leather Boots', tab: 'armor',
    icon: aico(71), stack: 1, slot: 'boots', bonus: { speed: 6 }, rarity: 'uncommon',
  },

  iron_helm: {
    id: 'iron_helm', name: 'Iron Helm', tab: 'armor',
    icon: aico(4), stack: 1, slot: 'helm', bonus: { def: 2, hp: 10 }, rarity: 'rare',
    tint: 'iron',
  },
  iron_chest: {
    id: 'iron_chest', name: 'Iron Cuirass', tab: 'armor',
    // Тяжелее Plate Armor по защите и так же тянет вниз по скорости.
    icon: aico(13), stack: 1, slot: 'body', bonus: { def: 3, speed: -4 }, rarity: 'rare',
    tint: 'iron',
  },
  iron_gloves: {
    id: 'iron_gloves', name: 'Iron Gauntlets', tab: 'armor',
    icon: aico(23), stack: 1, slot: 'gloves', bonus: { def: 1, dmg: 1 }, rarity: 'rare',
  },
  iron_boots: {
    id: 'iron_boots', name: 'Iron Greaves', tab: 'armor',
    icon: aico(33), stack: 1, slot: 'boots', bonus: { def: 1, speed: 4 }, rarity: 'rare',
  },

  azure_helm: {
    id: 'azure_helm', name: 'Azure Helm', tab: 'armor',
    icon: aico(8), stack: 1, slot: 'helm', bonus: { def: 2, hp: 20, mp: 10 }, rarity: 'epic',
    tint: 'azure',
  },
  azure_chest: {
    id: 'azure_chest', name: 'Azure Plate', tab: 'armor',
    icon: aico(18), stack: 1, slot: 'body', bonus: { def: 4, hp: 15, speed: -2 }, rarity: 'epic',
    tint: 'azure',
  },
  azure_gloves: {
    id: 'azure_gloves', name: 'Azure Gauntlets', tab: 'armor',
    icon: aico(28), stack: 1, slot: 'gloves', bonus: { def: 1, dmg: 3 }, rarity: 'epic',
  },
  azure_boots: {
    id: 'azure_boots', name: 'Azure Sabatons', tab: 'armor',
    icon: aico(38), stack: 1, slot: 'boots', bonus: { def: 1, speed: 10 }, rarity: 'epic',
  },
};

/** Порядок от частого к редкому. Используется и в подсказках, и в тесте. */
export const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic'];

export const RARITY_NAME: Record<Rarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
};

export const rarityOf = (id: string): Rarity => ITEMS[id]?.rarity ?? 'common';

/** Одна ячейка сумки. */
export interface Stack {
  id: string;
  qty: number;
  /**
   * Заточка ЭТОГО экземпляра оружия, +N (кузница, K). Живёт на самом предмете, а
   * НЕ на его виде: два одинаковых меча точатся врозь. Только у оружия — оно
   * stack:1, поэтому у экземпляра всегда одна штука. undefined/0 — не заточен.
   */
  sharpen?: number;
}

/**
 * Кладёт предметы в сумку, досыпая в начатые стопки.
 *
 * Возвращает, сколько НЕ влезло: сумка не резиновая, и молча терять добычу
 * нельзя — игрок должен узнать, что она полна.
 *
 * sharpen переносит заточку экземпляра оружия — когда оружие возвращается в
 * сумку из руки (снятие). Только для оружия (stack:1, qty:1): ложится ровно на
 * ту новую ячейку, которую под него завели. Для стопкующихся предметов не имеет
 * смысла и не передаётся.
 */
export function addToBag(bag: (Stack | null)[], id: string, qty: number, sharpen?: number): number {
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
    if (sharpen && sharpen > 0) bag[i]!.sharpen = sharpen;
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
 *
 * ОРУЖИЕ (stack:1) храним ПОШТУЧНО, а не сливаем в счётчик по виду: у каждого
 * меча своя заточка (`Stack.sharpen`), и слить два меча в «×2» значило бы стереть
 * её. Сливаем по виду только по-настоящему стопкующееся (грибы, зелья).
 */
export function sortBag(bag: (Stack | null)[]): void {
  const merged = new Map<string, number>(); // стопкующееся: вид -> общее число
  const cells: Stack[] = []; // поштучные экземпляры (оружие) — целиком, с заточкой

  for (const s of bag) {
    if (!s) continue;
    if (ITEMS[s.id].stack === 1) cells.push(s.sharpen ? { id: s.id, qty: s.qty, sharpen: s.sharpen } : { id: s.id, qty: s.qty });
    else merged.set(s.id, (merged.get(s.id) ?? 0) + s.qty);
  }

  for (const [id, qty] of merged) {
    let left = qty;
    while (left > 0) {
      const put = Math.min(ITEMS[id].stack, left);
      cells.push({ id, qty: put });
      left -= put;
    }
  }

  cells.sort((a, b) => {
    const da = ITEMS[a.id];
    const db = ITEMS[b.id];
    const tab = TAB_ORDER.indexOf(da.tab) - TAB_ORDER.indexOf(db.tab);
    if (tab) return tab;
    // Внутри вкладки редкое — выше: за ним игрок и лезет в сумку.
    const rare = RARITY_ORDER.indexOf(rarityOf(b.id)) - RARITY_ORDER.indexOf(rarityOf(a.id));
    if (rare) return rare;
    const name = da.name.localeCompare(db.name, 'ru');
    if (name) return name;
    return (b.sharpen ?? 0) - (a.sharpen ?? 0); // среди одинаковых заточенное выше
  });

  bag.fill(null);
  for (let i = 0; i < cells.length && i < bag.length; i++) bag[i] = cells[i];
}

/** Категория предмета на торговом рынке (клавиша T). Общая для сервера и окна. */
export type MarketCategory = 'weapon' | 'armor' | 'accessory' | 'consumable' | 'scroll' | 'resource' | 'misc';

/** Столбец категорий в окне рынка — как на образце заказчика. 'all' — без фильтра. */
export const MARKET_CATEGORIES: { id: MarketCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'weapon', label: 'Weapons' },
  { id: 'armor', label: 'Armor' },
  { id: 'accessory', label: 'Accessories' },
  { id: 'consumable', label: 'Consumables' },
  { id: 'scroll', label: 'Scrolls' },
  { id: 'resource', label: 'Resources' },
  { id: 'misc', label: 'Misc' },
];

/**
 * К какой категории рынка отнести предмет. Свитки — отдельно от прочих ресурсов;
 * кольцо/амулет — «Аксессуары», а не «Броня». Неизвестный id — «Разное».
 */
export function marketCategory(id: string): MarketCategory {
  const def = Object.hasOwn(ITEMS, id) ? ITEMS[id] : undefined;
  if (!def) return 'misc';
  if (id.startsWith('scroll')) return 'scroll';
  if (def.slot === 'weapon') return 'weapon';
  if (def.slot === 'ring' || def.slot === 'amulet') return 'accessory';
  if (def.slot) return 'armor'; // шлем/латы/щит/сапоги
  if (def.tab === 'food') return 'consumable';
  if (def.tab === 'resource') return 'resource';
  return 'misc';
}
