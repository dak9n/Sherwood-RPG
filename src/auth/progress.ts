import { getToken } from './client';

/**
 * Клиентская сторона прогресса: тянет сейв при запуске и шлёт обратно при
 * изменениях. Сервер хранит сейв как есть; чистит его от битого и невозможного
 * уже игра (src/game/save.ts) при применении.
 */

/**
 * Сырой сейв, скачанный при загрузке до старта сцены. Сцена забирает его в
 * onReady синхронно: тянуть его из сети внутри создания сцены нельзя — там всё
 * синхронно. Кладём здесь, а main.ts наполняет ДО запуска игры.
 */
let pending: unknown = null;

export function setPendingSave(raw: unknown): void {
  pending = raw;
}

/** Забрать скачанный сейв (одноразово). */
export function takePendingSave(): unknown {
  const r = pending;
  pending = null;
  return r;
}

/** Скачать сейв вошедшего. null — сейва нет, не вошёл или сервера нет. */
export async function fetchProgress(): Promise<unknown> {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch('/__load-progress', { headers: { authorization: `Bearer ${token}` } });
    const data = (await res.json()) as { save?: unknown };
    return data.save ?? null;
  } catch {
    return null;
  }
}

/** Отправить сейв на сервер. Тихо: автосейв не должен мешать игре сообщениями. */
export async function pushProgress(save: unknown): Promise<void> {
  const token = getToken();
  if (!token) return;
  try {
    await fetch('/__save-progress', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(save),
      // keepalive: запрос доживёт, даже если вкладку закрывают прямо сейчас.
      keepalive: true,
    });
  } catch {
    // Сеть отвалилась — прогресс уйдёт при следующем автосейве.
  }
}
