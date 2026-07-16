/**
 * Учёт пользователей и сессий. Файлы и HTTP сюда не заходят: как их читать и
 * писать, решает вызывающий (передаёт persist). Поэтому логика — регистрация,
 * вход, сессии, защита от перебора — проверяется тестами без диска и сети.
 */

import {
  hashPassword,
  verifyPassword,
  validateUsername,
  validatePassword,
  normalizeName,
  newToken,
} from './auth-core.ts';

export interface UserRecord {
  /** Как игрок написал имя — это и показываем. */
  name: string;
  /** Ключ без регистра: по нему проверяем занятость. */
  nameKey: string;
  /** scrypt-хеш пароля. Сам пароль нигде не лежит. */
  hash: string;
  createdAt: number;
}

/** Сколько живёт сессия. Месяц: не входить же заново каждый запуск. */
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
/** После стольких неверных попыток имя запирается на LOCK_MS — против перебора. */
const MAX_FAILS = 8;
const LOCK_MS = 5 * 60 * 1000;

export interface AuthResult {
  ok: boolean;
  error?: string;
  token?: string;
  name?: string;
}

export class AuthStore {
  private sessions = new Map<string, { nameKey: string; expiresAt: number }>();
  private fails = new Map<string, { count: number; until: number }>();

  // Поля объявлены явно, а не параметрами-свойствами: node --experimental-strip
  // -types их не понимает, а тесты гоняются именно им.
  private users: Map<string, UserRecord>;
  private persist: (users: UserRecord[]) => void;
  /**
   * Хеш-пустышка: по ней «проверяем» несуществующего игрока, чтобы вход по
   * чужому имени занимал столько же времени, сколько по своему. Иначе по
   * скорости ответа было бы видно, какое имя занято.
   */
  private dummyHash: string;

  private constructor(
    users: Map<string, UserRecord>,
    persist: (users: UserRecord[]) => void,
    dummyHash: string,
  ) {
    this.users = users;
    this.persist = persist;
    this.dummyHash = dummyHash;
  }

  /** Собрать хранилище. Асинхронно: пустышку считаем тем же scrypt, что и всех. */
  static async create(
    initial: UserRecord[],
    persist: (users: UserRecord[]) => void,
  ): Promise<AuthStore> {
    const users = new Map(initial.map((u) => [u.nameKey, u]));
    const dummy = await hashPassword(newToken());
    return new AuthStore(users, persist, dummy);
  }

  /** Зарегистрировать нового. Имя должно быть свободно. */
  async register(name: unknown, password: unknown, now: number): Promise<AuthResult> {
    const nameErr = validateUsername(name);
    if (nameErr) return { ok: false, error: nameErr };
    const pwErr = validatePassword(password);
    if (pwErr) return { ok: false, error: pwErr };

    const display = (name as string).trim();
    const key = normalizeName(display);
    if (this.users.has(key)) return { ok: false, error: 'Это имя уже занято' };

    const rec: UserRecord = {
      name: display,
      nameKey: key,
      hash: await hashPassword(password as string),
      createdAt: now,
    };
    this.users.set(key, rec);
    this.persist([...this.users.values()]);

    return { ok: true, token: this.issue(key, now), name: display };
  }

  /**
   * Войти. Ошибка НАМЕРЕННО общая («Неверное имя или пароль»): раздельные «нет
   * такого имени» и «пароль не тот» подсказали бы взломщику, какое имя занято.
   */
  async login(name: unknown, password: unknown, now: number): Promise<AuthResult> {
    if (typeof name !== 'string' || typeof password !== 'string') {
      return { ok: false, error: 'Введите имя и пароль' };
    }
    const key = normalizeName(name);

    // Заперто, только если промахов накопилось до предела И окошко ещё идёт.
    const rec = this.fails.get(key);
    if (rec && rec.count >= MAX_FAILS && rec.until > now) {
      return { ok: false, error: 'Слишком много попыток. Подождите пару минут' };
    }

    const user = this.users.get(key);
    // Даже если пользователя нет — гоняем verify по пустышке: время ответа
    // не должно выдавать, существует имя или нет.
    const good = await verifyPassword(password, user ? user.hash : this.dummyHash);

    if (!user || !good) {
      this.noteFail(key, now);
      return { ok: false, error: 'Неверное имя или пароль' };
    }

    this.fails.delete(key);
    return { ok: true, token: this.issue(key, now), name: user.name };
  }

  /**
   * Ключ аккаунта по токену — к нему привязываются данные игрока (сейв). Тот же
   * токен, что и у whoami, но отдаёт нормализованный ключ, а не показное имя:
   * файл прогресса не должен зависеть от регистра, в котором игрок вошёл.
   */
  keyOf(token: unknown, now: number): string | null {
    if (typeof token !== 'string') return null;
    const s = this.sessions.get(token);
    if (!s || s.expiresAt <= now) return null;
    return this.users.has(s.nameKey) ? s.nameKey : null;
  }

  /** Кто вошёл по этому токену. null — токен неизвестен или протух. */
  whoami(token: unknown, now: number): string | null {
    if (typeof token !== 'string') return null;
    const s = this.sessions.get(token);
    if (!s) return null;
    if (s.expiresAt <= now) {
      this.sessions.delete(token);
      return null;
    }
    return this.users.get(s.nameKey)?.name ?? null;
  }

  logout(token: unknown): void {
    if (typeof token === 'string') this.sessions.delete(token);
  }

  private issue(nameKey: string, now: number): string {
    const token = newToken();
    this.sessions.set(token, { nameKey, expiresAt: now + SESSION_TTL });
    return token;
  }

  private noteFail(key: string, now: number): void {
    // Промахи копятся в скользящем окне LOCK_MS. Разовая опечатка забудется сама
    // по окончании окна; серия подряд — накопится до предела и запрёт вход.
    const cur = this.fails.get(key);
    const count = (cur && cur.until > now ? cur.count : 0) + 1;
    this.fails.set(key, { count, until: now + LOCK_MS });
  }
}
