import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHARPEN_MAX, SCROLL_ID, sharpenChance, sharpenBonus, trySharpen } from './forge.ts';
import { countOf, type Stack } from './items.ts';

const bag = (scrolls = 0): (Stack | null)[] =>
  scrolls > 0 ? [{ id: SCROLL_ID, qty: scrolls }, null, null] : [null, null, null];

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

test('sharpenBonus режет в честный диапазон 0..MAX', () => {
  assert.equal(sharpenBonus(undefined), 0, 'нет заточки — ноль');
  assert.equal(sharpenBonus(-3), 0, 'отрицательная срезается');
  assert.equal(sharpenBonus(3), 3);
  assert.equal(sharpenBonus(2.9), 2, 'дробь вниз');
  assert.equal(sharpenBonus(SHARPEN_MAX + 5), SHARPEN_MAX, 'выше предела не бывает');
});

test('успех: возвращается новый уровень, свиток съеден', () => {
  const b = bag(3);
  const res = trySharpen(0, 'sword', b, () => 0); // rng 0 < 0.8 — успех
  assert.ok(res.ok);
  if (res.ok) {
    assert.equal(res.success, true);
    assert.equal(res.level, 1, 'новый уровень — применяет вызывающий');
    assert.equal(res.target, 1);
  }
  assert.equal(countOf(b, SCROLL_ID), 2, 'один свиток сгорел');
});

test('НЕУДАЧА: свиток сгорает, но уровень возвращается ПРЕЖНИЙ', () => {
  const b = bag(2);
  const res = trySharpen(4, 'sword', b, () => 0.99); // 0.99 >= 0.8 — мимо
  assert.ok(res.ok);
  if (res.ok) {
    assert.equal(res.success, false);
    assert.equal(res.level, 4, 'уровень не упал');
    assert.equal(res.target, 5, 'целились в +5');
  }
  assert.equal(countOf(b, SCROLL_ID), 1, 'свиток всё равно съеден');
});

test('шанс берётся по ЦЕЛЕВОМУ уровню: с +5 на +6 уже 40%', () => {
  // rng 0.5: против 40% (0.5 >= 0.4) — неудача. Если бы бралось 80% — был бы успех.
  const res = trySharpen(5, 'bow', bag(1), () => 0.5);
  assert.ok(res.ok && !res.success, 'на +6 шанс уже 40%, бросок 0.5 обязан промазать');
  // rng 0.39 < 0.4 — успех.
  const res2 = trySharpen(5, 'bow', bag(1), () => 0.39);
  assert.ok(res2.ok && res2.success);
  if (res2.ok) assert.equal(res2.level, 6);
});

test('без свитков попытки нет и ничего не тратится', () => {
  const b = bag(0);
  const res = trySharpen(0, 'sword', b, () => 0);
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.reason, /Scroll/);
});

test('на пределе +20 точить нельзя, свиток не тратится', () => {
  const b = bag(5);
  const res = trySharpen(SHARPEN_MAX, 'sword', b, () => 0);
  assert.equal(res.ok, false);
  assert.equal(countOf(b, SCROLL_ID), 5, 'свитки целы');
});

test('точится только оружие: яблоко и пустая рука — мимо', () => {
  const b = bag(5);
  assert.equal(trySharpen(0, 'apple', b, () => 0).ok, false, 'яблоко не оружие');
  assert.equal(trySharpen(0, undefined, b, () => 0).ok, false, 'нет оружия');
  assert.equal(trySharpen(0, 'НЕТ_ТАКОГО', b, () => 0).ok, false, 'неизвестный предмет');
  assert.equal(countOf(b, SCROLL_ID), 5, 'ни один свиток не потрачен');
});

test('id-ключ прототипа не точится и не роняет бросок', () => {
  for (const evil of ['constructor', '__proto__', 'toString']) {
    const res = trySharpen(0, evil, bag(1), () => 0);
    assert.equal(res.ok, false, `${evil} не должен точиться`);
  }
});

test('до +20 при вечном успехе нужно ровно 20 свитков', () => {
  const b: (Stack | null)[] = [{ id: SCROLL_ID, qty: 20 }, { id: SCROLL_ID, qty: 20 }];
  let plus = 0;
  let attempts = 0;
  while (plus < SHARPEN_MAX) {
    const res = trySharpen(plus, 'sword', b, () => 0);
    assert.ok(res.ok, 'попытка возможна, пока есть свитки и не предел');
    if (res.ok) plus = res.level;
    attempts++;
    assert.ok(attempts <= SHARPEN_MAX, 'больше 20 попыток при вечном успехе — баг');
  }
  assert.equal(attempts, SHARPEN_MAX);
  assert.equal(countOf(b, SCROLL_ID), 40 - SHARPEN_MAX);
  assert.equal(sharpenBonus(plus), SHARPEN_MAX, 'прибавка равна уровню');
});
