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

  if (!m || typeof m !== 'object') return ['map is not an object'];
  // Версия 2 добавила проходимость, версия 3 вынесла тайлсеты в общий каталог.
  // Отказ громкий и специально: код, который о них не знает, сохранил бы карту
  // без них и стёр бы работу молча.
  if (m.version !== 2 && m.version !== 3) {
    errors.push(`version must be 2 or 3, not ${JSON.stringify(m.version)}`);
  }

  const isPositiveInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
  for (const key of ['width', 'height', 'tileWidth', 'tileHeight']) {
    if (!isPositiveInt(m[key])) errors.push(`${key} must be an integer greater than zero, not ${JSON.stringify(m[key])}`);
  }
  if (errors.length) return errors;

  const width = m.width as number;
  const height = m.height as number;

  if (width * height > MAX_CELLS) {
    errors.push(`${width}x${height} is ${width * height} cells, over the limit of ${MAX_CELLS}`);
  }

  if (!Array.isArray(m.tilesets) || m.tilesets.length === 0) {
    errors.push('no tilesets');
    return errors;
  }

  // Диапазоны глобальных номеров: по ним проверяем каждый тайл.
  const ranges = (m.tilesets as Record<string, number>[]).map((ts) => ({
    from: ts.firstId,
    to: ts.firstId + ts.tileCount - 1,
  }));

  if (!Array.isArray(m.collision)) {
    errors.push('no collision');
  } else if (m.collision.length !== width * height) {
    errors.push(`collision: ${m.collision.length} cells instead of ${width * height} (${width}x${height})`);
  } else {
    const bad = (m.collision as unknown[]).findIndex((v) => v !== 0 && v !== 1 && v !== 2);
    if (bad !== -1) {
      errors.push(`collision, cell ${bad}: ${JSON.stringify(m.collision[bad])} — must be 0, 1 or 2`);
    }
  }

  if (!Array.isArray(m.layers) || m.layers.length === 0) {
    errors.push('no layers');
    return errors;
  }

  const names = new Set<string>();
  for (const layer of m.layers as Record<string, unknown>[]) {
    const name = layer.name;
    if (typeof name !== 'string' || !name) {
      errors.push('layer has an empty name');
      continue;
    }
    if (names.has(name)) errors.push(`layer ${name} is duplicated`);
    names.add(name);

    // Группа (папка панели слоёв) — поле опциональное, но раз есть, то непустая
    // строка: пустое имя группы не нарисовать в панели и не переименовать.
    if (layer.group !== undefined && (typeof layer.group !== 'string' || !layer.group)) {
      errors.push(`layer ${name}: group must be a non-empty string`);
    }

    if (!Array.isArray(layer.data)) {
      errors.push(`layer ${name}: data is not an array`);
      continue;
    }
    // Главный инвариант формата: слой ровно по размеру карты.
    if (layer.data.length !== width * height) {
      errors.push(`layer ${name}: ${layer.data.length} cells instead of ${width * height} (${width}x${height})`);
      continue;
    }

    for (let i = 0; i < layer.data.length; i++) {
      const raw = layer.data[i];
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
        errors.push(`layer ${name}, cell ${i}: ${JSON.stringify(raw)} — not a non-negative integer`);
        break;
      }
      // Флаги отражения снимаем ДО проверки диапазона: с ними номера доходят
      // до 3221233965, и без маски каждый повёрнутый тайл дал бы ошибку.
      const gid = raw & GID_MASK;
      if (gid === 0) continue;
      if (!ranges.some((r) => gid >= r.from && gid <= r.to)) {
        errors.push(`layer ${name}, cell ${i}: tile id ${gid} does not belong to any tileset`);
        break;
      }
    }
  }

  return errors;
}
