import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, addToBag, takeOne, countOf, type Stack } from './items.ts';

const bag = (size = 5): (Stack | null)[] => new Array(size).fill(null);

test('предмет кладётся в пустую сумку', () => {
  const b = bag();
  assert.equal(addToBag(b, 'mush_red', 3), 0, 'всё влезло');
  assert.deepEqual(b[0], { id: 'mush_red', qty: 3 });
});

test('одинаковые предметы досыпаются в начатую стопку, а не плодят огрызки', () => {
  const b = bag();
  addToBag(b, 'mush_red', 3);
  addToBag(b, 'mush_red', 4);

  assert.deepEqual(b[0], { id: 'mush_red', qty: 7 });
  assert.equal(b[1], null, 'вторая ячейка не занята');
});

test('стопка не растёт выше своего потолка', () => {
  const b = bag();
  addToBag(b, 'potion_hp', 25); // потолок 10

  assert.equal(b[0]?.qty, 10);
  assert.equal(b[1]?.qty, 10);
  assert.equal(b[2]?.qty, 5);
});

test('оружие не складывается в стопку', () => {
  const b = bag();
  addToBag(b, 'sword', 2);

  assert.equal(b[0]?.qty, 1);
  assert.equal(b[1]?.qty, 1, 'второй меч занял свою ячейку');
});

test('полная сумка говорит, сколько не влезло — а не теряет добычу молча', () => {
  const b = bag(2);
  const left = addToBag(b, 'sword', 5); // 2 ячейки по 1

  assert.equal(left, 3, 'три меча не поместились');
  assert.ok(b.every((s) => s !== null));
});

test('в полную сумку всё равно можно досыпать начатую стопку', () => {
  const b: (Stack | null)[] = [{ id: 'mush_red', qty: 5 }, { id: 'sword', qty: 1 }];
  assert.equal(addToBag(b, 'mush_red', 4), 0, 'досыпалось в начатую');
  assert.equal(b[0]?.qty, 9);
});

test('неизвестный предмет не кладётся', () => {
  const b = bag();
  assert.equal(addToBag(b, 'выдумка', 1), 1);
  assert.equal(b[0], null);
});

test('взять одну штуку: стопка тает, пустая ячейка освобождается', () => {
  const b: (Stack | null)[] = [{ id: 'apple', qty: 2 }];

  assert.equal(takeOne(b, 0), 'apple');
  assert.equal(b[0]?.qty, 1);

  assert.equal(takeOne(b, 0), 'apple');
  assert.equal(b[0], null, 'ячейка освободилась');

  assert.equal(takeOne(b, 0), null, 'из пустой брать нечего');
});

test('счёт предметов идёт по всем стопкам', () => {
  const b: (Stack | null)[] = [{ id: 'mush_red', qty: 99 }, { id: 'sword', qty: 1 }, { id: 'mush_red', qty: 7 }];
  assert.equal(countOf(b, 'mush_red'), 106);
  assert.equal(countOf(b, 'crystal'), 0);
});

// --- инварианты таблицы ---

test('у каждого предмета есть имя, вкладка и иконка', () => {
  for (const [id, def] of Object.entries(ITEMS)) {
    assert.equal(def.id, id, `${id}: id не совпадает с ключом`);
    assert.ok(def.name, `${id}: нет имени`);
    assert.ok(def.stack > 0, `${id}: стопка ${def.stack}`);
    assert.ok(def.icon.w > 0 && def.icon.h > 0, `${id}: пустая иконка`);
  }
});

test('стопка не превышает 99 — трёхзначное число не влезет в ячейку', () => {
  for (const [id, def] of Object.entries(ITEMS)) {
    assert.ok(def.stack <= 99, `${id}: стопка ${def.stack}`);
  }
});

test('надеваемое не складывается в стопку', () => {
  // Иначе два меча в одной ячейке, а надет один — и непонятно, где второй.
  for (const [id, def] of Object.entries(ITEMS)) {
    if (def.slot) assert.equal(def.stack, 1, `${id} надевается, но стопкой ${def.stack}`);
  }
});

test('у надеваемого есть толк, у съедобного — эффект', () => {
  for (const [id, def] of Object.entries(ITEMS)) {
    if (def.slot) assert.ok(def.bonus, `${id} надевается, но ничего не даёт`);
    if (def.tab === 'food') assert.ok(def.use, `${id} еда, но не съедается`);
  }
});

test('на каждый слот экипировки есть хотя бы один предмет', () => {
  // Пустое гнездо, которое нечем занять, — это обещание, которого игра не держит.
  const slots = ['helm', 'body', 'weapon', 'shield', 'boots', 'ring', 'amulet'];
  for (const slot of slots) {
    assert.ok(Object.values(ITEMS).some((d) => d.slot === slot), `на слот ${slot} нет предмета`);
  }
});

test('грибы режутся из тайлсета карты, а на земле — вместе с травой', () => {
  for (const id of ['mush_red', 'mush_brown']) {
    const def = ITEMS[id];
    assert.equal(def.icon.sheet, 'Objects', `${id}: грибов нет в наборе интерфейса`);
    assert.ok(def.world, `${id}: нечем нарисовать на земле`);
    assert.ok(def.world!.h > def.icon.h, `${id}: на земле гриб должен быть с травой`);
  }
});
