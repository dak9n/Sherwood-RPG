import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHOP_STOCK, VALUE, buyPrice, sellPrice, buyItem, sellStack } from './shop.ts';
import { ITEMS, countOf, type Stack } from './items.ts';
import { STARTER_WEAPON } from './equipment.ts';

test('СТАРТОВЫЙ МЕЧ НЕ ПРОДАЁТСЯ: его бесплатно переиздают при загрузке', () => {
  // Дыра из состязательной проверки: меч выдаётся даром при заходе, а продавался
  // за золото — «снял, продал, перезашёл» давало бесконечное золото. Теперь нет.
  assert.equal(sellPrice(STARTER_WEAPON), 0, 'цена продажи стартового меча — ноль');
  const b: (Stack | null)[] = [{ id: STARTER_WEAPON, qty: 1 }, null];
  const res = sellStack(100, b, 0);
  assert.equal(res.ok, false, 'продать стартовый меч нельзя');
  assert.equal(b[0]?.id, STARTER_WEAPON, 'меч остался в сумке, золото не начислено');
});

const bag = (size = 5): (Stack | null)[] => new Array(size).fill(null);

test('у каждого предмета игры есть ценность — иначе продать нельзя, а это дыра', () => {
  for (const id of Object.keys(ITEMS)) {
    assert.ok(VALUE[id] > 0, `у ${id} нет ценности в магазине`);
  }
});

test('витрина продаёт только известные предметы', () => {
  for (const id of SHOP_STOCK) assert.ok(Object.hasOwn(ITEMS, id), `${id} нет в игре`);
});

test('продажа дешевле покупки — иначе бесконечное золото на перепродаже', () => {
  for (const id of SHOP_STOCK) {
    const buy = buyPrice(id)!;
    assert.ok(sellPrice(id) < buy, `${id}: продажа ${sellPrice(id)} не ниже покупки ${buy}`);
  }
});

test('buyPrice: непродаваемое даёт null', () => {
  assert.equal(buyPrice('potion_hp'), VALUE.potion_hp);
  assert.equal(buyPrice('sword_blue'), null, 'синий меч в лавке не купить');
  assert.equal(buyPrice('НЕТ_ТАКОГО'), null);
});

test('покупка: золото списано, предмет в сумке', () => {
  const b = bag();
  const price = buyPrice('potion_hp')!;
  const res = buyItem(price + 10, b, 'potion_hp');
  assert.ok(res.ok);
  if (res.ok) assert.equal(res.gold, 10, 'осталось золото за вычетом цены');
  assert.equal(countOf(b, 'potion_hp'), 1);
});

test('НЕ ХВАТАЕТ ЗОЛОТА: сумка и золото не тронуты', () => {
  const b = bag();
  const price = buyPrice('bow')!;
  const res = buyItem(price - 1, b, 'bow');
  assert.equal(res.ok, false);
  assert.equal(countOf(b, 'bow'), 0, 'предмет не выдан');
});

test('СУМКА ПОЛНА: золото не списывается за воздух', () => {
  // Все ячейки заняты несливаемым оружием (стопка 1) — места нет.
  const full: (Stack | null)[] = new Array(3).fill(null).map(() => ({ id: 'sword', qty: 1 }));
  const res = buyItem(9999, full, 'potion_hp');
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.reason, /полн/);
});

test('нельзя купить то, чего нет на витрине, даже с горой золота', () => {
  const b = bag();
  const res = buyItem(100000, b, 'sword_blue');
  assert.equal(res.ok, false);
  assert.equal(countOf(b, 'sword_blue'), 0);
});

test('id-ключ прототипа не покупается', () => {
  for (const evil of ['constructor', '__proto__', 'toString']) {
    const res = buyItem(100000, bag(), evil);
    assert.equal(res.ok, false, `${evil} не должен покупаться`);
  }
});

test('продажа стопки: золото за всю стопку, ячейка пустеет', () => {
  const b: (Stack | null)[] = [{ id: 'mush_red', qty: 3 }, null, null, null, null];
  const res = sellStack(10, b, 0);
  assert.ok(res.ok);
  if (res.ok) {
    assert.equal(res.total, sellPrice('mush_red') * 3, 'цена за штуку помножена на стопку');
    assert.equal(res.gold, 10 + res.total, 'золото выросло ровно на выручку');
    assert.equal(res.qty, 3);
  }
  assert.equal(b[0], null, 'ячейка освободилась');
  assert.equal(countOf(b, 'mush_red'), 0, 'ничего не осталось');
});

test('пустую ячейку не продать', () => {
  const res = sellStack(0, bag(), 2);
  assert.equal(res.ok, false);
});

test('золото при покупке-продаже сходится: продал купленное — вернулась доля, не больше', () => {
  const b = bag();
  const start = 1000;
  const afterBuy = buyItem(start, b, 'potion_hp');
  assert.ok(afterBuy.ok);
  const gold1 = afterBuy.ok ? afterBuy.gold : start;
  const idx = b.findIndex((s) => s?.id === 'potion_hp');
  const afterSell = sellStack(gold1, b, idx);
  assert.ok(afterSell.ok);
  const gold2 = afterSell.ok ? afterSell.gold : gold1;
  assert.ok(gold2 < start, `перепродажа не должна давать прибыль: было ${start}, стало ${gold2}`);
});
