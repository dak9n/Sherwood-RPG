import { validateMap } from '../map/validate';
import type { EditorState } from './state';

export type SaveResult =
  | { ok: true; revision: string; backup: string | null }
  | { ok: false; kind: 'conflict'; revision: string }
  | { ok: false; kind: 'invalid'; errors: string[] }
  | { ok: false; kind: 'error'; message: string };

/** Ревизия карты <name>.json на диске ('none', если файла ещё нет). */
export async function fetchRevision(name: string): Promise<string> {
  const res = await fetch(`/__map-meta?name=${encodeURIComponent(name)}`);
  const body = await res.json();
  return body.revision;
}

/** Список карт на диске для стартового экрана. */
export async function fetchMaps(): Promise<string[]> {
  const res = await fetch('/__maps');
  const body = await res.json();
  return Array.isArray(body.maps) ? body.maps : [];
}

/** Удаляет карту <name>.json (сервер перед этим кладёт её в .map-backups). forest удалить нельзя. */
export async function deleteMap(name: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/__delete-map', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (res.status === 200) return { ok: true };
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? `server replied ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function readResult(res: Response): Promise<SaveResult> {
  const body = await res.json().catch(() => ({}));
  if (res.status === 200) return { ok: true, revision: body.revision, backup: body.backup ?? null };
  if (res.status === 409) return { ok: false, kind: 'conflict', revision: body.revision };
  if (res.status === 422) return { ok: false, kind: 'invalid', errors: body.errors ?? [] };
  return { ok: false, kind: 'error', message: body.error ?? `server replied ${res.status}` };
}

async function post(name: string, baseRevision: string, force: boolean, map: unknown): Promise<SaveResult> {
  const errors = validateMap(map);
  if (errors.length) return { ok: false, kind: 'invalid', errors };
  try {
    const res = await fetch('/__save-map', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, baseRevision, force, map }),
    });
    return await readResult(res);
  } catch (e) {
    return { ok: false, kind: 'error', message: (e as Error).message };
  }
}

/**
 * Сохраняет открытую карту в её файл. Имя берём из state, а не отдельным
 * аргументом: так name+baseRevision+map всегда описывают один и тот же документ,
 * и нельзя случайно записать не в тот файл. force затирает чужую версию — только
 * по явному решению пользователя в диалоге конфликта.
 */
export function saveMap(state: EditorState, { force = false } = {}): Promise<SaveResult> {
  return post(state.mapName, state.baseRevision, force, state.doc.map);
}

/**
 * «Сохранить как»: пишет текущую карту в НОВЫЙ файл name. baseRevision='none' —
 * значит «создаю новый файл»: если карта с таким именем уже есть, сервер вернёт
 * 409 (не затираем чужое), а не перезапишет.
 */
export function saveMapAs(state: EditorState, name: string): Promise<SaveResult> {
  return post(name, 'none', false, state.doc.map);
}
