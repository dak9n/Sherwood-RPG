import { validateMap } from '../map/validate';
import type { EditorState } from './state';

export type SaveResult =
  | { ok: true; revision: string; backup: string | null }
  | { ok: false; kind: 'conflict'; revision: string }
  | { ok: false; kind: 'invalid'; errors: string[] }
  | { ok: false; kind: 'error'; message: string };

export async function fetchRevision(): Promise<string> {
  const res = await fetch('/__map-meta');
  const body = await res.json();
  return body.revision;
}

/**
 * Отправляет карту на дев-сервер. force затирает чужую версию — только по
 * явному решению пользователя в диалоге конфликта.
 */
export async function saveMap(state: EditorState, { force = false } = {}): Promise<SaveResult> {
  const errors = validateMap(state.doc.map);
  if (errors.length) return { ok: false, kind: 'invalid', errors };

  let res: Response;
  try {
    res = await fetch('/__save-map', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRevision: state.baseRevision, force, map: state.doc.map }),
    });
  } catch (e) {
    return { ok: false, kind: 'error', message: (e as Error).message };
  }

  const body = await res.json().catch(() => ({}));

  if (res.status === 200) return { ok: true, revision: body.revision, backup: body.backup ?? null };
  if (res.status === 409) return { ok: false, kind: 'conflict', revision: body.revision };
  if (res.status === 422) return { ok: false, kind: 'invalid', errors: body.errors ?? [] };
  return { ok: false, kind: 'error', message: body.error ?? `сервер ответил ${res.status}` };
}
