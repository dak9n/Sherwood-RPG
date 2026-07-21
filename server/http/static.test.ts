import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, sep } from 'node:path';
import { resolveStatic } from './static.ts';

/** Папка сборки в тестах вымышленная: resolveStatic до диска не дотрагивается. */
const DIST = resolve('/srv/game/dist');

/**
 * Главный инвариант: что бы ни прислали, ответом может быть либо null, либо путь
 * СТРОГО внутри dist. Проверять на конкретный null тут — ошибка, и она уже была
 * сделана: `new URL()` сам нормализует '..' (см. тест про нормализацию ниже),
 * поэтому большинство наивных атак превращаются в безобидный путь внутри dist,
 * а не отвергаются. Файла по нему нет, statSync упадёт, игрок получит 404 —
 * то есть безопасно, но НЕ null.
 */
const inside = (url: string): void => {
  const got = resolveStatic(DIST, url);
  if (got === null) return;
  assert.equal(got.startsWith(DIST + sep), true, `${url} вывел наружу: ${got}`);
};

test('корень отдаёт index.html', () => {
  assert.equal(resolveStatic(DIST, '/'), resolve(DIST, 'index.html'));
});

test('обычный файл разрешается внутрь dist', () => {
  assert.equal(resolveStatic(DIST, '/assets/hero.png'), resolve(DIST, 'assets/hero.png'));
});

test('query-строка на путь не влияет', () => {
  assert.equal(resolveStatic(DIST, '/index.html?edit'), resolve(DIST, 'index.html'));
  assert.equal(resolveStatic(DIST, '/?edit'), resolve(DIST, 'index.html'));
});

test('new URL сама нормализует .. — до resolve они не доживают', () => {
  // Не изнанка реализации, а причина, по которой следующий тест выглядит иначе,
  // чем ожидаешь: '/../x' на входе даёт '/x', то есть путь внутри dist.
  assert.equal(resolveStatic(DIST, '/../.auth/users.json'), resolve(DIST, '.auth/users.json'));
  assert.equal(resolveStatic(DIST, '/../../etc/passwd'), resolve(DIST, 'etc/passwd'));
  assert.equal(resolveStatic(DIST, '/assets/../../.auth/users.json'), resolve(DIST, '.auth/users.json'));
});

test('%2F не даёт собрать разделитель в обход нормализации', () => {
  // ЕДИНСТВЕННЫЙ разбор, который реально доходит до защиты resolve+startsWith.
  // '%2e%2e/' URL раскодирует и нормализует сам, а вот '%2E%2E%2F' переживает
  // разбор целиком: закодированный слэш для URL — не разделитель пути. После
  // decodeURIComponent из него получается '/../.auth/users.json', и без нижней
  // проверки чтение ушло бы в .auth/users.json с хешами паролей.
  assert.equal(resolveStatic(DIST, '/%2E%2E%2F.auth/users.json'), null);
  assert.equal(resolveStatic(DIST, '/assets/%2e%2e%2F%2e%2e%2Fetc/passwd'), null);
});

test('битая escape-последовательность отвергается, а не роняет сервер', () => {
  assert.equal(resolveStatic(DIST, '/%zz'), null);
});

test('нулевой байт в пути отвергается', () => {
  // Иначе 'a.png\0.js' в системном вызове обрежется до 'a.png'.
  assert.equal(resolveStatic(DIST, '/assets/a.png%00.js'), null);
});

test('внутри dist разрешена любая глубина', () => {
  const deep = resolveStatic(DIST, '/assets/maps/nested/deep.json');
  assert.equal(deep, resolve(DIST, 'assets/maps/nested/deep.json'));
});

test('никакая форма записи не выводит за пределы dist', () => {
  // Широкая сеть поверх точечных тестов: сюда дописываются новые находки,
  // не заводя каждый раз отдельный тест с точным ожиданием.
  for (const url of [
    '/',
    '/index.html',
    '/../.auth/users.json',
    '/../../../../../../etc/passwd',
    '/%2e%2e/%2e%2e/.auth/users.json',
    '/%2E%2E%2F%2E%2E%2Fetc/passwd',
    '/assets/%2f%2f..%2f.auth/users.json',
    '/....//....//.auth/users.json',
    '/.%2e/.%2e/.auth/users.json',
    '//....//..//.auth/users.json',
    '/dist-secret/../../dist-secret/keys.json',
  ]) {
    inside(url);
  }
});
