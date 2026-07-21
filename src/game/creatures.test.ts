import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HERO, MONSTERS, BOSSES, ALL_CREATURES, SPAWNS, BOSS_SPAWNS, xpToNext, rollDrop, rollGold,
} from './creatures.ts';
import { ITEMS } from './items.ts';
import { SHOP_STOCK } from './shop.ts';
import { STARTER_WEAPON } from './equipment.ts';

test('rollGold: не выходит за диапазон, концы достижимы', () => {
  assert.equal(rollGold([5, 5]), 5, 'вырожденный диапазон — само число');
  assert.equal(rollGold([2, 8], () => 0), 2, 'rng=0 даёт минимум');
  assert.equal(rollGold([2, 8], () => 0.9999), 8, 'rng у единицы даёт максимум');
  for (let i = 0; i < 200; i++) {
    const g = rollGold([3, 7]);
    assert.ok(g >= 3 && g <= 7, `выпало ${g} вне [3,7]`);
  }
});

test('у каждого монстра диапазон золота разумный: 0 <= min <= max', () => {
  for (const [name, m] of Object.entries(ALL_CREATURES)) {
    assert.ok(m.gold[0] >= 0 && m.gold[0] <= m.gold[1], `${name}: диапазон золота ${m.gold} кривой`);
  }
});

test('у каждого монстра есть имя и уровень — их показывают над ним', () => {
  for (const [key, m] of Object.entries(ALL_CREATURES)) {
    assert.ok(m.name && m.name.trim().length > 0, `${key}: пустое имя`);
    assert.ok(Number.isInteger(m.level) && m.level >= 1, `${key}: кривой уровень ${m.level}`);
  }
});

test('от любого паука можно убежать', () => {
  // Монстр быстрее игрока — это смерть без выхода. Числа держим строго ниже.
  for (const [name, m] of Object.entries(ALL_CREATURES)) {
    assert.ok(m.speed < HERO.speed, `${name}: скорость ${m.speed} не ниже ${HERO.speed}`);
  }
});

test('паук бросается ближе, чем теряет — иначе задёргается на границе', () => {
  for (const [name, m] of Object.entries(ALL_CREATURES)) {
    assert.ok(m.reach < m.aggro, `${name}: бьёт с ${m.reach}, а агрится с ${m.aggro}`);
    assert.ok(m.aggro < m.deaggro, `${name}: агро ${m.aggro} не меньше деагро ${m.deaggro}`);
    // запас нужен, чтобы на границе радиуса состояние не переключалось каждый кадр
    assert.ok(m.deaggro >= m.aggro * 1.5, `${name}: деагро слишком близко к агро`);
  }
});

test('пауза между ударами длиннее самого удара', () => {
  // Длину удара считаем по листу этого монстра: у гриба 8 кадров при 16 к/с —
  // 500 мс, у голема 9 — 562. Если пауза короче, монстр бьёт без остановки.
  for (const [name, m] of Object.entries(ALL_CREATURES)) {
    const attackMs = ((m.cols?.attack ?? 8) / 16) * 1000;
    assert.ok(m.cooldown > attackMs, `${name}: пауза ${m.cooldown} мс не больше удара ${attackMs} мс`);
  }
});

test('кадр удара существует в анимации', () => {
  // Кадр удара обязан лежать внутри ряда атаки ИМЕННО ЭТОГО листа. Проверка не
  // абстрактная: Monster.onAnimFrame ищет попадание как row * cols + hitFrame,
  // и кадр за пределами ряда уехал бы в чужое направление — босс бил бы вбок.
  assert.ok(HERO.hitFrame >= 0 && HERO.hitFrame < 8);
  for (const [name, m] of Object.entries(ALL_CREATURES)) {
    const cols = m.cols?.attack ?? 8;
    assert.ok(m.hitFrame >= 0 && m.hitFrame < cols, `${name}: кадр удара ${m.hitFrame} вне ряда из ${cols}`);
  }
});

test('у всех есть здоровье и урон', () => {
  assert.ok(HERO.hp > 0 && HERO.dmgMin > 0 && HERO.dmgMax >= HERO.dmgMin);
  for (const [name, m] of Object.entries(ALL_CREATURES)) {
    assert.ok(m.hp > 0, `${name}: нет здоровья`);
    assert.ok(m.dmg > 0, `${name}: нет урона`);
  }
});

test('расселяем только существующих монстров', () => {
  for (const s of SPAWNS) {
    assert.ok(MONSTERS[s.kind], `в расселении ${s.kind}, а в таблице такого нет`);
    assert.ok(s.count > 0);
  }
  for (const s of BOSS_SPAWNS) {
    assert.ok(BOSSES[s.kind], `в расселении боссов ${s.kind}, а в таблице такого нет`);
    assert.ok(s.count > 0);
  }
});

test('паука можно убить за разумное число взмахов', () => {
  const avg = (HERO.dmgMin + HERO.dmgMax) / 2;
  for (const [name, m] of Object.entries(MONSTERS)) {
    const hits = Math.ceil(m.hp / avg);
    // 3 взмаха на слабого — бодро, 9 на сильного — уже почти пила по дереву
    assert.ok(hits >= 2 && hits <= 10, `${name}: ${hits} взмахов — это не бой`);
  }
});

test('здоровье растёт вместе с размером паука', () => {
  // spider1 27x32, spider2 27x33, spider3 37x40 — глазом видно, кто главнее
  assert.ok(MONSTERS.spider1.hp < MONSTERS.spider2.hp);
  assert.ok(MONSTERS.spider2.hp < MONSTERS.spider3.hp);
  assert.ok(MONSTERS.spider1.xp < MONSTERS.spider3.xp, 'за сильного и опыта больше');
});

test('тяжёлый удар по карману, но не бесконечен', () => {
  const swings = Math.floor(HERO.mp / HERO.heavyCost);
  assert.ok(swings >= 2 && swings <= 4, `${swings} тяжёлых подряд — это перебор или бессмыслица`);
  assert.ok(HERO.heavyMul > 1);
});

test('опыт до уровня растёт', () => {
  assert.equal(xpToNext(1), 20);
  assert.ok(xpToNext(2) > xpToNext(1));
  assert.ok(xpToNext(3) > xpToNext(2));

  // первый уровень — с трёх-четырёх слабых пауков
  assert.ok(xpToNext(1) / MONSTERS.spider1.xp <= 4);
});

// --- добыча ---

test('падает только то, что есть в таблице предметов', () => {
  for (const [name, m] of Object.entries(ALL_CREATURES)) {
    for (const d of m.drop) {
      assert.ok(ITEMS[d.id], `${name} роняет ${d.id}, а такого предмета нет`);
    }
  }
});

test('вероятности осмысленные', () => {
  for (const [name, m] of Object.entries(ALL_CREATURES)) {
    for (const d of m.drop) {
      assert.ok(d.chance > 0 && d.chance <= 1, `${name}/${d.id}: шанс ${d.chance}`);
      if (d.max !== undefined) assert.ok(d.max >= (d.min ?? 1), `${name}/${d.id}: max меньше min`);
    }
  }
});

test('с каждого паука что-то падает достаточно часто, чтобы это заметить', () => {
  for (const [name, m] of Object.entries(ALL_CREATURES)) {
    // вероятность, что не упадёт ничего
    const nothing = m.drop.reduce((p, d) => p * (1 - d.chance), 1);
    assert.ok(nothing < 0.5, `${name}: с вероятностью ${(nothing * 100) | 0}% не падает ничего`);
  }
});

test('каждый надеваемый предмет откуда-то берётся: дроп, магазин или старт', () => {
  // Недостижимый предмет хуже отсутствующего: слот в экипировке обещает то,
  // чего игра не даёт. Источников теперь три: выпадает с монстра, продаётся в
  // лавке или выдаётся героем на старте (меч новобранца).
  const dropped = new Set(Object.values(ALL_CREATURES).flatMap((m) => m.drop.map((d) => d.id)));
  const buyable = new Set(SHOP_STOCK);
  for (const [id, def] of Object.entries(ITEMS)) {
    if (!def.slot) continue;
    const reachable = dropped.has(id) || buyable.has(id) || id === STARTER_WEAPON;
    assert.ok(reachable, `${id} надевается, но его неоткуда взять`);
  }
});

test('бросок: всё выпадает при удачном броске и ничего — при неудачном', () => {
  const table = MONSTERS.spider1.drop;
  assert.equal(rollDrop(table, () => 0).length, table.length, 'ноль — выпадает всё');
  assert.equal(rollDrop(table, () => 0.99).length, 0, 'почти единица — не выпадает ничего');
});

test('бросок уважает количество', () => {
  const [drop] = rollDrop([{ id: 'mush_red', chance: 1, min: 2, max: 3 }], () => 0);
  assert.equal(drop.qty, 2, 'при нижнем броске — минимум');

  const [max] = rollDrop([{ id: 'mush_red', chance: 1, min: 2, max: 3 }], () => 0.99);
  assert.equal(max.qty, 3, 'при верхнем — максимум');
});

test('меч с сильного паука выпадает за разумное число боёв', () => {
  const sword = MONSTERS.spider3.drop.find((d) => d.id === 'sword')!;
  const kills = 1 / sword.chance;
  assert.ok(kills <= 8, `меч раз в ${kills.toFixed(1)} убийств — слишком долго`);
});

// --- рейд-боссы ---

test('босс — это не просто крупный гриб: он на порядок толще сильнейшего из них', () => {
  const top = MONSTERS.spider3;
  for (const [name, b] of Object.entries(BOSSES)) {
    assert.ok(b.hp >= top.hp * 5, `${name}: ${b.hp} hp против ${top.hp} у гриба — это не босс`);
    assert.ok(b.dmg > top.dmg, `${name}: урон ${b.dmg} не больше грибного ${top.dmg}`);
    assert.ok(b.xp > top.xp && b.gold[0] > top.gold[1], `${name}: награда не отличается от грибной`);
  }
});

test('боссы выстроены по возрастанию: каждый следующий тяжелее предыдущего', () => {
  const order = [BOSSES.golem1, BOSSES.golem2, BOSSES.golem3];
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i].hp > order[i - 1].hp, `голем ${i + 1} не толще предыдущего`);
    assert.ok(order[i].dmg > order[i - 1].dmg, `голем ${i + 1} не больнее предыдущего`);
    assert.ok(order[i].level > order[i - 1].level, `голем ${i + 1} не старше предыдущего`);
    assert.ok(order[i].xp > order[i - 1].xp, `за голема ${i + 1} не больше опыта`);
  }
});

test('бой с боссом долгий, но не бесконечный', () => {
  // Верхняя граница не меньше важна, чем нижняя: «сложно убить» не должно
  // означать «пилить дерево пять минут». Считаем по голому герою без брони —
  // с экипировкой будет заметно быстрее.
  const avg = (HERO.dmgMin + HERO.dmgMax) / 2;
  for (const [name, b] of Object.entries(BOSSES)) {
    const hits = Math.ceil(b.hp / avg);
    assert.ok(hits >= 30, `${name}: ${hits} взмахов — для босса слишком быстро`);
    assert.ok(hits <= 160, `${name}: ${hits} взмахов — это уже не бой, а пила`);
  }
});

test('босс убивает за несколько ударов, но не с одного', () => {
  // Одноударная смерть — это не сложность, а лотерея: игрок не успевает
  // ничего решить. Три-четыре пропущенных удара подряд — вот цена ошибки.
  for (const [name, b] of Object.entries(BOSSES)) {
    const hits = Math.ceil(HERO.hp / b.dmg);
    assert.ok(hits >= 3, `${name}: убивает за ${hits} удара — не оставляет шанса`);
    assert.ok(hits <= 8, `${name}: ${hits} ударов до смерти — не страшно`);
  }
});

test('от босса можно убежать — это плата за то, что он такой больный', () => {
  // Весь баланс держится на добровольности боя: раз уйти можно всегда, урон
  // разрешено делать высоким. Голем ЗАМЕТНО медленнее героя, а не чуть-чуть.
  for (const [name, b] of Object.entries(BOSSES)) {
    assert.ok(b.speed <= HERO.speed * 0.55, `${name}: скорость ${b.speed} — от него не оторваться`);
  }
});

test('босс возрождается медленнее обычного монстра', () => {
  for (const [name, b] of Object.entries(BOSSES)) {
    assert.ok(b.respawnMs && b.respawnMs >= 120000, `${name}: отрастает за ${b.respawnMs} мс — это грядка, а не событие`);
  }
});

test('с босса падает что-то, чего не роняют грибы', () => {
  const fromMobs = new Set(Object.values(MONSTERS).flatMap((m) => m.drop.map((d) => d.id)));
  for (const [name, b] of Object.entries(BOSSES)) {
    const unique = b.drop.filter((d) => !fromMobs.has(d.id));
    assert.ok(unique.length > 0, `${name}: всё то же, что и с грибов — ради чего его бить`);
  }
});

test('тело монстра уже клетки — иначе он не пройдёт вдоль стены', () => {
  // Поймано на живой игре: у паука m3 тело было 16 при тайле 16 — ровно ширина
  // клетки. Стоя по центру клетки, он занимал её целиком, край ложился на
  // границу стены, и погрешность дробных чисел загоняла его на 2e-12 пикселя
  // ВНУТРЬ. Физика запрещала шаг, паук замирал у камня навсегда.
  const TILE = 16;
  const MIN_GAP = 2; // по пикселю с каждой стороны — чтобы погрешность не решала

  for (const m of Object.values(ALL_CREATURES)) {
    assert.ok(
      m.body[0] <= TILE - MIN_GAP,
      `${m.key}: тело ${m.body[0]} при тайле ${TILE} — зазора ${TILE - m.body[0]} px не хватит, застрянет у стены`,
    );
  }
});
