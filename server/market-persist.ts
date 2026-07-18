/**
 * Чтение и запись лотов рынка на диск.
 *
 * Файл в .auth/ — ВНЕ public/ (как users/progress): в сборку и браузеру уходит
 * только public, а торговую базу наружу отдавать незачем. Папка в .gitignore.
 *
 * Содержимое лотов сервер не перепроверяет при загрузке (файл пишем только мы,
 * атомарно): чинит и санирует входящие предметы MarketStore при выставлении.
 */

import { readFileSync, existsSync, mkdirSync, openSync, writeSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { MarketSnapshot, Lot, MailEntry, TradeRecord } from './market-store.ts';

export function loadMarket(path: string): Partial<MarketSnapshot> {
  if (!existsSync(path)) return {};
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const d = data as Record<string, unknown>;
    return {
      lots: Array.isArray(d.lots) ? (d.lots as Lot[]) : [],
      mail: d.mail && typeof d.mail === 'object' && !Array.isArray(d.mail) ? (d.mail as Record<string, MailEntry[]>) : {},
      history: Array.isArray(d.history) ? (d.history as TradeRecord[]) : [],
      seq: typeof d.seq === 'number' && Number.isFinite(d.seq) ? d.seq : 1,
    };
  } catch {
    return {};
  }
}

export function saveMarket(path: string, snap: MarketSnapshot): void {
  writeAtomic(path, JSON.stringify(snap), 'market');
}

/** Пишем через временный файл и rename: оборванная запись не бьёт настоящий файл. */
function writeAtomic(path: string, text: string, tag: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = resolve(dirname(path), `${tag}.${process.pid}.tmp.json`);
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, text, null, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}
