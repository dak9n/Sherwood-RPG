/**
 * Торговый рынок (аукцион между аккаунтами дев-сервера). Чистая логика: ни диска,
 * ни HTTP — как их читать и писать, решает вызывающий (persist). Поэтому лоты,
 * почту, комиссию, истечение и все проверки гоняют тесты без сети.
 *
 * Модель «средства по почте», как в MMORPG: продавцу необязательно быть в сети.
 * Продал/истёк/отменил лот — выручка золотом или сам предмет ложатся в его почту
 * на сервере, и он заберёт их при следующем открытии рынка. Инвентарь и золото
 * игрока живут на клиенте (local-first), поэтому сервер их не считает: он хранит
 * лоты и почту, а списание/зачисление у себя делает клиент по ответу сервера.
 * Жульничество своим же сейвом никого больше не задевает (продавец получает
 * выручку один раз — лот удаляется атомарно), а честной игре вдвоём этого хватает.
 */

import { ITEMS, marketCategory, rarityOf, type MarketCategory, type Rarity } from '../src/game/items.ts';
import { SHARPEN_MAX } from '../src/game/forge.ts';

/** Комиссия рынка: доля выручки, что не доходит до продавца. Как на образце — 5%. */
export const MARKET_COMMISSION = 0.05;
/** Сколько живёт лот, мс. Сутки: не куплено — вернётся продавцу по почте. */
export const LISTING_TTL = 24 * 60 * 60 * 1000;
/** Больше стольких активных лотов на игрока не выставить — от засорения рынка. */
export const MAX_LOTS_PER_SELLER = 20;
/** Потолок цены: выше — почти наверняка порча/чит. */
export const MAX_PRICE = 10_000_000;
/** Сколько записей истории держим (глобально). */
const MAX_HISTORY = 500;
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

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Данные для persist/восстановления — ровно то, что переживает перезапуск. */
export interface MarketSnapshot {
  lots: Lot[];
  mail: Record<string, MailEntry[]>;
  history: TradeRecord[];
  seq: number;
}

/** Санация предмета: только наш id (своим полем таблицы), количество и заточка в рамках. */
export function cleanTradeItem(raw: unknown): TradeItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = r.id;
  if (typeof id !== 'string' || !Object.hasOwn(ITEMS, id)) return null;
  const def = ITEMS[id];

  const qty = Math.floor(Number(r.qty));
  if (!Number.isFinite(qty) || qty < 1 || qty > def.stack) return null;

  const item: TradeItem = { id, qty };
  if (def.slot === 'weapon') {
    const sp = Math.floor(Number(r.sharpen));
    if (Number.isFinite(sp) && sp > 0) item.sharpen = Math.min(SHARPEN_MAX, sp);
  }
  return item;
}

function cleanPrice(raw: unknown): number | null {
  const p = Math.floor(Number(raw));
  if (!Number.isFinite(p) || p < 1 || p > MAX_PRICE) return null;
  return p;
}

export class MarketStore {
  // Поля объявлены явно (не параметрами конструктора): node --experimental-strip
  // -types их не понимает, а тесты гоняются им.
  private lots: Map<string, Lot>;
  private mail: Map<string, MailEntry[]>;
  private history: TradeRecord[];
  private seq: number;
  private persist: (snap: MarketSnapshot) => void;

  constructor(initial: Partial<MarketSnapshot>, persist: (snap: MarketSnapshot) => void = () => {}) {
    this.lots = new Map((initial.lots ?? []).map((l) => [l.id, l]));
    this.mail = new Map(Object.entries(initial.mail ?? {}));
    this.history = initial.history ?? [];
    this.seq = initial.seq ?? 1;
    this.persist = persist;
  }

  snapshot(): MarketSnapshot {
    return {
      lots: [...this.lots.values()],
      mail: Object.fromEntries(this.mail),
      history: this.history,
      seq: this.seq,
    };
  }

  private save(): void {
    this.persist(this.snapshot());
  }

  private nextId(prefix: string): string {
    return `${prefix}${this.seq++}`;
  }

  private pushMail(key: string, entry: MailEntry): void {
    const box = this.mail.get(key) ?? [];
    box.push(entry);
    this.mail.set(key, box);
  }

  /** Убрать истёкшие лоты, вернув предмет продавцу по почте. Зовётся перед выдачей. */
  private expireDue(now: number): void {
    let changed = false;
    for (const lot of [...this.lots.values()]) {
      if (lot.expiresAt <= now) {
        this.lots.delete(lot.id);
        this.pushMail(lot.sellerKey, {
          id: this.nextId('m'),
          kind: 'item',
          item: lot.item,
          note: `Лот истёк: ${ITEMS[lot.item.id]?.name ?? lot.item.id}`,
          ts: now,
        });
        changed = true;
      }
    }
    if (changed) this.save();
  }

  /** Выставить лот. Предмет игрок уже списал у себя — сервер лишь регистрирует. */
  list(sellerKey: string, sellerName: string, rawItem: unknown, rawPrice: unknown, now: number): Result<{ lot: Lot }> {
    const item = cleanTradeItem(rawItem);
    if (!item) return { ok: false, error: 'Такой предмет выставить нельзя' };
    const price = cleanPrice(rawPrice);
    if (price === null) return { ok: false, error: 'Неверная цена' };

    const mine = [...this.lots.values()].filter((l) => l.sellerKey === sellerKey).length;
    if (mine >= MAX_LOTS_PER_SELLER) return { ok: false, error: `Нельзя больше ${MAX_LOTS_PER_SELLER} лотов` };

    const lot: Lot = {
      id: this.nextId('lot'),
      sellerKey,
      sellerName,
      item,
      price,
      createdAt: now,
      expiresAt: now + LISTING_TTL,
    };
    this.lots.set(lot.id, lot);
    this.save();
    return { ok: true, lot };
  }

  /** Витрина рынка: фильтры, сортировка, страницы. Истёкшие сначала убираются. */
  browse(filter: BrowseFilter, now: number): BrowseResult {
    this.expireDue(now);

    const search = (filter.search ?? '').trim().toLowerCase();
    let arr = [...this.lots.values()].filter((lot) => {
      if (filter.excludeSeller && lot.sellerKey === filter.excludeSeller) return false;
      if (filter.category && filter.category !== 'all' && marketCategory(lot.item.id) !== filter.category) return false;
      if (filter.rarity && filter.rarity !== 'any' && rarityOf(lot.item.id) !== filter.rarity) return false;
      if (search && !(ITEMS[lot.item.id]?.name.toLowerCase().includes(search))) return false;
      return true;
    });

    const unit = (l: Lot): number => l.price / l.item.qty;
    const byNewest = (a: Lot, b: Lot): number => b.createdAt - a.createdAt;
    arr.sort((a, b) => {
      switch (filter.sort) {
        case 'price_asc': return a.price - b.price || byNewest(a, b);
        case 'price_desc': return b.price - a.price || byNewest(a, b);
        case 'unit_asc': return unit(a) - unit(b) || byNewest(a, b);
        case 'expires': return a.expiresAt - b.expiresAt || byNewest(a, b);
        default: return byNewest(a, b);
      }
    });

    const pageSize = Math.max(1, Math.floor(filter.pageSize ?? PAGE_SIZE));
    const total = arr.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, Math.floor(filter.page ?? 1)), pages);
    const lots = arr.slice((page - 1) * pageSize, page * pageSize);
    return { lots, total, page, pages };
  }

  /** Мои активные лоты (вкладка «Мои лоты»). */
  mine(sellerKey: string, now: number): Lot[] {
    this.expireDue(now);
    return [...this.lots.values()].filter((l) => l.sellerKey === sellerKey).sort((a, b) => a.expiresAt - b.expiresAt);
  }

  /**
   * Купить лот. Атомарно: лот либо есть (тогда удаляем и начисляем выручку
   * продавцу по почте), либо уже куплен/истёк. Свой лот купить нельзя. Клиент по
   * успеху спишет у себя цену и положит предмет в сумку.
   */
  buy(buyerKey: string, buyerName: string, lotId: unknown, now: number): Result<{ item: TradeItem; price: number }> {
    this.expireDue(now);
    if (typeof lotId !== 'string') return { ok: false, error: 'Лот не найден' };
    const lot = this.lots.get(lotId);
    if (!lot) return { ok: false, error: 'Лот уже куплен или снят' };
    if (lot.sellerKey === buyerKey) return { ok: false, error: 'Нельзя купить свой лот' };

    this.lots.delete(lot.id);

    const fee = Math.round(lot.price * MARKET_COMMISSION);
    const payout = lot.price - fee;
    this.pushMail(lot.sellerKey, {
      id: this.nextId('m'),
      kind: 'gold',
      amount: payout,
      note: `Продано: ${ITEMS[lot.item.id]?.name ?? lot.item.id}${lot.item.qty > 1 ? ` ×${lot.item.qty}` : ''} (комиссия ${fee})`,
      ts: now,
    });

    this.history.unshift({
      ts: now,
      itemId: lot.item.id,
      qty: lot.item.qty,
      price: lot.price,
      sellerKey: lot.sellerKey,
      sellerName: lot.sellerName,
      buyerKey,
      buyerName,
    });
    if (this.history.length > MAX_HISTORY) this.history.length = MAX_HISTORY;

    this.save();
    return { ok: true, item: lot.item, price: lot.price };
  }

  /** Снять свой лот. Предмет вернётся владельцу по почте (заберёт при collectMail). */
  cancel(sellerKey: string, lotId: unknown, now: number): { ok: true } | { ok: false; error: string } {
    if (typeof lotId !== 'string') return { ok: false, error: 'Лот не найден' };
    const lot = this.lots.get(lotId);
    if (!lot) return { ok: false, error: 'Лот не найден' };
    if (lot.sellerKey !== sellerKey) return { ok: false, error: 'Это не ваш лот' };

    this.lots.delete(lot.id);
    this.pushMail(sellerKey, {
      id: this.nextId('m'),
      kind: 'item',
      item: lot.item,
      note: `Снято с продажи: ${ITEMS[lot.item.id]?.name ?? lot.item.id}`,
      ts: now,
    });
    this.save();
    return { ok: true };
  }

  /** Что ждёт игрока на почте (выручка, возвраты). НЕ удаляем — удалит ack по факту приёма. */
  mailFor(key: string): MailEntry[] {
    return this.mail.get(key) ?? [];
  }

  /**
   * Подтвердить приём записей почты по их id и удалить их. Клиент шлёт сюда только
   * то, что реально зачислил (золото — всегда, предмет — если влез в сумку), а не
   * влезшее остаётся на почте до следующего раза. Так предметы не теряются.
   */
  ackMail(key: string, ids: unknown): { removed: number } {
    const set = new Set(Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : []);
    const box = this.mail.get(key);
    if (!box || set.size === 0) return { removed: 0 };
    const kept = box.filter((e) => !set.has(e.id));
    const removed = box.length - kept.length;
    if (kept.length) this.mail.set(key, kept);
    else this.mail.delete(key);
    if (removed) this.save();
    return { removed };
  }

  /** История сделок игрока (где он продавец или покупатель), новыми вперёд. */
  historyFor(key: string, limit = 50): TradeRecord[] {
    return this.history.filter((h) => h.sellerKey === key || h.buyerKey === key).slice(0, limit);
  }
}
