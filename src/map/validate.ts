/**
 * Проверка карты перед записью на диск. Последний рубеж: то, что сюда прошло,
 * перезапишет forest.json.
 *
 * Модуль листовой — он импортируется и браузером, и плагином дев-сервера.
 * Если сюда затащить что-то браузерное, оно попадёт в граф vite.config.ts,
 * и правка клиентского кода начнёт перезапускать дев-сервер целиком.
 */

const GID_MASK = 0x1fffffff;

/** Больше миллиона клеток — это опечатка в диалоге, а не намерение. */
const MAX_CELLS = 1_000_000;

export function validateMap(map: unknown): string[] {
  const errors: string[] = [];
  const m = map as Record<string, unknown>;

  if (!m || typeof m !== 'object') return ['карта не объект'];
  if (m.version !== 1) errors.push(`version должен быть 1, а не ${JSON.stringify(m.version)}`);

  const isPositiveInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
  for (const key of ['width', 'height', 'tileWidth', 'tileHeight']) {
    if (!isPositiveInt(m[key])) errors.push(`${key} должен быть целым больше нуля, а не ${JSON.stringify(m[key])}`);
  }
  if (errors.length) return errors;

  const width = m.width as number;
  const height = m.height as number;

  if (width * height > MAX_CELLS) {
    errors.push(`${width}x${height} — это ${width * height} клеток, больше предела ${MAX_CELLS}`);
  }

  if (!Array.isArray(m.tilesets) || m.tilesets.length === 0) {
    errors.push('нет тайлсетов');
    return errors;
  }

  // Диапазоны глобальных номеров: по ним проверяем каждый тайл.
  const ranges = (m.tilesets as Record<string, number>[]).map((ts) => ({
    from: ts.firstId,
    to: ts.firstId + ts.tileCount - 1,
  }));

  if (!Array.isArray(m.layers) || m.layers.length === 0) {
    errors.push('нет слоёв');
    return errors;
  }

  const names = new Set<string>();
  for (const layer of m.layers as Record<string, unknown>[]) {
    const name = layer.name;
    if (typeof name !== 'string' || !name) {
      errors.push('у слоя пустое имя');
      continue;
    }
    if (names.has(name)) errors.push(`слой ${name} повторяется`);
    names.add(name);

    if (!Array.isArray(layer.data)) {
      errors.push(`слой ${name}: data не массив`);
      continue;
    }
    // Главный инвариант формата: слой ровно по размеру карты.
    if (layer.data.length !== width * height) {
      errors.push(`слой ${name}: ${layer.data.length} клеток вместо ${width * height} (${width}x${height})`);
      continue;
    }

    for (let i = 0; i < layer.data.length; i++) {
      const raw = layer.data[i];
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
        errors.push(`слой ${name}, клетка ${i}: ${JSON.stringify(raw)} — не целое неотрицательное`);
        break;
      }
      // Флаги отражения снимаем ДО проверки диапазона: с ними номера доходят
      // до 3221233965, и без маски каждый повёрнутый тайл дал бы ошибку.
      const gid = raw & GID_MASK;
      if (gid === 0) continue;
      if (!ranges.some((r) => gid >= r.from && gid <= r.to)) {
        errors.push(`слой ${name}, клетка ${i}: номер тайла ${gid} не принадлежит ни одному тайлсету`);
        break;
      }
    }
  }

  return errors;
}
