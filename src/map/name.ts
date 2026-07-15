/**
 * Проверка имени карты. Имя становится именем файла на диске, поэтому набор
 * символов строгий: только буквы (лат. и кириллица), цифры, дефис, подчёркивание.
 * Ни '.', ни '/', ни '\\', ни ':', ни пробелов — значит '..', пути, расширения и
 * диски невыразимы в принципе.
 *
 * isSafeMapName — общая проверка для клиента и сервера (сервер импортирует её же,
 * чтобы наборы символов не разъехались). mapNameError — обёртка для диалога с
 * человекочитаемой ошибкой.
 */

/** Windows резервирует эти имена под устройства: NUL.json всё равно резолвится в устройство. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const SAFE = /^[A-Za-z0-9А-Яа-яЁё_-]{1,64}$/;

export function isSafeMapName(name: string): boolean {
  return SAFE.test(name) && !RESERVED.test(name);
}

/** Ошибка имени для диалога, или null если годится. existing — уже занятые имена карт. */
export function mapNameError(existing: string[], name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'имя не может быть пустым';
  if (!isSafeMapName(trimmed)) return 'только буквы, цифры, дефис и подчёркивание — без пробелов и точек';
  if (existing.some((n) => n.toLowerCase() === trimmed.toLowerCase())) return `карта «${trimmed}» уже есть`;
  return null;
}
