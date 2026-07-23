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
  gold: 0,
  weaponSharpen: 0,
  skills: {},
  charName: '',
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
    equipped: { weapon: 'sword_blue', helm: 'helm1' },
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
        weapon: 'helm1' as never,      // шлем не оружие
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

test('золото: туда-обратно и защита от порчи', () => {
  assert.equal(parseSave(serializeProgress(base({ gold: 250 })), BAG)!.gold, 250, 'обычное значение цело');
  assert.equal(parseSave(serializeProgress(base({ gold: -40 })), BAG)!.gold, 0, 'отрицательное золото — в ноль');
  assert.equal(parseSave(serializeProgress(base({ gold: 12.7 })), BAG)!.gold, 12, 'дробное округляется вниз');
  assert.equal(parseSave(serializeProgress(base({ gold: NaN as never })), BAG)!.gold, 0, 'NaN — в ноль');
});

test('сейв ПЕРВОЙ версии без золота читается (золото = 0), а не роняет загрузку', () => {
  // Старый сейв поля gold не знал вовсе. Версию мы не поднимали — он обязан
  // прогрузиться, иначе игроки с прогрессом потеряли бы его при обновлении.
  const old = serializeProgress(base({ level: 4 })) as unknown as Record<string, unknown>;
  delete old.gold;
  const p = parseSave(old, BAG)!;
  assert.equal(p.gold, 0, 'нет поля — читаем ноль');
  assert.equal(p.level, 4, 'остальной прогресс на месте');
});

test('заточка: надетое числом, ячейки — на самих ячейках, туда-обратно', () => {
  const p = base({
    weaponSharpen: 8,
    equipped: { weapon: 'sword_blue' },
    bag: [{ id: 'sword', qty: 1, sharpen: 3 }, { id: 'sword_blue', qty: 1 }, ...new Array(BAG - 2).fill(null)],
  });
  const round = parseSave(serializeProgress(p), BAG)!;
  assert.equal(round.weaponSharpen, 8, 'заточка надетого цела');
  assert.equal(round.bag[0]!.sharpen, 3, 'заточка ячейки цела');
  assert.equal(round.bag[1]!.sharpen, undefined, 'незаточенный меч — без поля');
});

test('санация заточки ячеек сумки', () => {
  const dirty = parseSave(
    serializeProgress(base({
      bag: [
        { id: 'sword', qty: 1, sharpen: 99 } as never, // выше предела -> 20
        { id: 'bow', qty: 1, sharpen: -4 } as never, // отрицательная -> нет
        { id: 'sword_blue', qty: 1, sharpen: 2.9 } as never, // дробная -> вниз до 2
        { id: 'apple', qty: 3, sharpen: 5 } as never, // не оружие -> заточки не бывает
        ...new Array(BAG - 4).fill(null),
      ],
    })),
    BAG,
  )!;
  assert.equal(dirty.bag[0]!.sharpen, 20);
  assert.equal(dirty.bag[1]!.sharpen, undefined);
  assert.equal(dirty.bag[2]!.sharpen, 2);
  assert.equal(dirty.bag[3]!.sharpen, undefined, 'у яблока заточки не бывает');
});

test('миграция старой карты: +N остаётся у надетого оружия, копии обнуляются', () => {
  // Старый формат: карта «вид -> уровень». Надет синий меч, ещё две копии в сумке.
  const oldSave = {
    ...serializeProgress(base({
      equipped: { weapon: 'sword_blue' },
      bag: [{ id: 'sword_blue', qty: 1 }, { id: 'sword_blue', qty: 1 }, ...new Array(BAG - 2).fill(null)],
    })),
    sharpen: { sword_blue: 8 },
  } as Record<string, unknown>;
  delete oldSave.weaponSharpen; // старый формат его не знал

  const p = parseSave(oldSave, BAG)!;
  assert.equal(p.weaponSharpen, 8, 'надетый меч сохранил +8');
  assert.equal(p.bag[0]!.sharpen, undefined, 'копия в сумке обнулена');
  assert.equal(p.bag[1]!.sharpen, undefined, 'вторая копия тоже');
});

test('миграция: карта режется в предел, а без надетого оружия — ноль', () => {
  const hi = { ...serializeProgress(base({ equipped: { weapon: 'sword' } })), sharpen: { sword: 99 } } as Record<string, unknown>;
  delete hi.weaponSharpen;
  assert.equal(parseSave(hi, BAG)!.weaponSharpen, 20, 'выше предела не бывает');

  const none = { ...serializeProgress(base({ equipped: {} })), sharpen: { sword: 5 } } as Record<string, unknown>;
  delete none.weaponSharpen;
  assert.equal(parseSave(none, BAG)!.weaponSharpen, 0, 'нечего надето — заточке неоткуда взяться');
});

test('новый формат: weaponSharpen без надетого оружия обнуляется', () => {
  // Оружие переименовали/удалили -> cleanEquipped его выкинул, надетого нет.
  // Прибавку нельзя оставлять: applyGear добавил бы её голому герою.
  const dropped = serializeProgress(base({ weaponSharpen: 10, equipped: { weapon: 'НЕТ_ТАКОГО' as never } }));
  assert.equal(parseSave(dropped, BAG)!.weaponSharpen, 0, 'фантомной заточки голому герою не бывает');

  const empty = serializeProgress(base({ weaponSharpen: 10, equipped: {} }));
  assert.equal(parseSave(empty, BAG)!.weaponSharpen, 0, 'пустой слот оружия — заточка ноль');
});

test('новый weaponSharpen важнее старой карты, если есть оба', () => {
  const both = {
    ...serializeProgress(base({ weaponSharpen: 4, equipped: { weapon: 'sword_blue' } })),
    sharpen: { sword_blue: 8 },
  };
  assert.equal(parseSave(both, BAG)!.weaponSharpen, 4, 'верим новому полю, не старой карте');
});

test('миграция: прото-ключи в старой карте безопасны', () => {
  // JSON.parse создаёт СВОЙ ключ __proto__ (литерал бы задел прототип).
  const evil = JSON.parse('{"__proto__": 9, "constructor": 9, "sword_blue": 7}');
  const oldSave = { ...serializeProgress(base({ equipped: { weapon: 'sword_blue' } })), sharpen: evil } as Record<string, unknown>;
  delete oldSave.weaponSharpen;
  assert.equal(parseSave(oldSave, BAG)!.weaponSharpen, 7, 'надетый меч мигрирован, прототип не задет');
});

test('ник героя: туда-обратно и чистка', () => {
  assert.equal(parseSave(serializeProgress(base({ charName: 'Гэндальф' })), BAG)!.charName, 'Гэндальф');
  // Управляющие символы и хвост длиннее предела режутся.
  const dirty = parseSave(serializeProgress(base({ charName: '  Ар\nаг\tорн  ' })), BAG)!.charName;
  assert.equal(dirty, 'Арагорн', 'переносы/табы убраны, края обрезаны');
  assert.equal(parseSave(serializeProgress(base({ charName: 'Дед  Мороз' })), BAG)!.charName, 'Дед Мороз', 'двойной пробел схлопнут');
  const long = parseSave(serializeProgress(base({ charName: 'ДлинноеИмяГероя1234567890' })), BAG)!.charName;
  assert.ok(long.length <= 16, `ник обрезан до предела: «${long}»`);
  assert.equal(parseSave(serializeProgress(base({ charName: 42 as never })), BAG)!.charName, '', 'не строка -> пусто');
});

test('дерево навыков: туда-обратно, а сверх выданного за уровень — срезается', () => {
  // Уровень 6 -> выдано 5 очков. Честное вложение читается как есть.
  const ok = parseSave(serializeProgress(base({ level: 6, skills: { blade: 3, swift: 2 } })), BAG)!;
  assert.deepEqual(ok.skills, { blade: 3, swift: 2 });

  // Подделка: на 3 уровне (выдано 2) вложено 30 рангов — режется до 2 суммарно.
  const cheat = parseSave(serializeProgress(base({ level: 3, skills: { blade: 10, vigor: 20 } as never })), BAG)!;
  const total = Object.values(cheat.skills).reduce((n, r) => n + r, 0);
  assert.ok(total <= 2, `вложено ${total}, а выдано за уровень 2`);
});

test('старый сейв без дерева навыков читается пустым', () => {
  const old = serializeProgress(base({ level: 5 })) as unknown as Record<string, unknown>;
  delete old.skills;
  assert.deepEqual(parseSave(old, BAG)!.skills, {}, 'нет поля -> пустое дерево');
});

test('старый сейв без ника читается пустым', () => {
  const old = serializeProgress(base({ level: 3 })) as unknown as Record<string, unknown>;
  delete old.charName;
  assert.equal(parseSave(old, BAG)!.charName, '', 'нет поля -> пустой ник, загрузка цела');
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
