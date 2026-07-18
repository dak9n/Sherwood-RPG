/**
 * Общие типы и числа торгового рынка — их знают и сервер (server/market-store),
 * и клиент (market-client, market-ui). Держим в src/, а не в server/, чтобы
 * браузерный код не тянул серверный модуль. Ни логики, ни ввода-вывода тут нет.
 */

import type { MarketCategory, Rarity } from './items.ts';

/** Комиссия рынка: доля выручки, что не доходит до продавца. Как на образце — 5%. */
export const MARKET_COMMISSION = 0.05;
/** Сколько живёт лот, мс. Сутки: не куплено — вернётся продавцу по почте. */
export const LISTING_TTL = 24 * 60 * 60 * 1000;
/** Больше стольких активных лотов на игрока не выставить — от засорения рынка. */
export const MAX_LOTS_PER_SELLER = 20;
/** Потолок цены: выше — почти наверняка порча/чит. */
export const MAX_PRICE = 10_000_000;
/** Размер страницы выдачи по умолчанию. */
export const PAGE_SIZE = 8;

/** Предмет в лоте/почте: как в сумке, с заточкой конкретного экземпляра оружия. */
export interface TradeItem {
  id: string;
  qty: number;
  sharpen?: number;
}

export interface Lot {
  id: string;
  sellerKey: string;
  sellerName: string;
  item: TradeItem;
  /** Цена за ВЕСЬ лот, в золоте. */
  price: number;
  createdAt: number;
  expiresAt: number;
}

export type MailEntry =
  | { id: string; kind: 'gold'; amount: number; note: string; ts: number }
  | { id: string; kind: 'item'; item: TradeItem; note: string; ts: number };

export interface TradeRecord {
  ts: number;
  itemId: string;
  qty: number;
  price: number;
  sellerKey: string;
  sellerName: string;
  buyerKey: string;
  buyerName: string;
}

export interface BrowseFilter {
  category?: MarketCategory | 'all';
  search?: string;
  rarity?: Rarity | 'any';
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'unit_asc' | 'expires';
  page?: number;
  pageSize?: number;
  /** Скрыть лоты этого продавца (свои — на вкладке «Мои лоты»). */
  excludeSeller?: string;
}

export interface BrowseResult {
  lots: Lot[];
  total: number;
  page: number;
  pages: number;
}

/** Данные для persist/восстановления — ровно то, что переживает перезапуск. */
export interface MarketSnapshot {
  lots: Lot[];
  mail: Record<string, MailEntry[]>;
  history: TradeRecord[];
  seq: number;
}
