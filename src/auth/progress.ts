import { getToken } from './client';

/**
 * Клиентская сторона прогресса: тянет сейв при запуске и шлёт обратно при
 * изменениях. Сервер хранит сейв как есть; чистит его от битого и невозможного
 * уже игра (src/game/save.ts) при применении.
 *
 * Две опоры, не одна. РАНЬШЕ сейв жил только на дев-сервере (ручки /__save-*),
 * а в собранной игре их нет вовсе — и прогресс не сохранялся никак. Теперь
 * ГЛАВНОЕ хранилище — localStorage браузера: он есть всегда, поэтому сохранять
 * можно всегда. Сервер, если он поднят (дев), дублирует — на будущее, для входа
 * с другого места. Сейв крошечный и без секретов (пароля там нет), лежать в
 * браузере ему не вредно.
 */

/**
 * Сырой сейв, скачанный при загрузке до старта сцены. Сцена забирает его в
 * onReady синхронно: тянуть его из сети внутри создания сцены нельзя — там всё
 * синхронно. Кладём здесь, а main.ts наполняет ДО запуска игры.
 */
let pending: unknown = null;

/** Аккаунт вошедшего — под этим ключом лежит локальный сейв. Ставит main.ts. */
let account = '';

export function setAccount(name: string): void {
  account = name;
}

/**
 * Ник героя, выбранный при создании (или взятый из сейва). main.ts кладёт его
 * ДО старта игры, сцена забирает в onReady — как и сам сейв. Отдельно от сейва,
 * потому что у нового игрока сейва ещё нет, а ник уже есть.
 */
let pendingChar = '';

export function setPendingChar(name: string): void {
  pendingChar = name;
}

export function takePendingChar(): string {
  const c = pendingChar;
  pendingChar = '';
  return c;
}

/**
 * Класс героя с экрана создания. Применяется ОДИН раз и только к новому герою
 * (у которого нет сейва): класс здесь — это стартовая экипировка, а дальше
 * всё живёт в самих вещах и сохраняется обычным сейвом.
 */
let pendingClass = '';

export function setPendingClass(id: string): void {
  pendingClass = id;
}

export function takePendingClass(): string {
  const c = pendingClass;
  pendingClass = '';
  return c;
}

/** Ключ локального сейва: у каждого аккаунта свой, чтобы не путать прогресс. */
const localKey = (): string => (account ? `progress:${account}` : '');

function loadLocal(): unknown {
  const k = localKey();
  if (!k) return null;
  try {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveLocal(save: unknown): void {
  const k = localKey();
  if (!k) return;
  try {
    localStorage.setItem(k, JSON.stringify(save));
  } catch {
    // Переполнение или приватный режим — не беда: если есть сервер, он подстрахует.
  }
}

export function setPendingSave(raw: unknown): void {
  pending = raw;
}

/** Забрать скачанный сейв (одноразово). */
export function takePendingSave(): unknown {
  const r = pending;
  pending = null;
  return r;
}

/**
 * Раньше здесь жил флаг «загрузка не удалась → не сохранять, чтобы не затереть
 * сервер». Он-то и глушил автосейв, когда сервера нет (собранная игра) или он
 * икнул. Теперь опора — локальный сейв: он всегда под рукой, затирать нечего,
 * поэтому сохранять можно всегда. Функцию оставляем — сцена ею проверяет,
 * можно ли включать автосейв.
 */
export function loadFailed(): boolean {
  return false;
}

/**
 * Скачать сейв вошедшего.
 *
 * СНАЧАЛА локальный сейв: на этой машине он самый свежий. Пусть отправка на
 * сервер когда-то и сорвалась (сеть) — локально прогресс всё равно жив, и терять
 * его, взяв отставший серверный, нельзя. Локального нет (новый браузер или
 * устройство) — пробуем сервер: он мог сохранить прогресс со входа в другом
 * месте, тогда им и засеемся. Нет нигде — null, значит новый герой.
 */
export async function fetchProgress(): Promise<unknown> {
  const local = loadLocal();
  if (local != null) return local;

  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch('/__load-progress', { headers: { authorization: `Bearer ${token}` } });
    if (res.ok) {
      const data = (await res.json()) as { save?: unknown };
      return data.save ?? null;
    }
  } catch {
    // Сервера нет (собранная игра) или сеть отвалилась — новый герой.
  }
  return null;
}

/**
 * Сохранить прогресс. ВСЕГДА пишем в localStorage — это и есть надёжное
 * сохранение, работающее без сервера. Плюс, если сервер поднят, шлём и ему —
 * тихо: автосейв не должен мешать игре сообщениями.
 */
export async function pushProgress(save: unknown): Promise<void> {
  saveLocal(save);

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
    // Сеть отвалилась — локально прогресс уже сохранён.
  }
}
