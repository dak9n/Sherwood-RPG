import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSave, serializeProgress, SAVE_VERSION, type Progress } from './save.ts';
import { ITEMS } from './items.ts';
import { emptyHotbar } from './hotbar.ts';
import { emptySpent, earned, STATS } from './stats.ts';

const BAG = 35;

const base = (over: Partial<Progress> = {}): Progress => ({
  level: 1,
  xp: 0,
  hp: 100,
  mp: 50,
  bag: new Array(BAG).fill(null),
  equipped: {},
  quick: emptyHotbar(),
  spent: emptySpent(),
  ...over,
});

test('туда-обратно: нормальный сейв читается как записан', () => {
  const p = base({
    level: 5,
    xp: 12,
    bag: [{ id: 'mush_red', qty: 7 }, null, { id: 'sword', qty: 1 }, ...new Array(BAG - 3).fill(null)],
    equipped: { weapon: 'sword_blue', helm: 'helm' },
    spent: { dmg: 2, hp: 1, mp: 0, def: 0 },
  });
  const round = parseSave(serializeProgress(p), BAG);
  assert.deepEqual(round, p);
});

test('чужая версия — начинаем с нуля, но не падаем', () => {
  assert.equal(parseSave({ version: 999, level: 50 }, BAG), null);
  assert.equal(parseSave({ version: 2 }, BAG), null);
  assert.equal(parseSave(null, BAG), null);
  assert.equal(parseSave('мусор', BAG), null);
  assert.equal(parseSave(42, BAG), null);
});

test('ПЕРЕИМЕНОВАЛИ ПРЕДМЕТ: неизвестный id из сумки выпадает, остальное цело', () => {
  const p = parseSave(
    serializeProgress(base({ bag: [{ id: 'НЕТ_ТАКОГО', qty: 3 }, { id: 'apple', qty: 5 }, ...new Array(BAG - 2).fill(null)] })),
    BAG,
  )!;
  assert.equal(p.bag[0], null, 'исчезнувший предмет убран');
  assert.deepEqual(p.bag[1], { id: 'apple', qty: 5 }, 'соседняя ячейка не пострадала');
});

test('стопка не раздувается больше предела', () => {
  // ГРУБАЯ порча/чит: 9999 красных грибов при пределе стопки 99.
  const p = parseSave(serializeProgress(base({ bag: [{ id: 'mush_red', qty: 9999 }, ...new Array(BAG - 1).fill(null)] })), BAG)!;
  assert.equal(p.bag[0]!.qty, ITEMS.mush_red.stack, 'обрезано до предела стопки');
});

test('битые ячейки сумки становятся пустыми', () => {
  const p = parseSave(
    serializeProgress(base({ bag: ['строка' as never, { id: 'apple', qty: 0 }, { qty: 3 } as never, null, ...new Array(BAG - 4).fill(null)] })),
    BAG,
  )!;
  assert.equal(p.bag[0], null, 'не объект');
  assert.equal(p.bag[1], null, 'qty 0');
  assert.equal(p.bag[2], null, 'без id');
  assert.equal(p.bag.length, BAG, 'длина ровно размер сумки');
});

test('сумка усечётся, если её размер уменьшили', () => {
  // Сейв старой сборки с 40 ячейками грузим в игру с 35.
  const big = new Array(40).fill(null).map((_, i) => (i < 40 ? { id: 'apple', qty: 1 } : null));
  const p = parseSave(serializeProgress({ ...base(), bag: big }), BAG)!;
  assert.equal(p.bag.length, BAG, 'ровно текущий размер, лишнее отброшено');
});

test('надетое: вещь не в своё гнездо и несуществующая — снимаются', () => {
  const p = parseSave(
    serializeProgress(base({
      equipped: {
        weapon: 'helm' as never,       // шлем не оружие
        helm: 'НЕТ_ТАКОГО' as never,   // предмета нет
        boots: 'boots',                 // а это верно
        плащ: 'sword' as never,         // такого гнезда нет
      } as never,
    })),
    BAG,
  )!;
  assert.equal(p.equipped.weapon, undefined, 'шлем в слот оружия не встал');
  assert.equal(p.equipped.helm, undefined, 'несуществующий предмет снят');
  assert.equal(p.equipped.boots, 'boots', 'верное надетое сохранилось');
  assert.equal((p.equipped as Record<string, unknown>).плащ, undefined, 'левого гнезда нет');
});

test('панель быстрого доступа: непривязываемое и неизвестное гаснут', () => {
  const quick = emptyHotbar();
  quick[0] = 'potion_hp';        // ок
  quick[1] = 'ore_copper';       // ресурс — на панель не ложится
  quick[2] = 'НЕТ_ТАКОГО';       // нет предмета
  const p = parseSave(serializeProgress(base({ quick })), BAG)!;
  assert.equal(p.quick[0], 'potion_hp');
  assert.equal(p.quick[1], null, 'слиток нельзя на панель');
  assert.equal(p.quick[2], null, 'неизвестный убран');
});

test('ОЧКОВ НЕ БОЛЬШЕ, ЧЕМ ВЫДАНО ЗА УРОВЕНЬ', () => {
  // Главная защита от чита: на 2 уровне выдано 3 очка, а в сейве вложено 100.
  const p = parseSave(serializeProgress(base({ level: 2, spent: { dmg: 50, hp: 50, mp: 0, def: 0 } })), BAG)!;
  const total = STATS.reduce((n, s) => n + p.spent[s.id], 0);
  assert.equal(total, earned(2), `вложено ${total}, а выдано ${earned(2)}`);
  assert.ok(total <= earned(2));
});

test('отрицательные и дробные очки чинятся', () => {
  const p = parseSave(serializeProgress(base({ level: 5, spent: { dmg: -3, hp: 2.9, mp: 1, def: 0 } as never })), BAG)!;
  assert.ok(STATS.every((s) => Number.isInteger(p.spent[s.id]) && p.spent[s.id] >= 0), 'все целые и неотрицательные');
});

test('уровень и опыт приводятся к разумному', () => {
  assert.equal(parseSave(serializeProgress(base({ level: 0 })), BAG)!.level, 1, 'ниже первого не бывает');
  assert.equal(parseSave(serializeProgress(base({ level: -5 })), BAG)!.level, 1);
  assert.equal(parseSave(serializeProgress(base({ level: 1e9 })), BAG)!.level, 999, 'абсурдный уровень обрезан');
  assert.equal(parseSave(serializeProgress(base({ xp: -100 })), BAG)!.xp, 0, 'опыт не отрицательный');
  assert.ok(Number.isInteger(parseSave(serializeProgress(base({ level: 7.8 })), BAG)!.level), 'уровень целый');
});

test('пропущенные поля не роняют разбор', () => {
  // Минимальный валидный по версии сейв — всё остальное берётся по умолчанию.
  const p = parseSave({ version: SAVE_VERSION }, BAG)!;
  assert.equal(p.level, 1);
  assert.equal(p.bag.length, BAG);
  assert.deepEqual(p.equipped, {});
  assert.equal(p.quick.length, emptyHotbar().length);
});

test('hp/mp очищаются до неотрицательных чисел', () => {
  const p = parseSave(serializeProgress(base({ hp: -50, mp: NaN as never })), BAG)!;
  assert.equal(p.hp, 0);
  assert.equal(p.mp, 0);
});

test('id-ключ прототипа (constructor/__proto__/toString) НЕ проходит в сумку', () => {
  // Дыра: ITEMS['constructor'] возвращал унаследованный член прототипа (truthy),
  // фантом просачивался и ронял игру при открытии сумки и «Разложить».
  for (const evil of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
    const p = parseSave(serializeProgress(base({ bag: [{ id: evil, qty: 5 }, ...new Array(BAG - 1).fill(null)] })), BAG)!;
    assert.equal(p.bag[0], null, `фантом «${evil}» должен быть вычищен`);
  }
});

test('id-ключ прототипа в надетом тоже отбрасывается', () => {
  const p = parseSave(serializeProgress(base({ equipped: { weapon: 'constructor', helm: '__proto__' } as never })), BAG)!;
  assert.deepEqual(p.equipped, {}, 'ни одно унаследованное имя не встало в гнездо');
});
