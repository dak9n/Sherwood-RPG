import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bind, swap, unbind, canBind, findInBag, countFor, emptyHotbar, HOTBAR_SIZE } from './hotbar.ts';
import { addToBag, sortBag, ITEMS, type Stack } from './items.ts';

const bag = (size = 10): (Stack | null)[] => new Array(size).fill(null);

test('пустая панель — это HOTBAR_SIZE пустых ячеек', () => {
  const bar = emptyHotbar();
  assert.equal(bar.length, HOTBAR_SIZE);
  assert.ok(bar.every((s) => s === null));
});

test('на панель идёт то, на что клик в сумке что-то делает', () => {
  assert.equal(canBind('potion_hp'), true, 'зелье применяется');
  assert.equal(canBind('sword'), true, 'меч надевается');
  assert.equal(canBind('ore_copper'), false, 'слиток ничего не делает — мёртвая клавиша не нужна');
  assert.equal(canBind('нет такого'), false);
});

test('привязка кладёт предмет в ячейку', () => {
  const bar = emptyHotbar();
  assert.equal(bind(bar, 0, 'potion_hp'), true);
  assert.equal(bar[0], 'potion_hp');
});

test('ресурс на панель не вешается', () => {
  const bar = emptyHotbar();
  assert.equal(bind(bar, 0, 'ore_copper'), false);
  assert.equal(bar[0], null);
});

test('за пределы панели привязать нельзя', () => {
  const bar = emptyHotbar();
  assert.equal(bind(bar, HOTBAR_SIZE, 'potion_hp'), false);
  assert.equal(bind(bar, -1, 'potion_hp'), false);
});

test('один вид — одна ячейка: повторная привязка переносит, а не дублирует', () => {
  // Иначе одно и то же зелье расползлось бы по всей панели.
  const bar = emptyHotbar();
  bind(bar, 0, 'potion_hp');
  bind(bar, 3, 'potion_hp');

  assert.equal(bar[3], 'potion_hp');
  assert.equal(bar[0], null, 'со старого места ушло');
  assert.equal(bar.filter((s) => s === 'potion_hp').length, 1);
});

test('привязка в занятую ячейку меняет их местами', () => {
  const bar = emptyHotbar();
  bind(bar, 0, 'potion_hp');
  bind(bar, 1, 'apple');
  bind(bar, 1, 'potion_hp'); // тащим зелье на яблоко

  assert.equal(bar[1], 'potion_hp');
  assert.equal(bar[0], 'apple', 'яблоко переехало на освободившееся место');
});

test('снятие освобождает ячейку', () => {
  const bar = emptyHotbar();
  bind(bar, 2, 'apple');
  unbind(bar, 2);
  assert.equal(bar[2], null);
});

test('перестановка меняет ячейки местами', () => {
  const bar = emptyHotbar();
  bind(bar, 0, 'apple');
  swap(bar, 0, 9);
  assert.equal(bar[9], 'apple');
  assert.equal(bar[0], null);
});

test('ячейка находит предмет в сумке', () => {
  const b = bag();
  addToBag(b, 'mush_red', 5);
  const bar = emptyHotbar();
  bind(bar, 0, 'mush_red');

  assert.equal(findInBag(bar, 0, b), 0);
  assert.equal(countFor(bar, 0, b), 5);
});

test('раскладка сумки не ломает привязки', () => {
  // Ради этого ячейка и помнит вид предмета, а не номер места: «Разложить»
  // переставляет всю сумку, и привязка по номеру после неё била бы мимо.
  const b = bag(20);
  addToBag(b, 'mush_red', 3);
  addToBag(b, 'sword', 1);
  addToBag(b, 'potion_hp', 2);

  const bar = emptyHotbar();
  bind(bar, 0, 'potion_hp');
  const wasAt = findInBag(bar, 0, b);

  sortBag(b);
  const nowAt = findInBag(bar, 0, b);

  assert.notEqual(nowAt, -1, 'зелье не потерялось');
  assert.notEqual(nowAt, wasAt, 'место в сумке действительно изменилось');
  assert.equal(b[nowAt]?.id, 'potion_hp', 'ячейка по-прежнему указывает на зелье');
  assert.equal(countFor(bar, 0, b), 2);
});

test('кончился предмет — привязка остаётся, но брать нечего', () => {
  // Набрал грибов — и клавиша снова работает. Снимать привязку было бы обидно.
  const b = bag();
  addToBag(b, 'mush_red', 1);
  const bar = emptyHotbar();
  bind(bar, 0, 'mush_red');

  b[0] = null; // съели последний

  assert.equal(findInBag(bar, 0, b), -1, 'брать нечего');
  assert.equal(countFor(bar, 0, b), 0);
  assert.equal(bar[0], 'mush_red', 'привязка на месте');
});

test('пустая ячейка ничего не находит', () => {
  const b = bag();
  addToBag(b, 'mush_red', 5);
  assert.equal(findInBag(emptyHotbar(), 0, b), -1);
  assert.equal(countFor(emptyHotbar(), 0, b), 0);
});

test('всё, что падает с монстров и применяется, можно повесить на панель', () => {
  // Панель бесполезна, если на неё нечего вешать.
  const usable = Object.values(ITEMS).filter((d) => d.use || d.slot);
  assert.ok(usable.length >= HOTBAR_SIZE, `предметов для панели ${usable.length}, ячеек ${HOTBAR_SIZE}`);
  for (const d of usable) assert.equal(canBind(d.id), true, `${d.name} должен вешаться`);
});
