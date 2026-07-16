/**
 * Серверные ручки авторизации на дев-сервере Vite.
 *
 * Живёт только при `apply: 'serve'` — как и сохранение карт. В собранной игре
 * этих ручек нет вовсе. Для настоящего онлайна (один аккаунт на двух компах)
 * тот же AuthStore нужно поднять отдельным сервером на хостинге; здесь — местный
 * дев-вариант, чтобы играть и входить прямо сейчас.
 */

import { resolve } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthStore } from './auth-store.ts';
import { loadUsers, saveUsers } from './auth-persist.ts';

const AUTH_FILE = '.auth/users.json';
const MAX_BODY = 64 * 1024; // имя и пароль — этого с огромным запасом

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        fail(new Error('тело запроса слишком большое'));
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

function send(res: ServerResponse, code: number, body: unknown): void {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

/** Токен из заголовка Authorization: Bearer <token>. */
function tokenOf(req: IncomingMessage): string | null {
  const h = req.headers['authorization'];
  if (typeof h !== 'string' || !h.startsWith('Bearer ')) return null;
  return h.slice('Bearer '.length).trim() || null;
}

export function authPlugin(): Plugin {
  return {
    name: 'auth',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const file = resolve(server.config.root, AUTH_FILE);

      // Хранилище одно на весь дев-сервер. Готовится асинхронно (пустышка для
      // защиты от тайминга считается scrypt), поэтому ждём его в каждой ручке.
      const ready = AuthStore.create(loadUsers(file), (users) => saveUsers(file, users));

      /**
       * Тело как json. Требование content-type — это и защита от чужой вкладки:
       * такой запрос перестаёт быть простым, и браузер сначала шлёт preflight,
       * который чужой origin не пройдёт. Тот же приём, что у сохранения карт.
       */
      const jsonBody = async (
        req: IncomingMessage,
        res: ServerResponse,
      ): Promise<Record<string, unknown> | null> => {
        if (!req.headers['content-type']?.includes('application/json')) {
          send(res, 415, { error: 'нужен content-type: application/json' });
          return null;
        }
        try {
          const parsed = JSON.parse(await readBody(req));
          if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
        } catch {
          /* ниже */
        }
        send(res, 400, { error: 'тело не разобралось как json' });
        return null;
      };

      server.middlewares.use('/__register', (req, res, next) => {
        if (req.method !== 'POST') return next();
        void (async () => {
          const body = await jsonBody(req, res);
          if (!body) return;
          const store = await ready;
          const r = await store.register(body.name, body.password, Date.now());
          send(res, r.ok ? 200 : 400, r);
        })().catch((e: Error) => send(res, 400, { ok: false, error: e.message }));
      });

      server.middlewares.use('/__login', (req, res, next) => {
        if (req.method !== 'POST') return next();
        void (async () => {
          const body = await jsonBody(req, res);
          if (!body) return;
          const store = await ready;
          const r = await store.login(body.name, body.password, Date.now());
          // 401 на неудачу: это ответ «не пущу», а не «ты неправильно спросил».
          send(res, r.ok ? 200 : 401, r);
        })().catch((e: Error) => send(res, 400, { ok: false, error: e.message }));
      });

      server.middlewares.use('/__whoami', (req, res, next) => {
        if (req.method !== 'GET') return next();
        void (async () => {
          const store = await ready;
          const name = store.whoami(tokenOf(req), Date.now());
          send(res, 200, { name });
        })().catch((e: Error) => send(res, 400, { error: e.message }));
      });

      server.middlewares.use('/__logout', (req, res, next) => {
        if (req.method !== 'POST') return next();
        void (async () => {
          const store = await ready;
          store.logout(tokenOf(req));
          send(res, 200, { ok: true });
        })().catch((e: Error) => send(res, 400, { error: e.message }));
      });
    },
  };
}
