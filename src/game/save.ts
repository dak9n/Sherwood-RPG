// С расширением: модуль выполняют и браузер, и тесты, а node без него не найдёт.
import { ITEMS, type Stack } from './items.ts';
import { SLOTS, type Equipped } from './equipment.ts';
import { canBind, HOTBAR_SIZE, emptyHotbar, type Hotbar } from './hotbar.ts';
import { STATS, earned, emptySpent, type Spent } from './stats.ts';
import { SHARPEN_MAX, type Sharpen } from './forge.ts';

/**
 * Разбор и санация сохранения. Чистая логика: ни сервера, ни браузера — поэтому
 * под тестами, и именно здесь ловятся две беды, о которых предупреждал аудит.
 *
 * 1. ПЕРЕИМЕНОВАЛИ ПРЕДМЕТ. Сейв ссылается на id, которого в items.ts больше
 *    нет. Такую ячейку выбрасываем, а не роняем всю загрузку: одна забытая
 *    строка в таблице предметов не должна стирать чужой прогресс.
 * 2. НЕВОЗМОЖНОЕ СОСТОЯНИЕ. Битый или подделанный сейв не должен давать того,
 *    чего игра не выдаёт: стопку больше предела, вещь не в свой слот, очков
 *    больше, чем начислено за уровень. Всё это здесь режется.
 */

export const SAVE_VERSION = 1;

/** Максимальный уровень при загрузке: выше — почти наверняка порча файла. */
const MAX_LEVEL = 999;

export interface Progress {
  level: number;
  xp: number;
  hp: number;
  mp: number;
  /** Золото на покупки в магазине. Появилось позже сейвов первой версии — см. parseSave. */
  gold: number;
  bag: (Stack | null)[];
  equipped: Equipped;
  quick: Hotbar;
  spent: Spent;
  /** Заточка оружия: вид -> уровень. Тоже добавлено позже — старый сейв читается без неё. */
  sharpen: Sharpen;
}

export interface SaveFile extends Progress {
  version: number;
}

export function serializeProgress(p: Progress): SaveFile {
  return { version: SAVE_VERSION, ...p };
}

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Слоты, которые вообще существуют в панели персонажа. */
const VALID_SLOTS = new Set(SLOTS.map((s) => s.id));

function cleanBag(raw: unknown, bagSize: number): (Stack | null)[] {
  const src = Array.isArray(raw) ? raw : [];
  const bag: (Stack | null)[] = new Array(bagSize).fill(null);

  for (let i = 0; i < bagSize; i++) {
    const cell = src[i];
    if (!cell || typeof cell !== 'object') continue;
    const { id, qty } = cell as { id?: unknown; qty?: unknown };
    // hasOwn, а не просто ITEMS[id]: иначе id вроде 'constructor' или '__proto__'
    // вернул бы УНАСЛЕДОВАННЫЙ член Object.prototype (он truthy), фантом прошёл бы
    // санацию и уронил игру при открытии сумки.
    const def = typeof id === 'string' && Object.hasOwn(ITEMS, id) ? ITEMS[id] : undefined;
    if (!def) continue; // предмета больше нет — ячейка пустеет

    const n = Math.floor(num(qty, 0));
    if (n < 1) continue;
    bag[i] = { id: id as string, qty: Math.min(n, def.stack) }; // не больше предела стопки
  }
  return bag;
}

function cleanEquipped(raw: unknown): Equipped {
  const eq: Equipped = {};
  if (!raw || typeof raw !== 'object') return eq;

  for (const [slot, id] of Object.entries(raw as Record<string, unknown>)) {
    if (!VALID_SLOTS.has(slot as never)) continue; // такого гнезда нет
    const def = typeof id === 'string' && Object.hasOwn(ITEMS, id) ? ITEMS[id] : undefined;
    // Вещь должна и существовать (своим полем таблицы, не унаследованным), и
    // надеваться ИМЕННО в это гнездо.
    if (def && def.slot === slot) eq[slot as keyof Equipped] = id as string;
  }
  return eq;
}

function cleanQuick(raw: unknown): Hotbar {
  const src = Array.isArray(raw) ? raw : [];
  const bar = emptyHotbar();
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const id = src[i];
    // На панель ложится только то, что и в игре: съедобное или надеваемое.
    if (typeof id === 'string' && canBind(id)) bar[i] = id;
  }
  return bar;
}

/**
 * Заточка из сейва. Берём только НАШИ виды оружия (своим полем таблицы, не
 * унаследованным — та же защита от __proto__/constructor, что у сумки) и режем
 * уровень в honest-диапазон 0..SHARPEN_MAX: выше игра не выдаёт.
 */
function cleanSharpen(raw: unknown): Sharpen {
  // Обычный объект, а не Object.create(null): внутрь попадают ТОЛЬКО ключи,
  // прошедшие hasOwn по таблице предметов, — __proto__ и родня сюда не пролезут,
  // а все чтения карты идут через plusOf с тем же hasOwn.
  const out: Sharpen = {};
  if (!raw || typeof raw !== 'object') return out;

  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const def = Object.hasOwn(ITEMS, id) ? ITEMS[id] : undefined;
    if (!def || def.slot !== 'weapon') continue;
    const level = Math.min(SHARPEN_MAX, Math.floor(num(v, 0)));
    if (level > 0) out[id] = level;
  }
  return out;
}

function cleanSpent(raw: unknown, level: number): Spent {
  const spent = emptySpent();
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  for (const s of STATS) spent[s.id] = Math.max(0, Math.floor(num(src[s.id], 0)));

  // Вложено не может быть больше, чем выдано за уровень. Излишек срезаем.
  const cap = earned(level);
  let total = STATS.reduce((n, s) => n + spent[s.id], 0);
  for (const s of STATS) {
    if (total <= cap) break;
    const cut = Math.min(spent[s.id], total - cap);
    spent[s.id] -= cut;
    total -= cut;
  }
  return spent;
}

/**
 * Разобрать сырой сейв в применимый прогресс. null — сейва нет или версия чужая
 * (тогда начинаем с нуля, но НЕ роняем игру и не гадаем над незнакомым форматом).
 *
 * hp/mp тут только очищаются до неотрицательных чисел; под настоящий потолок их
 * поджимает уже сцена — он зависит от уровня, вещей и очков.
 */
export function parseSave(raw: unknown, bagSize: number): Progress | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (s.version !== SAVE_VERSION) return null;

  const level = Math.min(MAX_LEVEL, Math.max(1, Math.floor(num(s.level, 1))));

  return {
    level,
    xp: Math.max(0, num(s.xp, 0)),
    hp: Math.max(0, num(s.hp, 0)),
    mp: Math.max(0, num(s.mp, 0)),
    // Золото добавили после первой версии сейва. Старый сейв его не хранит —
    // читаем 0, а не роняем загрузку: поле необязательное, версию не меняем.
    gold: Math.max(0, Math.floor(num(s.gold, 0))),
    bag: cleanBag(s.bag, bagSize),
    equipped: cleanEquipped(s.equipped),
    quick: cleanQuick(s.quick),
    spent: cleanSpent(s.spent, level),
    sharpen: cleanSharpen(s.sharpen),
  };
}
