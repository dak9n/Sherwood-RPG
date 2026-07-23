import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PresenceStore, PRESENCE_TTL, type PresenceEntry } from './presence-store.ts';

const entry = (over: Partial<PresenceEntry> = {}): PresenceEntry => ({
  name: 'Robin',
  map: 'forest',
  x: 100,
  y: 200,
  anim: 'sw-idle-down',
  helm: null,
  body: null,
  weapon: null,
  dead: false,
  ts: 1000,
  ...over,
});

test('игрок виден другим на своей карте, но не самому себе', () => {
  const s = new PresenceStore();
  s.upsert('a', entry({ name: 'A' }));
  s.upsert('b', entry({ name: 'B' }));
  const seenByA = s.listFor('forest', 'a');
  assert.deepEqual(seenByA.map((p) => p.name), ['B']);
});

test('другая карта — другой мир: соседей с чужой карты в ростере нет', () => {
  const s = new PresenceStore();
  s.upsert('a', entry({ map: 'forest' }));
  s.upsert('b', entry({ map: 'macos', name: 'B' }));
  assert.equal(s.listFor('forest', 'x').length, 1);
  assert.equal(s.listFor('macos', 'x')[0].name, 'B');
});

test('повторный upsert замещает запись, а не плодит двойника', () => {
  const s = new PresenceStore();
  s.upsert('a', entry({ x: 1 }));
  s.upsert('a', entry({ x: 2 }));
  assert.equal(s.size, 1);
  assert.equal(s.listFor('forest', 'z')[0].x, 2);
});

test('кривые координаты не пускаются в мир', () => {
  const s = new PresenceStore();
  s.upsert('a', entry({ x: NaN }));
  s.upsert('b', entry({ y: Infinity }));
  assert.equal(s.size, 0);
});

test('prune выкидывает замолчавших и называет их ключи', () => {
  const s = new PresenceStore();
  s.upsert('old', entry({ ts: 0 }));
  s.upsert('fresh', entry({ ts: PRESENCE_TTL }));
  const dead = s.prune(PRESENCE_TTL + 1);
  assert.deepEqual(dead, ['old']);
  assert.equal(s.size, 1);
});

test('maps перечисляет только обитаемые карты', () => {
  const s = new PresenceStore();
  s.upsert('a', entry({ map: 'forest' }));
  s.upsert('b', entry({ map: 'forest' }));
  s.upsert('c', entry({ map: 'macos' }));
  assert.deepEqual([...s.maps()].sort(), ['forest', 'macos']);
});
