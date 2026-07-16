import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATS, POINTS_PER_LEVEL, emptySpent, earned, unspent, spendPoint, bonusFrom, levelFromXp,
  type Spent,
} from './stats.ts';
import { xpToNext } from './creatures.ts';

test('на первом уровне очков нет', () => {
  // Очки дают ЗА уровень, а первый выдан даром.
  assert.equal(earned(1), 0);
  assert.equal(unspent(1, emptySpent()), 0);
});

test('за каждый уровень выдают три очка', () => {
  assert.equal(earned(2), 3);
  assert.equal(earned(10), 27);
  assert.equal(earned(2) - earned(1), POINTS_PER_LEVEL);
});

test('вложение уменьшает остаток', () => {
  const s = emptySpent();
  assert.equal(spendPoint(s, 'dmg', 2), true);
  assert.equal(s.dmg, 1);
  assert.equal(unspent(2, s), 2);
});

test('больше выданного не вложить', () => {
  // Иначе очки печатались бы из воздуха, и характеристики росли бы без уровней.
  const s = emptySpent();
  for (let i = 0; i < 3; i++) assert.equal(spendPoint(s, 'hp', 2), true);

  assert.equal(spendPoint(s, 'hp', 2), false, 'четвёртое очко на втором уровне');
  assert.equal(s.hp, 3, 'счётчик не сдвинулся от неудачной попытки');
  assert.equal(unspent(2, s), 0);
});

test('на первом уровне вложить нечего', () => {
  const s = emptySpent();
  assert.equal(spendPoint(s, 'dmg', 1), false);
  assert.equal(s.dmg, 0);
});

test('новый уровень открывает ровно три очка', () => {
  const s = emptySpent();
  for (let i = 0; i < 3; i++) spendPoint(s, 'dmg', 2);
  assert.equal(unspent(2, s), 0, 'на втором всё вложено');
  assert.equal(unspent(3, s), 3, 'третий уровень дал ещё три');
});

test('вложенное превращается в прибавки по таблице', () => {
  const s: Spent = { dmg: 2, hp: 3, mp: 1, def: 4 };
  assert.deepEqual(bonusFrom(s), { dmg: 2, hp: 30, mp: 5, def: 4 });
});

test('без вложений прибавок нет', () => {
  assert.deepEqual(bonusFrom(emptySpent()), { dmg: 0, hp: 0, mp: 0, def: 0 });
});

test('вложить можно в каждую характеристику из таблицы', () => {
  // Строка в окне без работающей кнопки — обещание, которого игра не держит.
  const s = emptySpent();
  const level = 1 + STATS.length; // хватит очков на одно в каждую
  for (const st of STATS) assert.equal(spendPoint(s, st.id, level), true, st.label);
  assert.equal(Object.values(s).reduce((a, b) => a + b, 0), STATS.length);
});

test('сумма вложенного никогда не превышает выданного', () => {
  // Главный инвариант: сколько бы игрок ни жал, из воздуха очки не возьмутся.
  const s = emptySpent();
  const level = 5; // 12 очков
  let ok = 0;
  for (let i = 0; i < 100; i++) {
    const stat = STATS[i % STATS.length].id;
    if (spendPoint(s, stat, level)) ok++;
  }
  assert.equal(ok, earned(level), 'удачных вложений ровно столько, сколько выдано');
  assert.equal(unspent(level, s), 0);
});

test('уровень по опыту считается тем же шагом, что и в игре', () => {
  assert.equal(levelFromXp(0), 1);
  assert.equal(levelFromXp(xpToNext(1) - 1), 1, 'чуть-чуть не хватило');
  assert.equal(levelFromXp(xpToNext(1)), 2, 'ровно на уровень');
  assert.equal(levelFromXp(xpToNext(1) + xpToNext(2)), 3);
});
