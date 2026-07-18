import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MarketStore,
  cleanTradeItem,
  MARKET_COMMISSION,
  LISTING_TTL,
  MAX_LOTS_PER_SELLER,
  MAX_PRICE,
} from './market-store.ts';

const T0 = 1_000_000;
const fresh = (persist = () => {}): MarketStore => new MarketStore({}, persist);
const sword = (sharpen?: number) => ({ id: 'sword', qty: 1, ...(sharpen ? { sharpen } : {}) });

test('cleanTradeItem: только наш id, количество и заточка в рамках', () => {
  assert.equal(cleanTradeItem({ id: 'НЕТ', qty: 1 }), null, 'чужой id');
  assert.equal(cleanTradeItem({ id: 'apple', qty: 0 }), null, 'ноль штук');
  assert.equal(cleanTradeItem({ id: 'apple', qty: 999 }), null, 'больше предела стопки');
  assert.deepEqual(cleanTradeItem({ id: 'apple', qty: 5 }), { id: 'apple', qty: 5 });
  // заточка только у оружия и не выше предела
  assert.deepEqual(cleanTradeItem({ id: 'sword', qty: 1, sharpen: 5 }), { id: 'sword', qty: 1, sharpen: 5 });
  assert.deepEqual(cleanTradeItem({ id: 'sword', qty: 1, sharpen: 999 }), { id: 'sword', qty: 1, sharpen: 20 });
  assert.deepEqual(cleanTradeItem({ id: 'apple', qty: 1, sharpen: 5 }), { id: 'apple', qty: 1 }, 'у яблока заточки нет');
  // защита от прототипа
  assert.equal(cleanTradeItem({ id: 'constructor', qty: 1 }), null);
});

test('выставить лот: появляется, цена и заточка целы', () => {
  const m = fresh();
  const r = m.list('ann', 'Ann', sword(5), 1000, T0);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.lot.price, 1000);
    assert.equal(r.lot.item.sharpen, 5);
    assert.equal(r.lot.expiresAt, T0 + LISTING_TTL);
  }
  assert.equal(m.browse({}, T0).total, 1);
});

test('выставить: кривой предмет и кривая цена — отказ', () => {
  const m = fresh();
  assert.equal(m.list('ann', 'Ann', { id: 'НЕТ', qty: 1 }, 100, T0).ok, false);
  assert.equal(m.list('ann', 'Ann', sword(), 0, T0).ok, false, 'цена 0');
  assert.equal(m.list('ann', 'Ann', sword(), MAX_PRICE + 1, T0).ok, false, 'цена выше предела');
});

test('лимит лотов на продавца', () => {
  const m = fresh();
  for (let i = 0; i < MAX_LOTS_PER_SELLER; i++) assert.ok(m.list('ann', 'Ann', sword(), 100, T0).ok);
  assert.equal(m.list('ann', 'Ann', sword(), 100, T0).ok, false, 'сверх лимита нельзя');
});

test('купить: лот исчезает, продавцу капает выручка минус комиссия, есть история', () => {
  const m = fresh();
  const lot = m.list('ann', 'Ann', sword(3), 1000, T0);
  assert.ok(lot.ok);
  const id = lot.ok ? lot.lot.id : '';

  const buy = m.buy('bob', 'Bob', id, T0 + 10);
  assert.ok(buy.ok);
  if (buy.ok) {
    assert.equal(buy.price, 1000);
    assert.deepEqual(buy.item, { id: 'sword', qty: 1, sharpen: 3 }, 'покупатель получает заточенный меч');
  }
  // лот пропал
  assert.equal(m.browse({}, T0 + 10).total, 0);
  // продавцу — золото по почте за вычетом 5%
  const mail = m.mailFor('ann');
  assert.equal(mail.length, 1);
  assert.equal(mail[0].kind, 'gold');
  if (mail[0].kind === 'gold') assert.equal(mail[0].amount, 1000 - Math.round(1000 * MARKET_COMMISSION));
  // история у обоих
  assert.equal(m.historyFor('ann').length, 1);
  assert.equal(m.historyFor('bob').length, 1);
  assert.equal(m.historyFor('carl').length, 0);
});

test('нельзя купить свой лот и нельзя купить дважды', () => {
  const m = fresh();
  const lot = m.list('ann', 'Ann', sword(), 500, T0);
  const id = lot.ok ? lot.lot.id : '';
  assert.equal(m.buy('ann', 'Ann', id, T0 + 1).ok, false, 'свой лот');
  assert.ok(m.buy('bob', 'Bob', id, T0 + 2).ok, 'первый покупатель успел');
  assert.equal(m.buy('carl', 'Carl', id, T0 + 3).ok, false, 'второй — лот уже ушёл');
});

test('снять свой лот: предмет возвращается по почте; чужой снять нельзя', () => {
  const m = fresh();
  const lot = m.list('ann', 'Ann', sword(7), 800, T0);
  const id = lot.ok ? lot.lot.id : '';
  assert.equal(m.cancel('bob', id, T0 + 1).ok, false, 'чужой лот');
  assert.ok(m.cancel('ann', id, T0 + 2).ok);
  assert.equal(m.browse({}, T0 + 2).total, 0, 'лот снят с витрины');
  const mail = m.mailFor('ann');
  assert.equal(mail.length, 1);
  assert.equal(mail[0].kind, 'item');
  if (mail[0].kind === 'item') assert.deepEqual(mail[0].item, { id: 'sword', qty: 1, sharpen: 7 });
});

test('истёкший лот уходит с витрины и возвращается продавцу по почте', () => {
  const m = fresh();
  m.list('ann', 'Ann', sword(), 100, T0);
  assert.equal(m.browse({}, T0 + LISTING_TTL - 1).total, 1, 'ещё жив');
  const after = m.browse({}, T0 + LISTING_TTL + 1);
  assert.equal(after.total, 0, 'истёк — с витрины пропал');
  assert.equal(m.mailFor('ann').length, 1, 'предмет вернулся на почту');
});

test('почта: ack удаляет только принятое, остальное ждёт', () => {
  const m = fresh();
  // две записи на почте: продажа-золото и возврат-предмет
  const lot = m.list('ann', 'Ann', sword(), 500, T0);
  m.buy('bob', 'Bob', lot.ok ? lot.lot.id : '', T0 + 1);
  const lot2 = m.list('ann', 'Ann', { id: 'apple', qty: 3 }, 90, T0 + 2);
  m.cancel('ann', lot2.ok ? lot2.lot.id : '', T0 + 3);

  const box = m.mailFor('ann');
  assert.equal(box.length, 2);
  // приняли только первую
  assert.equal(m.ackMail('ann', [box[0].id]).removed, 1);
  const left = m.mailFor('ann');
  assert.equal(left.length, 1, 'вторая ждёт');
  assert.equal(left[0].id, box[1].id);
});

test('витрина: фильтр по категории, поиску, редкости и excludeSeller', () => {
  const m = fresh();
  m.list('ann', 'Ann', sword(), 1000, T0); // оружие, epic? sword — uncommon
  m.list('ann', 'Ann', { id: 'apple', qty: 5 }, 50, T0); // расходник
  m.list('bob', 'Bob', { id: 'crystal', qty: 2 }, 300, T0); // ресурс, uncommon

  assert.equal(m.browse({ category: 'weapon' }, T0).total, 1);
  assert.equal(m.browse({ category: 'consumable' }, T0).total, 1);
  assert.equal(m.browse({ search: 'меч' }, T0).total, 1);
  assert.equal(m.browse({ rarity: 'uncommon' }, T0).total, 2, 'меч и кристалл');
  assert.equal(m.browse({ excludeSeller: 'ann' }, T0).total, 1, 'без анниных — только бобов');
});

test('витрина: сортировка по цене и пагинация', () => {
  const m = fresh();
  m.list('ann', 'Ann', { id: 'apple', qty: 1 }, 300, T0);
  m.list('ann', 'Ann', { id: 'apple', qty: 1 }, 100, T0);
  m.list('ann', 'Ann', { id: 'apple', qty: 1 }, 200, T0);

  const asc = m.browse({ sort: 'price_asc' }, T0);
  assert.deepEqual(asc.lots.map((l) => l.price), [100, 200, 300]);

  const p1 = m.browse({ sort: 'price_asc', page: 1, pageSize: 2 }, T0);
  assert.deepEqual(p1.lots.map((l) => l.price), [100, 200]);
  assert.equal(p1.pages, 2);
  const p2 = m.browse({ sort: 'price_asc', page: 2, pageSize: 2 }, T0);
  assert.deepEqual(p2.lots.map((l) => l.price), [300]);
});

test('persist зовётся на каждое изменение и снимок восстанавливается', () => {
  let saved = 0;
  let snap = null as ReturnType<MarketStore['snapshot']> | null;
  const m = new MarketStore({}, (s) => { saved++; snap = s; });
  m.list('ann', 'Ann', sword(4), 700, T0);
  assert.ok(saved >= 1);
  // восстановление из снимка
  const m2 = new MarketStore(snap!);
  const back = m2.browse({}, T0);
  assert.equal(back.total, 1);
  assert.equal(back.lots[0].item.sharpen, 4, 'заточка пережила перезапуск');
});
