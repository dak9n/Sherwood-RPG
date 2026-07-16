import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totalBonuses, equipFromBag, unequip, slotWearing, ensureStarterWeapon, STARTER_WEAPON, SLOTS, LEFT_SLOTS, RIGHT_SLOTS, type Equipped } from './equipment.ts';
import { ITEMS, addToBag, countOf, type Stack } from './items.ts';

const bag = (size = 5): (Stack | null)[] => new Array(size).fill(null);

test('без вещей бонусов нет', () => {
  assert.deepEqual(totalBonuses({}), { dmg: 0, def: 0, speed: 0, hp: 0, mp: 0 });
});

test('бонусы надетого складываются', () => {
  const eq: Equipped = { weapon: 'sword', ring: 'ring', helm: 'helm' };
  const b = totalBonuses(eq);

  assert.equal(b.dmg, 3 + 2, 'меч +3 и кольцо +2');
  assert.equal(b.def, 1, 'шлем');
  assert.equal(b.hp, 10, 'шлем');
});

test('латы защищают, но замедляют — минус тоже считается', () => {
  const b = totalBonuses({ body: 'armor', boots: 'boots' });
  assert.equal(b.def, 2);
  assert.equal(b.speed, -4 + 8, 'сапоги перекрывают тяжесть лат');
});

test('надеть: вещь уходит из сумки в слот', () => {
  const b = bag();
  addToBag(b, 'sword', 1);

  const eq: Equipped = {};
  const res = equipFromBag(b, 0, eq);

  assert.equal(res.ok, true);
  assert.equal(eq.weapon, 'sword');
  assert.equal(b[0], null, 'ячейка освободилась');
});

test('надеть в занятый слот: старая вещь возвращается в ту же ячейку', () => {
  // Обмен один в один: вещь не может ни потеряться, ни размножиться.
  const b = bag();
  addToBag(b, 'sword_blue', 1);
  const eq: Equipped = { weapon: 'sword' };

  const res = equipFromBag(b, 0, eq);

  assert.equal(res.removed, 'sword');
  assert.equal(eq.weapon, 'sword_blue');
  assert.deepEqual(b[0], { id: 'sword', qty: 1 }, 'старый меч лёг на место нового');
});

test('гриб надеть нельзя', () => {
  const b = bag();
  addToBag(b, 'mush_red', 5);
  const eq: Equipped = {};

  assert.equal(equipFromBag(b, 0, eq).ok, false);
  assert.equal(b[0]?.qty, 5, 'грибы на месте');
});

test('из пустой ячейки надевать нечего', () => {
  assert.equal(equipFromBag(bag(), 0, {}).ok, false);
});

test('снять: вещь уходит в сумку', () => {
  const b = bag();
  const eq: Equipped = { weapon: 'sword' };

  const res = unequip(eq, 'weapon', (id) => addToBag(b, id, 1) === 0);

  assert.equal(res.ok, true);
  assert.equal(eq.weapon, undefined);
  assert.deepEqual(b[0], { id: 'sword', qty: 1 });
});

test('в полную сумку не снимаем — вещь остаётся надетой', () => {
  // Иначе снятый меч исчез бы в никуда.
  const eq: Equipped = { weapon: 'sword' };
  const res = unequip(eq, 'weapon', () => false);

  assert.equal(res.ok, false);
  assert.equal(eq.weapon, 'sword', 'меч всё ещё надет');
});

test('снимать из пустого слота нечего', () => {
  assert.equal(unequip({}, 'helm', () => true).ok, false);
});

test('на каждый слот панели есть предмет в игре', () => {
  // Пустое гнездо, которое нечем занять, — обещание, которого игра не держит.
  for (const s of SLOTS) {
    assert.ok(
      Object.values(ITEMS).some((d) => d.slot === s.id),
      `слот ${s.label}: нечего надеть`,
    );
  }
});

test('меч заметно меняет бой, а не для галочки', () => {
  // Базовый урон героя 8-12. Прибавка должна быть видна.
  const b = totalBonuses({ weapon: 'sword_blue' });
  assert.ok(b.dmg >= 5, `+${b.dmg} к урону при базовых 8-12 — незаметно`);
});

test('находим, в каком слоте надет предмет', () => {
  const eq: Equipped = { weapon: 'sword_blue', helm: 'helm' };
  assert.equal(slotWearing(eq, 'sword_blue'), 'weapon');
  assert.equal(slotWearing(eq, 'helm'), 'helm');
  assert.equal(slotWearing(eq, 'sword'), undefined, 'обычный меч не надет');
  assert.equal(slotWearing({}, 'sword'), undefined);
});

test('колонки окна покрывают ВСЕ слоты и ничего не выдумывают', () => {
  // Ловушка не выдуманная: пока шла работа, в SLOTS и в предметы добавили слот
  // «Перчатки», а в колонки окна — нет. Такую вещь можно надеть из сумки и
  // нельзя снять: гнезда, по которому кликают, на экране просто нет.
  const shown = [...LEFT_SLOTS, ...RIGHT_SLOTS];
  const all = SLOTS.map((s) => s.id);

  assert.deepEqual([...shown].sort(), [...all].sort(), 'колонки и SLOTS разошлись');
  assert.equal(new Set(shown).size, shown.length, 'слот показан дважды');
});

test('у каждого слота есть погашенная подсказка-иконка', () => {
  // Пустое гнездо без иконки — просто дырка: непонятно, что туда надевается.
  // Проверяем через предметы: у каждого слота есть вещь, а значит и иконка.
  for (const s of SLOTS) {
    const item = Object.values(ITEMS).find((d) => d.slot === s.id);
    assert.ok(item, `слот ${s.label}: нечем занять`);
    assert.ok(item.icon, `слот ${s.label}: у вещи нет иконки`);
  }
});

test('стартовый меч существует, надевается в руку и ничего не ломает балансом', () => {
  const def = ITEMS[STARTER_WEAPON];
  assert.ok(def, 'меч новобранца есть в игре');
  assert.equal(def.slot, 'weapon', 'надевается в руку');
  // Бонус нулевой намеренно: урон базового взмаха уже в HERO.dmg.
  assert.equal(def.bonus?.dmg ?? 0, 0, 'стартовый меч не добавляет урона сверх базы');
});

test('стартовый меч выдаётся, когда оружия нет', () => {
  const eq: Equipped = {};
  assert.equal(ensureStarterWeapon(eq, bag()), true, 'выдан');
  assert.equal(eq.weapon, STARTER_WEAPON);
});

test('стартовый меч НЕ трогает уже надетое оружие', () => {
  const eq: Equipped = { weapon: 'sword' };
  assert.equal(ensureStarterWeapon(eq, bag()), false);
  assert.equal(eq.weapon, 'sword', 'стальной меч на месте');
});

test('второй стартовый меч не плодится: если он уже в сумке, нового не даём', () => {
  const b = bag();
  addToBag(b, STARTER_WEAPON, 1);
  const eq: Equipped = {};
  assert.equal(ensureStarterWeapon(eq, b), false, 'меч в сумке — второго не создаём');
  assert.equal(eq.weapon, undefined, 'гнездо осталось пустым');
  assert.equal(countOf(b, STARTER_WEAPON), 1, 'в сумке по-прежнему один');
});
