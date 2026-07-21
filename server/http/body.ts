/**
 * Общая мелочь HTTP: прочитать тело, ответить json, достать токен.
 *
 * Раньше это жило четырьмя копиями — в auth-plugin и в трёх save-*-плагинах.
 * Пока сервер был один-единственный (дев-сервер Vite), копии никому не мешали.
 * Теперь ручки должны работать в двух местах сразу: под `vite dev` и в отдельном
 * процессе, который раздаёт собранную игру. Разошедшиеся копии readBody — это
 * ровно тот случай, когда «на деве работает, в проде нет», поэтому копия одна.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

/** Сейв крошечный, но с запасом; больше — точно порча или чья-то шалость. */
export const MAX_BODY = 256 * 1024;

export function readBody(req: IncomingMessage, limit = MAX_BODY): Promise<string> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        fail(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    // Склеиваем буферы и потом декодируем: кириллица рвётся на границе чанков.
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

export function send(res: ServerResponse, code: number, body: unknown): void {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

/** Токен из заголовка Authorization: Bearer <token>. */
export function tokenOf(req: IncomingMessage): string | null {
  const h = req.headers['authorization'];
  if (typeof h !== 'string' || !h.startsWith('Bearer ')) return null;
  return h.slice('Bearer '.length).trim() || null;
}

/**
 * Тело как json. Требование content-type — это и защита от чужой вкладки:
 * такой запрос перестаёт быть простым, и браузер сначала шлёт preflight,
 * который чужой origin не пройдёт. Тот же приём, что у сохранения карт.
 *
 * null означает «ответ уже отправлен» — вызывающему остаётся только выйти.
 */
export async function jsonBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | null> {
  if (!req.headers['content-type']?.includes('application/json')) {
    send(res, 415, { error: 'content-type: application/json required' });
    return null;
  }
  try {
    const parsed = JSON.parse(await readBody(req));
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
  } catch {
    /* ниже */
  }
  send(res, 400, { error: 'body could not be parsed as json' });
  return null;
}

/**
 * Путь запроса без query-строки.
 *
 * Разбирать req.url руками нельзя: '/__login?x=1' и '/__login' должны попадать в
 * одну ручку, а '%2f' в пути не должен превращаться в разделитель уже здесь —
 * этим занимается раздача статики, у которой на то свои проверки.
 */
export function pathOf(req: IncomingMessage): string {
  return new URL(req.url ?? '/', 'http://localhost').pathname;
}

/** Query-параметры запроса. */
export function queryOf(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? '/', 'http://localhost').searchParams;
}
