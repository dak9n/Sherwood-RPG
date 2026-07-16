import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword,
  verifyPassword,
  validateUsername,
  validatePassword,
  normalizeName,
  newToken,
  MAX_PASSWORD,
} from './auth-core.ts';

test('пароль в хеше не виден открытым текстом', async () => {
  const hash = await hashPassword('super-secret-123');
  assert.ok(!hash.includes('super-secret-123'), 'пароль просочился в хеш');
  assert.match(hash, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/, 'не тот формат');
});

test('верный пароль проходит, неверный — нет', async () => {
  const hash = await hashPassword('correct horse');
  assert.equal(await verifyPassword('correct horse', hash), true);
  assert.equal(await verifyPassword('correct hors', hash), false, 'на символ короче');
  assert.equal(await verifyPassword('', hash), false, 'пустой');
  assert.equal(await verifyPassword('CORRECT HORSE', hash), false, 'регистр важен');
});

test('одинаковые пароли дают РАЗНЫЕ хеши', async () => {
  // Соль у каждого своя: иначе по совпадению хешей было бы видно, что у двоих
  // одинаковый пароль, и радужная таблица вскрыла бы обоих разом.
  const a = await hashPassword('pass');
  const b = await hashPassword('pass');
  assert.notEqual(a, b, 'соль не случайна');
  assert.equal(await verifyPassword('pass', a), true, 'но оба проверяются');
  assert.equal(await verifyPassword('pass', b), true);
});

test('битый или чужой хеш не проходит и не роняет проверку', async () => {
  for (const bad of ['', 'мусор', 'scrypt$', 'scrypt$xx', 'md5$aa$bb', 'scrypt$$', 'scrypt$zz$zz']) {
    assert.equal(await verifyPassword('pass', bad), false, `упал на: ${JSON.stringify(bad)}`);
  }
});

test('имя: правила понятны и кириллица разрешена', () => {
  assert.equal(validateUsername('geko'), null);
  assert.equal(validateUsername('Ден'), null, 'кириллица');
  assert.equal(validateUsername('мой_герой 2'), null, 'пробел, цифра, подчёркивание');

  assert.ok(validateUsername('ab'), 'слишком короткое');
  assert.ok(validateUsername('x'.repeat(21)), 'слишком длинное');
  assert.ok(validateUsername('bad/name'), 'слэш запрещён');
  assert.ok(validateUsername('dot.name'), 'точка запрещена');
  assert.ok(validateUsername(42 as unknown), 'не строка');
});

test('пароль: минимум и защитный максимум', () => {
  assert.equal(validatePassword('123456'), null, 'ровно минимум');
  assert.ok(validatePassword('12345'), 'короче минимума');
  assert.ok(validatePassword('x'.repeat(MAX_PASSWORD + 1)), 'длиннее защитного предела');
  assert.equal(validatePassword('x'.repeat(MAX_PASSWORD)), null, 'ровно предел — можно');
  assert.ok(validatePassword(null as unknown), 'не строка');
});

test('очень длинный пароль отсекается ДО хеширования', () => {
  // MAX_PASSWORD — не каприз: scrypt гоняет весь пароль, и мегабайтная строка
  // была бы бесплатной нагрузкой на процессор. Проверка обязана стоять до scrypt.
  const huge = 'a'.repeat(2_000_000);
  assert.ok(validatePassword(huge), 'гигантский пароль должен быть отклонён проверкой');
});

test('имя для сравнения без регистра и пробелов', () => {
  assert.equal(normalizeName('  Geko '), 'geko');
  assert.equal(normalizeName('ДЕН'), 'ден');
  assert.equal(normalizeName('geko'), normalizeName('GEKO'), 'один и тот же игрок');
});

test('токены случайны и не повторяются', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const t = newToken();
    assert.match(t, /^[0-9a-f]{64}$/, 'токен не 256-битный hex');
    assert.ok(!seen.has(t), 'токен повторился');
    seen.add(t);
  }
});

test('служебные имена (__proto__/constructor/prototype) регистрировать нельзя', () => {
  // Иначе такое имя, став ключом карты «аккаунт -> сейв», подменило бы прототип
  // и дало межаккаунтную инъекцию.
  for (const evil of ['__proto__', 'constructor', 'prototype', '__PROTO__', ' Constructor ']) {
    assert.ok(validateUsername(evil), `«${evil}» должно быть отклонено`);
  }
  assert.equal(validateUsername('нормальное_имя'), null, 'обычное имя проходит');
});
