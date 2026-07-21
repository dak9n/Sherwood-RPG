/**
 * Сборка состояния сервера: пользователи, сессии, прогресс, рынок.
 *
 * Общая для обеих точек входа — дев-сервера Vite и отдельного процесса. Именно
 * поэтому она вынесена отдельно: если бы каждая собирала своё, они бы разошлись
 * в мелочах (где лежит файл, когда сбрасывать на диск), а расхождение такого
 * рода обнаруживается уже на живых игроках.
 */

import { resolve } from 'node:path';
import { AuthStore } from './auth-store.ts';
import { MarketStore } from './market-store.ts';
import {
  loadUsers,
  saveUsers,
  loadSessions,
  saveSessions,
  loadProgress,
  saveProgress,
} from './auth-persist.ts';
import { loadMarket, saveMarket } from './market-persist.ts';
import type { ApiDeps } from './http/router.ts';

/**
 * Всё состояние — в .auth/, ВНЕ public/. Из public всё уезжает в сборку и
 * раздаётся браузеру; хеши паролей и токены сессий там оказаться не должны
 * даже случайно. Папка в .gitignore.
 */
const AUTH_FILE = '.auth/users.json';
const SESSIONS_FILE = '.auth/sessions.json';
const PROGRESS_FILE = '.auth/progress.json';
const MARKET_FILE = '.auth/market.json';

export async function buildDeps(root: string): Promise<ApiDeps> {
  const usersFile = resolve(root, AUTH_FILE);
  const sessionsFile = resolve(root, SESSIONS_FILE);
  const progressFile = resolve(root, PROGRESS_FILE);
  const marketFile = resolve(root, MARKET_FILE);

  const store = await AuthStore.create(
    loadUsers(usersFile),
    (users) => saveUsers(usersFile, users),
    { initial: loadSessions(sessionsFile), persist: (s) => saveSessions(sessionsFile, s) },
  );

  // Прогресс держим в памяти и сбрасываем на диск при каждой записи.
  const progress = loadProgress(progressFile);

  // Торговый рынок: лоты и почта между аккаунтами. Тот же AuthStore решает,
  // кто выставил/купил (keyOf по токену). Ручки заперты флагом — см. flags.ts.
  const market = new MarketStore(loadMarket(marketFile), (snap) => saveMarket(marketFile, snap));

  return {
    store,
    market,
    progress,
    flushProgress: () => saveProgress(progressFile, progress),
    now: () => Date.now(),
  };
}
