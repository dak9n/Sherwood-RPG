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

/**
 * Выданная сессия в виде, пригодном для записи на диск.
 *
 * Сессии живут месяц, а процесс сервера — до первой правки кода. Пока сервером
 * был дев-сервер Vite, это означало разлогин обеих тестовых вкладок при каждом
 * сохранении файла: правка чего угодно в цепочке зависимостей vite.config
 * перезапускает конфиг, и Map сессий начинается заново. Терпимо, когда игрок
 * один и он же автор; невыносимо, когда игроков двое и один из них не понимает,
 * почему его выкинуло.
 */
export interface SessionRecord {
  token: string;
  nameKey: string;
  expiresAt: number;
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

  /**
   * Очередь: регистрация и вход выполняются строго по одному.
   *
   * Без этого параллельные запросы обходили защиту: между синхронной проверкой
   * (имя занято? / заперто ли за перебор) и последующим await hashPassword/
   * verifyPassword управление уходило в цикл событий, и сотня одновременных
   * входов успевала проскочить ворота до того, как хоть один увеличил счётчик
   * промахов. Проверено атакой: 200 параллельных входов давали 200 проверок
   * пароля вместо 8. Последовательное исполнение это закрывает — и вдобавок
   * лишает атакующего параллелизма.
   */
  private lock: Promise<unknown> = Promise.resolve();

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Куда складывать сессии, чтобы пережить перезапуск. По умолчанию — никуда:
   * тестам диск не нужен, и переживать им нечего.
   */
  private persistSessions: (sessions: SessionRecord[]) => void = () => {};

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
    sessions?: {
      initial: SessionRecord[];
      persist: (sessions: SessionRecord[]) => void;
    },
  ): Promise<AuthStore> {
    const users = new Map(initial.map((u) => [u.nameKey, u]));
    const dummy = await hashPassword(newToken());
    const store = new AuthStore(users, persist, dummy);

    if (sessions) {
      for (const s of sessions.initial) {
        store.sessions.set(s.token, { nameKey: s.nameKey, expiresAt: s.expiresAt });
      }
      // Ставим обработчик ПОСЛЕ загрузки: иначе восстановление само бы вызвало
      // запись, и каждый старт сервера переписывал бы файл сессий без нужды.
      store.persistSessions = sessions.persist;
    }
    return store;
  }

  /** Живые сессии для записи на диск. Протухшие не отдаём — незачем их воскрешать. */
  private liveSessions(now: number): SessionRecord[] {
    const out: SessionRecord[] = [];
    for (const [token, s] of this.sessions) {
      if (s.expiresAt > now) out.push({ token, nameKey: s.nameKey, expiresAt: s.expiresAt });
    }
    return out;
  }

  /** Зарегистрировать нового. Имя должно быть свободно. По одному за раз. */
  register(name: unknown, password: unknown, now: number): Promise<AuthResult> {
    return this.serialize(() => this.runRegister(name, password, now));
  }

  /** Войти. По одному за раз — иначе перебор обходит защиту (см. serialize). */
  login(name: unknown, password: unknown, now: number): Promise<AuthResult> {
    return this.serialize(() => this.runLogin(name, password, now));
  }

  private async runRegister(name: unknown, password: unknown, now: number): Promise<AuthResult> {
    const nameErr = validateUsername(name);
    if (nameErr) return { ok: false, error: nameErr };
    const pwErr = validatePassword(password);
    if (pwErr) return { ok: false, error: pwErr };

    const display = (name as string).trim();
    const key = normalizeName(display);
    if (this.users.has(key)) return { ok: false, error: 'This name is already taken' };

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

  private async runLogin(name: unknown, password: unknown, now: number): Promise<AuthResult> {
    if (typeof name !== 'string' || typeof password !== 'string') {
      return { ok: false, error: 'Enter name and password' };
    }
    const key = normalizeName(name);

    // Заперто, только если промахов накопилось до предела И окошко ещё идёт.
    const rec = this.fails.get(key);
    if (rec && rec.count >= MAX_FAILS && rec.until > now) {
      return { ok: false, error: 'Too many attempts. Wait a couple of minutes' };
    }

    const user = this.users.get(key);
    // Даже если пользователя нет — гоняем verify по пустышке: время ответа
    // не должно выдавать, существует имя или нет.
    const good = await verifyPassword(password, user ? user.hash : this.dummyHash);

    if (!user || !good) {
      this.noteFail(key, now);
      return { ok: false, error: 'Wrong name or password' };
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

  /**
   * Погасить сессию. now нужен, чтобы записать на диск только живые сессии —
   * как и у всех остальных методов, время сюда передают, а не берут из часов:
   * тогда поведение проверяется тестами без ожидания.
   */
  logout(token: unknown, now: number): void {
    if (typeof token !== 'string') return;
    if (this.sessions.delete(token)) this.persistSessions(this.liveSessions(now));
  }

  private issue(nameKey: string, now: number): string {
    const token = newToken();
    this.sessions.set(token, { nameKey, expiresAt: now + SESSION_TTL });
    this.persistSessions(this.liveSessions(now));
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
