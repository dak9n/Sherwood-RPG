/**
 * Чтение и запись пользователей на диск.
 *
 * Файл лежит в .auth/ — ВНЕ public/. Это принципиально: из public всё уезжает в
 * сборку и раздаётся браузеру, а отдать наружу файл с хешами паролей нельзя даже
 * случайно. Папка в .gitignore — чужие аккаунты не место в репозитории.
 */

import { readFileSync, existsSync, mkdirSync, openSync, writeSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { UserRecord } from './auth-store.ts';

/** Прочитать пользователей. Нет файла или он битый — начинаем с пустого списка. */
export function loadUsers(path: string): UserRecord[] {
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(data)) return [];
    // Берём только записи с обязательными полями: руками попорченный файл не
    // должен уронить сервер.
    return data.filter(
      (u): u is UserRecord =>
        u && typeof u.name === 'string' && typeof u.nameKey === 'string' && typeof u.hash === 'string',
    );
  } catch {
    return [];
  }
}

/**
 * Записать во временный файл и переименовать: оборванная запись не оставит
 * обрубок базы пользователей. Тот же приём, что у сохранения карт.
 */
export function saveUsers(path: string, users: UserRecord[]): void {
  writeAtomic(path, JSON.stringify(users, null, 2), 'users');
}

/**
 * Прогресс игроков: карта «ключ аккаунта -> сейв». Сервер не разбирает сейв —
 * хранит как есть, а чистит его клиент при загрузке (src/game/save.ts). Одним
 * файлом, а не по файлу на игрока: имена в файловых путях — лишний источник
 * хлопот, а игроков тут двое.
 */
export function loadProgress(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function saveProgress(path: string, map: Record<string, unknown>): void {
  writeAtomic(path, JSON.stringify(map), 'progress');
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
