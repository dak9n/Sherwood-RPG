/**
 * Раздача собранной игры из dist/.
 *
 * Под `vite dev` этот модуль не нужен вовсе — там статику отдаёт сам Vite. Он
 * существует ради второго режима: отдельный процесс, к которому можно прийти
 * браузером с другой машины. До сих пор такого режима не было, и `vite preview`
 * был бесполезен — в собранной игре не было ни одной серверной ручки, а значит
 * и входа в аккаунт.
 *
 * Никакого фолбэка «неизвестный путь -> index.html» здесь нет намеренно: игра
 * не роутится по адресам (редактор включается через ?edit, то есть query, а не
 * путь), а такой фолбэк превращает опечатку в имени ассета в белый экран вместо
 * честной 404 в консоли.
 */

import { createReadStream, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Только то, что реально лежит в dist/ у этой игры, плюс запас на звук.
 * Белый список, а не библиотека mime: неизвестное расширение получает
 * application/octet-stream и скачивается, а не исполняется браузером.
 */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Путь на диске для запрошенного адреса, или null — если запрос ведёт наружу.
 *
 * Экспортируется ради тестов: обход папки — это та проверка, которую надо уметь
 * дёрнуть напрямую, а не только через живой сокет.
 *
 * Разбираем через URL, а не split('?'): так '%2e%2e' и '%2f' раскодируются ДО
 * проверок, и закодированный '..' не проскочит мимо них. Финальный startsWith —
 * защита в глубину: даже если выше что-то недосмотрено, файл вне dist/ не уедет
 * клиенту. Тот же приём, что у mapPathFor в tools/save-map-plugin.ts:43.
 */
export function resolveStatic(dir: string, url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url, 'http://localhost').pathname;
  } catch {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Битая escape-последовательность ('%zz'): это не наш файл, кто бы что ни имел в виду.
    return null;
  }

  // Нулевой байт обрезает путь в системных вызовах — из 'a.png\0.js' получилось бы 'a.png'.
  if (decoded.includes('\0')) return null;

  const rel = decoded === '/' ? '/index.html' : decoded;
  const full = resolve(dir, '.' + rel);
  if (full !== dir && !full.startsWith(dir + sep)) return null;
  return full;
}

/**
 * Отдать файл из dir. true — ответ отправлен, false — такого файла нет и
 * вызывающий волен ответить своей 404.
 */
export function serveStatic(req: IncomingMessage, res: ServerResponse, dir: string): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  const full = resolveStatic(dir, req.url ?? '/');
  if (full === null) return false;

  let st;
  try {
    st = statSync(full);
  } catch {
    return false;
  }
  // Папку не отдаём и не листаем: список файлов сервера — не то, что должен видеть игрок.
  if (!st.isFile()) return false;

  // Ревизия по размеру и времени правки. Пересборка меняет и то и другое, а
  // считать sha1 от phaser.js на каждый запрос — расточительство.
  const etag = `W/"${st.size.toString(16)}-${st.mtimeMs.toString(16)}"`;
  res.setHeader('etag', etag);
  res.setHeader('content-type', MIME[extname(full).toLowerCase()] ?? 'application/octet-stream');

  if (req.headers['if-none-match'] === etag) {
    res.statusCode = 304;
    res.end();
    return true;
  }

  res.statusCode = 200;
  res.setHeader('content-length', String(st.size));
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }

  const stream = createReadStream(full);
  // Диск отвалился на середине — заголовки уже ушли, чинить нечего: рвём соединение,
  // чтобы клиент увидел обрыв, а не молча принял обрезанный файл за целый.
  stream.on('error', () => res.destroy());
  stream.pipe(res);
  return true;
}
