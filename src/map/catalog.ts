import type { GameMap, Tileset } from './types';

/**
 * Общий каталог тайлсетов: один список на все карты.
 *
 * Раньше каждая карта носила свой список внутри себя. Это работало, пока карта
 * была одна, но с несколькими появились две беды: новый тайлсет приходилось
 * добавлять в каждую карту руками, а если добавить их в РАЗНОМ порядке, номера
 * тайлов разъедутся — и один и тот же номер станет значить разное в разных
 * картах. Скопировать кусок из карты в карту стало бы нельзя.
 */
export interface TilesetCatalog {
  version: 1;
  tilesets: Tileset[];
}

export const CATALOG_URL = 'assets/tilesets.json';

/**
 * Подставляет каталог в карту.
 *
 * Карта на диске тайлсетов не содержит, но в памяти они ей нужны: по ним
 * рисуются тайлы, работает палитра, ищутся деревья и вода. Поэтому после
 * загрузки карта выглядит ровно так же, как раньше, — весь остальной код about
 * это не знает.
 *
 * Старые карты (со своим списком внутри) продолжают работать: свой список
 * важнее каталога, иначе их номера тайлов поехали бы.
 */
export function applyCatalog(map: GameMap, catalog: TilesetCatalog): GameMap {
  if (Array.isArray(map.tilesets) && map.tilesets.length > 0) return map;
  map.tilesets = catalog.tilesets;
  return map;
}

/**
 * Номер, с которого начнётся следующий тайлсет.
 *
 * Нумерация продолжается за последним: дыры и пересечения сдвинули бы номера
 * уже нарисованных тайлов.
 */
export function nextFirstId(catalog: TilesetCatalog): number {
  return catalog.tilesets.reduce((max, t) => Math.max(max, t.firstId + t.tileCount), 1);
}

/** Что не так с каталогом. Пусто — всё в порядке. */
export function validateCatalog(catalog: unknown): string[] {
  const errors: string[] = [];
  const c = catalog as TilesetCatalog;

  if (!c || typeof c !== 'object') return ['catalog is not an object'];
  if (c.version !== 1) errors.push(`catalog version must be 1, not ${JSON.stringify(c.version)}`);
  if (!Array.isArray(c.tilesets) || c.tilesets.length === 0) {
    errors.push('catalog has no tilesets');
    return errors;
  }

  const names = new Set<string>();
  let expected = 1;

  for (const ts of c.tilesets) {
    if (names.has(ts.name)) errors.push(`tileset ${ts.name} is duplicated`);
    names.add(ts.name);

    if (!(ts.tileCount > 0)) errors.push(`${ts.name}: no tiles`);
    if (ts.columns <= 0) errors.push(`${ts.name}: grid without columns`);

    // Главный инвариант: номера идут подряд, без дыр и нахлёстов. Иначе номер
    // тайла на карте начнёт указывать в чужой тайлсет.
    if (ts.firstId !== expected) {
      errors.push(`${ts.name}: id ${ts.firstId}, but in order it must be ${expected}`);
    }
    expected = ts.firstId + ts.tileCount;
  }

  return errors;
}
