/**
 * Защищённое ядро авторизации. Только чистые функции: ни сервера, ни файлов,
 * ни браузера — поэтому проверяется тестами, и именно здесь живёт безопасность.
 *
 * ПАРОЛЬ НЕ ХРАНИТСЯ. Хранится его хеш, полученный scrypt со случайной солью.
 * scrypt — медленная функция вывода ключа (Node встроил её сам, плагины не
 * нужны): подобрать пароль перебором по хешу дорого. Обратно из хеша пароль не
 * достать. Сравнение — timingSafeEqual, чтобы по времени ответа нельзя было
 * угадывать пароль по символу.
 *
 * Клиент (браузер) этот файл НЕ импортирует никогда: node:crypto в браузере нет,
 * а пароль обязан проверяться на сервере. Здесь только серверная сторона.
 */

import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

/** Длина выводимого ключа и соли в байтах. 16 байт соли — 128 бит, с запасом. */
const KEY_LEN = 64;
const SALT_LEN = 16;

/**
 * Пароль длиннее этого не хешируем: scrypt гоняет весь пароль, и мегабайтная
 * строка стала бы бесплатной атакой на процессор сервера.
 */
export const MAX_PASSWORD = 200;
const MIN_PASSWORD = 6;
const MIN_NAME = 3;
const MAX_NAME = 20;

/**
 * Захешировать пароль. Формат строки: scrypt$<соль hex>$<ключ hex>.
 *
 * Соль хранится рядом с хешем и у каждого пользователя своя — иначе одинаковые
 * пароли давали бы одинаковые хеши, и радужная таблица вскрыла бы всех разом.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

/**
 * Верно ли пароль. Битую или чужого формата строку считаем непройденной, но не
 * падаем: сюда приходит и то, что кто-то мог подсунуть в файл руками.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1], 'hex');
    expected = Buffer.from(parts[2], 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const key = (await scryptAsync(password, salt, expected.length)) as Buffer;
  // Длины равны по построению, но timingSafeEqual бросает на разных — страхуемся.
  if (key.length !== expected.length) return false;
  return timingSafeEqual(key, expected);
}

/** Имя для сравнения: без регистра и крайних пробелов. «Geko» и «geko» — один игрок. */
export const normalizeName = (name: string): string => name.trim().toLowerCase();

/**
 * Проверка имени. Возвращает текст ошибки для игрока или null, если всё хорошо.
 *
 * Пускаем буквы (в т.ч. кириллицу), цифры, пробел, дефис и подчёркивание.
 * Ни точек, ни слэшей — имя нигде не становится путём к файлу, но лишний повод
 * для инъекции убираем сразу.
 */
/**
 * Служебные имена свойств объекта. Имя-ключ вроде __proto__ опасно: если такой
 * строкой индексировать обычный объект (например, карту «аккаунт -> сейв»),
 * запись подменит прототип, а не создаст поле. Проще запретить их в именах, чем
 * потом чинить каждое место, где имя становится ключом.
 */
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);

export function validateUsername(name: unknown): string | null {
  if (typeof name !== 'string') return 'Введите имя';
  const n = name.trim();
  if (n.length < MIN_NAME) return `Имя короче ${MIN_NAME} символов`;
  if (n.length > MAX_NAME) return `Имя длиннее ${MAX_NAME} символов`;
  if (!/^[\p{L}\p{N} _-]+$/u.test(n)) return 'Только буквы, цифры, пробел, дефис и _';
  if (RESERVED.has(n.toLowerCase())) return 'Это имя занято системой';
  return null;
}

/** Проверка пароля. Верхний предел — не каприз, а защита сервера (см. MAX_PASSWORD). */
export function validatePassword(pw: unknown): string | null {
  if (typeof pw !== 'string') return 'Введите пароль';
  if (pw.length < MIN_PASSWORD) return `Пароль короче ${MIN_PASSWORD} символов`;
  if (pw.length > MAX_PASSWORD) return `Пароль длиннее ${MAX_PASSWORD} символов`;
  return null;
}

/**
 * Токен сессии: 256 случайных бит в hex. По нему сервер узнаёт вошедшего, не
 * спрашивая пароль повторно. Угадать перебором нереально.
 */
export const newToken = (): string => randomBytes(32).toString('hex');
