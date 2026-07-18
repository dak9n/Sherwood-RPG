/**
 * Клиент торгового рынка: тонкая обёртка над ручками дев-сервера. Всё решает
 * сервер (market-store) — тут только запросы и честная обработка «сервера нет».
 *
 * Рынок живёт лишь на запущенном дев-сервере. В собранной игре ручек нет: fetch
 * вернёт не-json (index.html) или упадёт — тогда отдаём unavailable, и окно
 * честно скажет, что рынок недоступен, а не притворится пустым.
 */

import { getToken } from '../auth/client.ts';
import type { Lot, TradeItem, BrowseFilter, BrowseResult, MailEntry, TradeRecord } from './market-types.ts';

const UNAVAILABLE = 'Рынок недоступен — нет связи с сервером';

export interface ApiReply {
  ok: boolean;
  /** Сервера/ручки нет (собранная игра или он не запущен). */
  unavailable?: boolean;
  error?: string;
  data: Record<string, unknown>;
}

async function api(path: string, init: RequestInit & { json?: unknown } = {}): Promise<ApiReply> {
  const token = getToken();
  if (!token) return { ok: false, error: 'Нужен вход', data: {} };

  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  const opts: RequestInit = { method: init.method ?? 'GET', headers };
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(init.json);
  }

  let res: Response;
  try {
    res = await fetch(path, opts);
  } catch {
    return { ok: false, unavailable: true, error: UNAVAILABLE, data: {} };
  }
  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    // Не json — почти наверняка отдали index.html: ручки нет.
    return { ok: false, unavailable: true, error: UNAVAILABLE, data: {} };
  }
  const err = typeof data.error === 'string' ? data.error : res.ok ? undefined : `Ошибка (${res.status})`;
  return { ok: res.ok && data.ok !== false, unavailable: false, error: err, data };
}

export interface BrowseReply extends ApiReply {
  result?: BrowseResult;
}

export async function marketBrowse(filter: BrowseFilter): Promise<BrowseReply> {
  const q = new URLSearchParams();
  if (filter.category && filter.category !== 'all') q.set('category', filter.category);
  if (filter.search) q.set('search', filter.search);
  if (filter.rarity && filter.rarity !== 'any') q.set('rarity', filter.rarity);
  if (filter.sort) q.set('sort', filter.sort);
  q.set('page', String(filter.page ?? 1));
  const r = await api(`/__market-browse?${q.toString()}`);
  const d = r.data as unknown as BrowseResult;
  return { ...r, result: r.ok ? d : undefined };
}

export async function marketList(item: TradeItem, price: number): Promise<ApiReply & { lot?: Lot }> {
  const r = await api('/__market-list', { method: 'POST', json: { item, price } });
  return { ...r, lot: r.ok ? (r.data.lot as Lot) : undefined };
}

export async function marketBuy(lotId: string): Promise<ApiReply & { item?: TradeItem; price?: number }> {
  const r = await api('/__market-buy', { method: 'POST', json: { lotId } });
  return { ...r, item: r.ok ? (r.data.item as TradeItem) : undefined, price: r.ok ? (r.data.price as number) : undefined };
}

export async function marketCancel(lotId: string): Promise<ApiReply> {
  return api('/__market-cancel', { method: 'POST', json: { lotId } });
}

export async function marketMine(): Promise<ApiReply & { lots: Lot[] }> {
  const r = await api('/__market-mine');
  return { ...r, lots: (r.data.lots as Lot[]) ?? [] };
}

export async function marketMail(): Promise<ApiReply & { mail: MailEntry[] }> {
  const r = await api('/__market-mail');
  return { ...r, mail: (r.data.mail as MailEntry[]) ?? [] };
}

export async function marketMailAck(ids: string[]): Promise<ApiReply> {
  return api('/__market-mail-ack', { method: 'POST', json: { ids } });
}

export async function marketHistory(): Promise<ApiReply & { history: TradeRecord[] }> {
  const r = await api('/__market-history');
  return { ...r, history: (r.data.history as TradeRecord[]) ?? [] };
}
