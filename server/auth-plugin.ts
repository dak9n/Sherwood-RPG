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
import { loadUsers, saveUsers, loadProgress, saveProgress } from './auth-persist.ts';
import { MarketStore, PAGE_SIZE, type BrowseFilter } from './market-store.ts';
import { loadMarket, saveMarket } from './market-persist.ts';

const AUTH_FILE = '.auth/users.json';
const PROGRESS_FILE = '.auth/progress.json';
const MARKET_FILE = '.auth/market.json';
const MAX_BODY = 256 * 1024; // сейв крошечный, но с запасом; больше — точно порча

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
      const progressFile = resolve(server.config.root, PROGRESS_FILE);

      // Хранилище одно на весь дев-сервер. Готовится асинхронно (пустышка для
      // защиты от тайминга считается scrypt), поэтому ждём его в каждой ручке.
      const ready = AuthStore.create(loadUsers(file), (users) => saveUsers(file, users));

      // Прогресс держим в памяти и сбрасываем на диск при каждой записи.
      const progress = loadProgress(progressFile);

      // Торговый рынок: лоты и почта между аккаунтами. Тот же AuthStore решает,
      // кто выставил/купил (keyOf по токену). Живёт только на дев-сервере.
      const marketFile = resolve(server.config.root, MARKET_FILE);
      const market = new MarketStore(loadMarket(marketFile), (snap) => saveMarket(marketFile, snap));

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

      // Сохранить прогресс вошедшего. Тело — сам сейв; сервер его не разбирает,
      // хранит как есть под ключом аккаунта. Чистит сейв клиент при загрузке.
      server.middlewares.use('/__save-progress', (req, res, next) => {
        if (req.method !== 'POST') return next();
        void (async () => {
          const store = await ready;
          const key = store.keyOf(tokenOf(req), Date.now());
          if (!key) return send(res, 401, { error: 'нужен вход' });

          const body = await jsonBody(req, res);
          if (!body) return;
          progress[key] = body;
          saveProgress(progressFile, progress);
          send(res, 200, { ok: true });
        })().catch((e: Error) => send(res, 400, { ok: false, error: e.message }));
      });

      // Отдать сохранённый прогресс вошедшего. null — сейва ещё нет.
      server.middlewares.use('/__load-progress', (req, res, next) => {
        if (req.method !== 'GET') return next();
        void (async () => {
          const store = await ready;
          const key = store.keyOf(tokenOf(req), Date.now());
          if (!key) return send(res, 401, { error: 'нужен вход' });
          send(res, 200, { save: progress[key] ?? null });
        })().catch((e: Error) => send(res, 400, { error: e.message }));
      });

      // --- Торговый рынок ---

      /** Кто делает запрос: ключ аккаунта (владение) и показное имя (продавец/покупатель). */
      const who = async (req: IncomingMessage): Promise<{ key: string; name: string } | null> => {
        const store = await ready;
        const now = Date.now();
        const token = tokenOf(req);
        const key = store.keyOf(token, now);
        const name = store.whoami(token, now);
        return key && name ? { key, name } : null;
      };

      /** Обёртка ручки рынка: метод, вход обязателен, ошибки — 400. */
      const marketRoute = (
        path: string,
        method: 'GET' | 'POST',
        handler: (me: { key: string; name: string }, req: IncomingMessage, res: ServerResponse) => Promise<void>,
      ): void => {
        server.middlewares.use(path, (req, res, next) => {
          if (req.method !== method) return next();
          void (async () => {
            const me = await who(req);
            if (!me) return send(res, 401, { error: 'нужен вход' });
            await handler(me, req, res);
          })().catch((e: Error) => send(res, 400, { ok: false, error: e.message }));
        });
      };

      const query = (req: IncomingMessage): URLSearchParams => new URLSearchParams((req.url ?? '').split('?')[1] ?? '');

      // Выставить лот: тело { item, price }. Предмет игрок уже списал у себя.
      marketRoute('/__market-list', 'POST', async (me, req, res) => {
        const body = await jsonBody(req, res);
        if (!body) return;
        send(res, 200, market.list(me.key, me.name, body.item, body.price, Date.now()));
      });

      // Витрина: чужие лоты с фильтрами. Свои лоты — во вкладке «Мои лоты».
      marketRoute('/__market-browse', 'GET', async (me, req, res) => {
        const q = query(req);
        const filter: BrowseFilter = {
          category: (q.get('category') as BrowseFilter['category']) ?? 'all',
          search: q.get('search') ?? '',
          rarity: (q.get('rarity') as BrowseFilter['rarity']) ?? 'any',
          sort: (q.get('sort') as BrowseFilter['sort']) ?? 'newest',
          maxPrice: q.get('maxPrice') != null ? Number(q.get('maxPrice')) : undefined,
          page: Number(q.get('page') ?? 1),
          pageSize: Number(q.get('pageSize') ?? PAGE_SIZE),
          excludeSeller: me.key,
        };
        send(res, 200, market.browse(filter, Date.now()));
      });

      // Купить лот: тело { lotId }. По успеху вернём предмет и цену — клиент спишет золото и положит вещь.
      marketRoute('/__market-buy', 'POST', async (me, req, res) => {
        const body = await jsonBody(req, res);
        if (!body) return;
        send(res, 200, market.buy(me.key, me.name, body.lotId, Date.now()));
      });

      // Снять свой лот: тело { lotId }. Предмет вернётся владельцу по почте.
      marketRoute('/__market-cancel', 'POST', async (me, req, res) => {
        const body = await jsonBody(req, res);
        if (!body) return;
        send(res, 200, market.cancel(me.key, body.lotId, Date.now()));
      });

      // Мои активные лоты.
      marketRoute('/__market-mine', 'GET', async (me, _req, res) => {
        send(res, 200, { ok: true, lots: market.mine(me.key, Date.now()) });
      });

      // Почта: выручка и возвраты. Клиент зачислит и подтвердит принятое ack-ом.
      marketRoute('/__market-mail', 'GET', async (me, _req, res) => {
        send(res, 200, { ok: true, mail: market.mailFor(me.key) });
      });

      // Подтвердить приём записей почты: тело { ids }. Удаляем только принятое.
      marketRoute('/__market-mail-ack', 'POST', async (me, req, res) => {
        const body = await jsonBody(req, res);
        if (!body) return;
        send(res, 200, { ok: true, ...market.ackMail(me.key, body.ids) });
      });

      // История сделок игрока.
      marketRoute('/__market-history', 'GET', async (me, _req, res) => {
        send(res, 200, { ok: true, history: market.historyFor(me.key, 50) });
      });
    },
  };
}
