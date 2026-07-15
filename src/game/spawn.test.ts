import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landCells, largestArea, pickSpawns } from './spawn.ts';
import { MapDoc } from '../map/doc.ts';
import type { GameMap } from '../map/types.ts';

const WATER_ID = 1; // тайлсет Water_detilazation
const LAND_ID = 500; // тайлсет Water_coasts — вопреки имени это земля
const GRASS_ID = 900; // Ground_grass
const LILY_ID = 700; // water_lilis

/** Карта из слоёв-картинок. Символ -> номер тайла. */
function docFrom(layers: { name: string; rows: string[] }[], legend: Record<string, number>): MapDoc {
  const width = layers[0].rows[0].length;
  const height = layers[0].rows.length;

  const map: GameMap = {
    version: 2,
    width,
    height,
    tileWidth: 16,
    tileHeight: 16,
    tilesets: [
      { name: 'Water_detilazation', image: 'w.png', imageWidth: 16, imageHeight: 16, columns: 1, tileCount: 400, firstId: 1, animations: {} },
      { name: 'Water_coasts', image: 'c.png', imageWidth: 16, imageHeight: 16, columns: 1, tileCount: 100, firstId: 500, animations: {} },
      { name: 'water_lilis', image: 'l.png', imageWidth: 16, imageHeight: 16, columns: 1, tileCount: 100, firstId: 700, animations: {} },
      { name: 'Ground_grass', image: 'g.png', imageWidth: 16, imageHeight: 16, columns: 1, tileCount: 100, firstId: 900, animations: {} },
    ],
    layers: layers.map((l) => ({
      name: l.name,
      visible: true,
      data: l.rows.flatMap((row) => [...row].map((ch) => legend[ch] ?? 0)),
    })),
    collision: new Array(width * height).fill(0),
  };
  return new MapDoc(map);
}

test('земля поверх воды — это берег, а не пруд', () => {
  // Так и устроена настоящая карта: вода залита фоном, земля прорезает в ней водоёмы.
  const doc = docFrom(
    [
      { name: 'water', rows: ['wwww', 'wwww'] },
      { name: 'main_space', rows: ['LL..', 'LL..'] },
    ],
    { w: WATER_ID, L: LAND_ID, '.': 0 },
  );
  const land = landCells(doc);

  assert.ok(land.has(0), 'клетка с землёй поверх воды — суша');
  assert.ok(land.has(1));
  assert.ok(!land.has(2), 'клетка с одной водой — не суша');
  assert.equal(land.size, 4);
});

test('вода поверх земли — это вода', () => {
  // Кувшинка лежит на воде, а не на траве: клетка непроходима.
  const doc = docFrom(
    [
      { name: 'ground', rows: ['LL'] },
      { name: 'lilies', rows: ['l.'] },
    ],
    { L: LAND_ID, l: LILY_ID, '.': 0 },
  );
  const land = landCells(doc);

  assert.ok(!land.has(0), 'под кувшинкой вода');
  assert.ok(land.has(1), 'соседняя клетка — земля');
});

test('трава считается землёй', () => {
  const doc = docFrom([{ name: 'g', rows: ['gg'] }], { g: GRASS_ID });
  assert.equal(landCells(doc).size, 2);
});

test('пустая клетка — не земля', () => {
  const doc = docFrom([{ name: 'g', rows: ['g.'] }], { g: GRASS_ID, '.': 0 });
  const land = landCells(doc);
  assert.ok(land.has(0));
  assert.ok(!land.has(1), 'за краем нарисованного суши нет');
});

test('островок отбрасывается — на нём паука никто не найдёт', () => {
  //  LL.L
  //  LL..
  const doc = docFrom([{ name: 'g', rows: ['LL.L', 'LL..'] }], { L: LAND_ID, '.': 0 });
  const biggest = largestArea(landCells(doc), 4);

  assert.equal(biggest.size, 4, 'остался только большой кусок');
  assert.ok(!biggest.has(3), 'одинокая клетка справа отброшена');
});

test('пауки не появляются вплотную к игроку и не улетают за горизонт', () => {
  const rows = Array.from({ length: 40 }, () => 'L'.repeat(40));
  const doc = docFrom([{ name: 'g', rows }], { L: LAND_ID });
  const player = { x: 320, y: 320 };

  const points = pickSpawns(doc, new Set(), [{ kind: 'spider1', count: 8 }], player, () => 0.5, 60, 260);

  assert.ok(points.length > 0, 'кого-то расселили');
  for (const p of points) {
    const d = Math.hypot(p.x - player.x, p.y - player.y);
    assert.ok(d >= 60, `паук в ${d.toFixed(0)} px от игрока — слишком близко`);
    assert.ok(d <= 260, `паук в ${d.toFixed(0)} px — его никто не найдёт`);
  }
});

test('пауки не селятся друг на друге', () => {
  const rows = Array.from({ length: 40 }, () => 'L'.repeat(40));
  const doc = docFrom([{ name: 'g', rows }], { L: LAND_ID });
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  const points = pickSpawns(doc, new Set(), [{ kind: 'spider1', count: 10 }], { x: 320, y: 320 }, rng);

  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      assert.ok(d >= 24, `двое в ${d.toFixed(0)} px друг от друга`);
    }
  }
});

test('под деревьями не селим', () => {
  const rows = Array.from({ length: 40 }, () => 'L'.repeat(40));
  const doc = docFrom([{ name: 'g', rows }], { L: LAND_ID });

  // забиваем деревьями всё, кроме одной клетки в нужном кольце
  const free = 12 * 40 + 20;
  const blocked = new Set<number>();
  for (let i = 0; i < 40 * 40; i++) if (i !== free) blocked.add(i);

  const points = pickSpawns(doc, blocked, [{ kind: 'spider1', count: 5 }], { x: 320, y: 320 }, () => 0.5);

  assert.equal(points.length, 1, 'свободна ровно одна клетка');
  assert.equal(points[0].x, 20 * 16 + 8);
});
