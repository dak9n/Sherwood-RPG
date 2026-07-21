/**
 * Все серверные ручки игры, в одном месте и без единого упоминания Vite.
 *
 * Раньше они жили внутри configureServer в server/auth-plugin.ts и потому
 * существовали только под `vite dev`. Собранная игра оставалась без аккаунтов
 * вовсе — клиент честно показывал «Authorization server unavailable», и другому
 * человеку зайти было некуда.
 *
 * Здесь тела ручек и ничего больше. Кто слушает сокет — дев-сервер Vite или
 * отдельный процесс из server/main.ts — этому модулю неизвестно, и это главное
 * его свойство: обе точки входа выполняют один и тот же код, поэтому «на деве
 * работает, в проде нет» становится невыразимым.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthStore } from '../auth-store.ts';
import { MarketStore, PAGE_SIZE, type BrowseFilter } from '../market-store.ts';
import { ENABLE_MARKET, MARKET_OFF } from '../flags.ts';
import { send, tokenOf, jsonBody, pathOf, queryOf } from './body.ts';

/** Всё, что ручкам нужно снаружи. Собирается один раз при старте сервера. */
export interface ApiDeps {
  store: AuthStore;
  market: MarketStore;
  /** Прогресс в памяти: ключ аккаунта -> сейв как есть. */
  progress: Record<string, unknown>;
  /** Сбросить прогресс на диск. Вызывается после каждой записи. */
  flushProgress: () => void;
  /** Часы. Отдельным полем — чтобы тесты не ждали реального времени. */
  now: () => number;
}

/** Кто делает запрос: ключ аккаунта (владение) и показное имя (продавец/покупатель). */
async function who(
  req: IncomingMessage,
  deps: ApiDeps,
): Promise<{ key: string; name: string } | null> {
  const now = deps.now();
  const token = tokenOf(req);
  const key = deps.store.keyOf(token, now);
  const name = deps.store.whoami(token, now);
  return key && name ? { key, name } : null;
}

/**
 * Обработать запрос, если это ручка игры.
 *
 * true — ответ отправлен. false — путь не наш, и вызывающий волен отдать статику
 * (отдельный сервер) или передать дальше по цепочке (дев-сервер Vite).
 *
 * Ошибки внутри ручек не выпускаются наружу: любое исключение превращается в
 * 400 с текстом. Иначе одно необработанное отклонение промиса роняло бы процесс,
 * а с ним и всех, кто в этот момент играет.
 */
export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ApiDeps,
): Promise<boolean> {
  const path = pathOf(req);
  if (!path.startsWith('/__')) return false;

  try {
    return await route(path, req, res, deps);
  } catch (e) {
    send(res, 400, { ok: false, error: (e as Error).message });
    return true;
  }
}

async function route(
  path: string,
  req: IncomingMessage,
  res: ServerResponse,
  deps: ApiDeps,
): Promise<boolean> {
  const { store, market } = deps;
  const post = req.method === 'POST';
  const get = req.method === 'GET';

  switch (path) {
    // --- Аккаунты ---

    case '/__register': {
      if (!post) return false;
      const body = await jsonBody(req, res);
      if (!body) return true;
      const r = await store.register(body.name, body.password, deps.now());
      send(res, r.ok ? 200 : 400, r);
      return true;
    }

    case '/__login': {
      if (!post) return false;
      const body = await jsonBody(req, res);
      if (!body) return true;
      const r = await store.login(body.name, body.password, deps.now());
      // 401 на неудачу: это ответ «не пущу», а не «ты неправильно спросил».
      send(res, r.ok ? 200 : 401, r);
      return true;
    }

    case '/__whoami': {
      if (!get) return false;
      send(res, 200, { name: store.whoami(tokenOf(req), deps.now()) });
      return true;
    }

    case '/__logout': {
      if (!post) return false;
      store.logout(tokenOf(req), deps.now());
      send(res, 200, { ok: true });
      return true;
    }

    // --- Прогресс ---

    // Сохранить прогресс вошедшего. Тело — сам сейв; сервер его не разбирает,
    // хранит как есть под ключом аккаунта. Чистит сейв клиент при загрузке.
    case '/__save-progress': {
      if (!post) return false;
      const key = store.keyOf(tokenOf(req), deps.now());
      if (!key) return (send(res, 401, { error: 'login required' }), true);

      const body = await jsonBody(req, res);
      if (!body) return true;
      deps.progress[key] = body;
      deps.flushProgress();
      send(res, 200, { ok: true });
      return true;
    }

    // Отдать сохранённый прогресс вошедшего. null — сейва ещё нет.
    case '/__load-progress': {
      if (!get) return false;
      const key = store.keyOf(tokenOf(req), deps.now());
      if (!key) return (send(res, 401, { error: 'login required' }), true);
      send(res, 200, { save: deps.progress[key] ?? null });
      return true;
    }

    // --- Торговый рынок ---
    //
    // Все ручки ниже заперты флагом ENABLE_MARKET: сервер не проверяет ни
    // владение предметом, ни наличие золота, поэтому в открытом виде они
    // печатают ценности. Подробности — в server/flags.ts.

    case '/__market-list':
    case '/__market-browse':
    case '/__market-buy':
    case '/__market-cancel':
    case '/__market-mine':
    case '/__market-mail':
    case '/__market-mail-ack':
    case '/__market-history': {
      const wantPost = path !== '/__market-browse' && path !== '/__market-mine' &&
        path !== '/__market-mail' && path !== '/__market-history';
      if (wantPost !== post) return false;

      if (!ENABLE_MARKET) {
        // 503, а не 404: ручка существует и вернётся. Клиенту есть что показать
        // игроку, и это не выглядит как поломка.
        send(res, 503, MARKET_OFF);
        return true;
      }

      const me = await who(req, deps);
      if (!me) return (send(res, 401, { error: 'login required' }), true);
      await marketRoute(path, me, req, res, deps, market);
      return true;
    }

    default:
      return false;
  }
}

async function marketRoute(
  path: string,
  me: { key: string; name: string },
  req: IncomingMessage,
  res: ServerResponse,
  deps: ApiDeps,
  market: MarketStore,
): Promise<void> {
  const now = deps.now();

  switch (path) {
    // Выставить лот: тело { item, price }. Предмет игрок уже списал у себя.
    case '/__market-list': {
      const body = await jsonBody(req, res);
      if (!body) return;
      send(res, 200, market.list(me.key, me.name, body.item, body.price, now));
      return;
    }

    // Витрина: чужие лоты с фильтрами. Свои лоты — во вкладке «Мои лоты».
    case '/__market-browse': {
      const q = queryOf(req);
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
      send(res, 200, market.browse(filter, now));
      return;
    }

    // Купить лот: тело { lotId }. По успеху вернём предмет и цену — клиент спишет золото и положит вещь.
    case '/__market-buy': {
      const body = await jsonBody(req, res);
      if (!body) return;
      send(res, 200, market.buy(me.key, me.name, body.lotId, now));
      return;
    }

    // Снять свой лот: тело { lotId }. Предмет вернётся владельцу по почте.
    case '/__market-cancel': {
      const body = await jsonBody(req, res);
      if (!body) return;
      send(res, 200, market.cancel(me.key, body.lotId, now));
      return;
    }

    // Мои активные лоты.
    case '/__market-mine':
      send(res, 200, { ok: true, lots: market.mine(me.key, now) });
      return;

    // Почта: выручка и возвраты. Клиент зачислит и подтвердит принятое ack-ом.
    case '/__market-mail':
      send(res, 200, { ok: true, mail: market.mailFor(me.key) });
      return;

    // Подтвердить приём записей почты: тело { ids }. Удаляем только принятое.
    case '/__market-mail-ack': {
      const body = await jsonBody(req, res);
      if (!body) return;
      send(res, 200, { ok: true, ...market.ackMail(me.key, body.ids) });
      return;
    }

    // История сделок игрока.
    case '/__market-history':
      send(res, 200, { ok: true, history: market.historyFor(me.key, 50) });
      return;
  }
}
