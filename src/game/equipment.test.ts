import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totalBonuses, equipFromBag, unequip, slotWearing, SLOTS, type Equipped } from './equipment.ts';
import { ITEMS, addToBag, type Stack } from './items.ts';

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
