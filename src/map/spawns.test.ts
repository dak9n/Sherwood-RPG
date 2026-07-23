import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialize } from './format.ts';
import { validateMap } from './validate.ts';
import type { GameMap } from './types.ts';

/** Минимальная валидная карта NxN с одним тайлсетом и одним слоем. */
function map(n: number): GameMap {
  const size = n * n;
  return {
    version: 3,
    width: n,
    height: n,
    tileWidth: 16,
    tileHeight: 16,
    tilesets: [
      { name: 'g', image: 'g.png', imageWidth: 16, imageHeight: 16, columns: 1, tileCount: 1, firstId: 1, animations: {} },
    ],
    layers: [{ name: 'ground', visible: true, data: new Array<number>(size).fill(1) }],
    collision: new Array<number>(size).fill(1),
  };
}

test('карта без маркеров сериализуется без поля spawns', () => {
  const s = serialize(map(4));
  assert.ok(!s.includes('spawns'), 'пустого поля быть не должно — старые карты не пухнут');
  JSON.parse(s); // читается обратно
});

test('маркеры переживают сериализацию и читаются обратно', () => {
  const m = map(8);
  m.spawns = [
    { kind: 'player', x: 3, y: 4 },
    { kind: 'golem1', x: 6, y: 1 },
  ];
  const back = JSON.parse(serialize(m)) as GameMap;
  assert.deepEqual(back.spawns, m.spawns);
});

test('каждый маркер — на своей строке (как слои, ради git-слияния)', () => {
  const m = map(8);
  m.spawns = [
    { kind: 'player', x: 1, y: 1 },
    { kind: 'spider2', x: 2, y: 2 },
  ];
  const lines = serialize(m).split('\n').filter((l) => l.includes('"kind"'));
  assert.equal(lines.length, 2, 'два маркера — две строки');
});

test('валидатор принимает корректные маркеры', () => {
  const m = map(8);
  m.spawns = [{ kind: 'player', x: 0, y: 0 }, { kind: 'golem3', x: 7, y: 7 }];
  assert.deepEqual(validateMap(m), []);
});

test('валидатор ловит маркер за краем карты', () => {
  const m = map(4);
  m.spawns = [{ kind: 'player', x: 4, y: 0 }]; // x=4 при ширине 4 — вне 0..3
  const errs = validateMap(m);
  assert.ok(errs.some((e) => e.includes('x') && e.includes('out of')), errs.join('; '));
});

test('валидатор ловит пустой kind и дробные координаты', () => {
  const m = map(4);
  m.spawns = [{ kind: '', x: 1.5, y: 0 }];
  const errs = validateMap(m);
  assert.ok(errs.some((e) => e.includes('kind')), 'пустой kind');
  assert.ok(errs.some((e) => e.includes('x')), 'дробный x');
});

test('spawns не массив — ошибка, а не молчаливый пропуск', () => {
  const m = map(4) as unknown as Record<string, unknown>;
  m.spawns = { player: [1, 2] };
  assert.ok((validateMap(m) as string[]).some((e) => e.includes('spawns must be an array')));
});
