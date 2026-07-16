import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHARPEN_MAX, SCROLL_ID, sharpenChance, plusOf, sharpenBonus, trySharpen, type Sharpen } from './forge.ts';
import { countOf, type Stack } from './items.ts';

const bag = (scrolls = 0): (Stack | null)[] =>
  scrolls > 0 ? [{ id: SCROLL_ID, qty: scrolls }, null, null] : [null, null, null];

const fresh = (): Sharpen => ({});

test('СТУПЕНИ ШАНСОВ — ровно как просил заказчик: 80/40/20/10', () => {
  for (let t = 1; t <= 5; t++) assert.equal(sharpenChance(t), 0.8, `+${t}`);
  for (let t = 6; t <= 10; t++) assert.equal(sharpenChance(t), 0.4, `+${t}`);
  for (let t = 11; t <= 15; t++) assert.equal(sharpenChance(t), 0.2, `+${t}`);
  for (let t = 16; t <= 20; t++) assert.equal(sharpenChance(t), 0.1, `+${t}`);
});

test('вне диапазона шанс нулевой', () => {
  assert.equal(sharpenChance(0), 0);
  assert.equal(sharpenChance(SHARPEN_MAX + 1), 0);
  assert.equal(sharpenChance(-3), 0);
  assert.equal(sharpenChance(2.5), 0, 'дробный уровень — не уровень');
});

test('успех: уровень растёт, свиток съеден', () => {
  const s = fresh();
  const b = bag(3);
  const res = trySharpen(s, 'sword', b, () => 0); // rng 0 < 0.8 — успех
  assert.ok(res.ok);
  if (res.ok) {
    assert.equal(res.success, true);
    assert.equal(res.level, 1);
  }
  assert.equal(s.sword, 1);
  assert.equal(countOf(b, SCROLL_ID), 2, 'один свиток сгорел');
});

test('НЕУДАЧА: свиток сгорает, но заточка ЦЕЛА', () => {
  const s = fresh();
  s.sword = 4;
  const b = bag(2);
  const res = trySharpen(s, 'sword', b, () => 0.99); // 0.99 >= 0.8 — мимо
  assert.ok(res.ok);
  if (res.ok) {
    assert.equal(res.success, false);
    assert.equal(res.level, 4, 'уровень не упал');
    assert.equal(res.target, 5, 'целились в +5');
  }
  assert.equal(s.sword, 4);
  assert.equal(countOf(b, SCROLL_ID), 1, 'свиток всё равно съеден');
});

test('шанс берётся по ЦЕЛЕВОМУ уровню: на +6 уже 40%', () => {
  const s = fresh();
  s.bow = 5;
  // rng 0.5: против 40% (0.5 >= 0.4) — неудача. Если бы бралось 80% — был бы успех.
  const res = trySharpen(s, 'bow', bag(1), () => 0.5);
  assert.ok(res.ok && !res.success, 'на +6 шанс уже 40%, бросок 0.5 обязан промазать');
  // rng 0.39 < 0.4 — успех.
  const res2 = trySharpen(s, 'bow', bag(1), () => 0.39);
  assert.ok(res2.ok && res2.success);
  assert.equal(s.bow, 6);
});

test('без свитков попытки нет и ничего не тратится', () => {
  const s = fresh();
  const b = bag(0);
  const res = trySharpen(s, 'sword', b, () => 0);
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.reason, /свитк/);
  assert.equal(plusOf(s, 'sword'), 0);
});

test('на пределе +20 точить нельзя, свиток не тратится', () => {
  const s = fresh();
  s.sword = SHARPEN_MAX;
  const b = bag(5);
  const res = trySharpen(s, 'sword', b, () => 0);
  assert.equal(res.ok, false);
  assert.equal(countOf(b, SCROLL_ID), 5, 'свитки целы');
  assert.equal(s.sword, SHARPEN_MAX);
});

test('точится только оружие: яблоко и пустая рука — мимо', () => {
  const s = fresh();
  const b = bag(5);
  assert.equal(trySharpen(s, 'apple', b, () => 0).ok, false, 'яблоко не оружие');
  assert.equal(trySharpen(s, undefined, b, () => 0).ok, false, 'нет оружия');
  assert.equal(trySharpen(s, 'НЕТ_ТАКОГО', b, () => 0).ok, false, 'неизвестный предмет');
  assert.equal(countOf(b, SCROLL_ID), 5, 'ни один свиток не потрачен');
});

test('id-ключ прототипа не точится и не роняет бросок', () => {
  const s = fresh();
  for (const evil of ['constructor', '__proto__', 'toString']) {
    const res = trySharpen(s, evil, bag(1), () => 0);
    assert.equal(res.ok, false, `${evil} не должен точиться`);
  }
});

test('до +20 при вечном успехе нужно ровно 20 свитков', () => {
  const s = fresh();
  const b: (Stack | null)[] = [{ id: SCROLL_ID, qty: 20 }, { id: SCROLL_ID, qty: 20 }];
  let attempts = 0;
  while (plusOf(s, 'sword') < SHARPEN_MAX) {
    const res = trySharpen(s, 'sword', b, () => 0);
    assert.ok(res.ok, 'попытка возможна, пока есть свитки и не предел');
    attempts++;
    assert.ok(attempts <= SHARPEN_MAX, 'больше 20 попыток при вечном успехе — баг');
  }
  assert.equal(attempts, SHARPEN_MAX);
  assert.equal(countOf(b, SCROLL_ID), 40 - SHARPEN_MAX);
  assert.equal(sharpenBonus(s, 'sword'), SHARPEN_MAX, 'прибавка равна уровню');
});

test('заточка одного оружия не задевает другое', () => {
  const s = fresh();
  trySharpen(s, 'sword', bag(1), () => 0);
  assert.equal(plusOf(s, 'sword'), 1);
  assert.equal(plusOf(s, 'bow'), 0, 'лук не тронут');
  assert.equal(sharpenBonus(s, undefined), 0, 'без оружия прибавки нет');
});
