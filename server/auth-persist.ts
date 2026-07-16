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
  mkdirSync(dirname(path), { recursive: true });
  const tmp = resolve(dirname(path), `users.${process.pid}.tmp.json`);
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, JSON.stringify(users, null, 2), null, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}
