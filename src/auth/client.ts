/**
 * Клиентская сторона авторизации. Пароль отправляется на сервер и проверяется
 * ТАМ — в браузере он нигде не хранится и не сравнивается.
 *
 * В браузере лежит только токен сессии (в localStorage). Это не пароль: по
 * токену нельзя войти повторно после выхода, и живёт он ограниченно. Сервер
 * отдал его в обмен на верный пароль, дальше пароль клиенту не нужен.
 */

const TOKEN_KEY = 'auth-token';

export const getToken = (): string => localStorage.getItem(TOKEN_KEY) ?? '';
const setToken = (t: string): void => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);

export interface AuthResult {
  ok: boolean;
  error?: string;
  name?: string;
}

/**
 * Ответ сервера как json. Если пришло не json (например, собранная игра без
 * сервера отдаёт index.html) — честно говорим, что сервера нет, а не молча
 * притворяемся, что вошли.
 */
async function postJson(path: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { status: 0, data: { error: 'Сервер авторизации недоступен' } };
  }
  try {
    return { status: res.status, data: (await res.json()) as Record<string, unknown> };
  } catch {
    return { status: res.status, data: { error: 'Сервер авторизации недоступен' } };
  }
}

const finish = (status: number, data: Record<string, unknown>): AuthResult => {
  if (data.ok && typeof data.token === 'string') {
    setToken(data.token);
    return { ok: true, name: typeof data.name === 'string' ? data.name : undefined };
  }
  return { ok: false, error: typeof data.error === 'string' ? data.error : `Ошибка (${status})` };
};

export async function register(name: string, password: string): Promise<AuthResult> {
  const { status, data } = await postJson('/__register', { name, password });
  return finish(status, data);
}

export async function login(name: string, password: string): Promise<AuthResult> {
  const { status, data } = await postJson('/__login', { name, password });
  return finish(status, data);
}

/** Имя вошедшего по сохранённому токену. null — токена нет, протух или сервера нет. */
export async function whoami(): Promise<string | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch('/__whoami', { headers: { authorization: `Bearer ${token}` } });
    const data = (await res.json()) as { name?: unknown };
    return typeof data.name === 'string' ? data.name : null;
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  const token = getToken();
  clearToken();
  if (!token) return;
  // Гасим сессию и на сервере, чтобы токен нельзя было использовать снова.
  try {
    await fetch('/__logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  } catch {
    // Сеть отвалилась — токен всё равно уже убран из браузера.
  }
}
