import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapNameError, isSafeMapName } from './name.ts';

test('пустое имя и пробелы — ошибка', () => {
  assert.ok(mapNameError([], ''));
  assert.ok(mapNameError([], '   '));
});

test('путь и опасные символы — ошибка (нет обхода каталога)', () => {
  for (const bad of ['..', '../forest', 'a/b', 'a\\b', 'a.json', 'C:foo', 'с пробелом', 'a.b']) {
    assert.ok(mapNameError([], bad), `${bad} должно быть отклонено`);
    assert.equal(isSafeMapName(bad), false);
  }
});

test('виндовые зарезервированные имена — ошибка', () => {
  for (const bad of ['NUL', 'con', 'COM1', 'lpt9', 'AUX']) {
    assert.ok(mapNameError([], bad));
    assert.equal(isSafeMapName(bad), false);
  }
});

test('дубликат — ошибка, без учёта регистра', () => {
  assert.ok(mapNameError(['forest'], 'forest'));
  assert.ok(mapNameError(['forest'], 'FOREST'));
  assert.ok(mapNameError(['forest', 'town'], 'Town'));
});

test('нормальные имена — ок (латиница, кириллица, дефис, подчёркивание)', () => {
  for (const ok of ['level2', 'town-north', 'my_map', 'лес2', 'Пещера']) {
    assert.equal(mapNameError([], ok), null, `${ok} должно быть принято`);
    assert.equal(isSafeMapName(ok), true);
  }
});

test('своё имя при перезаписи не считается занятым только если его нет в списке', () => {
  // existing не содержит 'newmap' → ок
  assert.equal(mapNameError(['forest'], 'newmap'), null);
});
