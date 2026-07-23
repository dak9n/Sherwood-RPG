import type { GameMap, MapSpawn, Pass } from './types';

/** Не задано — в игре это стена. */
export const UNSET = 0;
/** Можно идти. */
export const WALK = 1;
/** Стена: вода, дерево, обрыв. */
export const BLOCK = 2;

/**
 * Дополняет карту проходимостью, если её нет: старые карты (version 1) её не
 * знали. Всё в нулях — «не задано», то есть пока стена; размечать будет
 * черновик и рука.
 *
 * Файл на диске это не трогает: миграция живёт в памяти до первого сохранения.
 */
export function ensureCollision(map: GameMap): GameMap {
  if (!Array.isArray(map.collision) || map.collision.length !== map.width * map.height) {
    map.collision = new Array<number>(map.width * map.height).fill(UNSET);
  }
  // Поднимаем версию, но не понижаем: карта версии 3 (тайлсеты в общем каталоге)
  // не должна откатываться до 2 только потому, что через неё прошла эта миграция.
  if (!(map.version >= 2)) map.version = 2;
  return map;
}

/**
 * Документ карты — источник правды в редакторе.
 *
 * Phaser-тайлы им только рисуются, читать карту обратно из них нельзя:
 * MapScene каждый кадр переписывает Tile.index кадром анимации, и авторский
 * номер стоит в тайле лишь ~17% времени. Сохранение, собранное обходом тайлов,
 * запекло бы в файл случайные кадры воды.
 */
export class MapDoc {
  // Поле объявлено явно, а не через `constructor(readonly map)`: сокращённую
  // запись не понимает node --experimental-strip-types, на котором идут тесты.
  readonly map: GameMap;

  constructor(map: GameMap) {
    this.map = map;
  }

  get width(): number {
    return this.map.width;
  }

  get height(): number {
    return this.map.height;
  }

  get layers() {
    return this.map.layers;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.map.width && y < this.map.height;
  }

  index(x: number, y: number): number {
    return y * this.map.width + x;
  }

  getRaw(layerIndex: number, x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    return this.map.layers[layerIndex].data[this.index(x, y)] ?? 0;
  }

  setRaw(layerIndex: number, x: number, y: number, raw: number): void {
    if (!this.inBounds(x, y)) return;
    this.map.layers[layerIndex].data[this.index(x, y)] = raw;
  }

  /** Проходимость клетки. За границами — стена. */
  getPass(x: number, y: number): Pass {
    if (!this.inBounds(x, y)) return BLOCK;
    return (this.map.collision[this.index(x, y)] ?? UNSET) as Pass;
  }

  setPass(x: number, y: number, value: Pass): void {
    if (!this.inBounds(x, y)) return;
    this.map.collision[this.index(x, y)] = value;
  }

  /** Можно ли игроку в клетку. Всё, кроме явного «можно», — стена. */
  canWalk(x: number, y: number): boolean {
    return this.getPass(x, y) === WALK;
  }

  /** Все маркеры спавна. Пустой массив, если поля нет (старая карта). */
  get spawns(): MapSpawn[] {
    return this.map.spawns ?? [];
  }

  /** Маркер в клетке или null. В одной клетке маркер один. */
  markerAt(x: number, y: number): MapSpawn | null {
    return this.map.spawns?.find((s) => s.x === x && s.y === y) ?? null;
  }

  /**
   * Поставить/снять маркер в клетке. null — снять. В одной клетке всегда не
   * больше одного: сперва убираем то, что там было.
   *
   * БЕЗ скрытых эффектов на другие клетки — например правило «игрок один» тут не
   * трогаем. Иначе отмена одной правки не восстановила бы затёртый ею чужой
   * маркер. Единственность игрока обеспечивает инструмент, пакетом правок.
   */
  setMarker(x: number, y: number, spawn: MapSpawn | null): void {
    if (!this.inBounds(x, y)) return;
    const list = (this.map.spawns ??= []);
    const at = list.findIndex((s) => s.x === x && s.y === y);
    if (at !== -1) list.splice(at, 1);
    if (spawn) list.push({ kind: spawn.kind, x, y });
    if (list.length === 0) delete this.map.spawns; // пустого поля не держим
  }

  /** Верхний непустой слой в клетке — для пипетки. -1, если пусто везде. */
  topLayerAt(x: number, y: number): number {
    for (let i = this.map.layers.length - 1; i >= 0; i--) {
      if (this.getRaw(i, x, y)) return i;
    }
    return -1;
  }

  countFilled(layerIndex: number): number {
    let n = 0;
    for (const raw of this.map.layers[layerIndex].data) if (raw) n++;
    return n;
  }
}

/**
 * Прямоугольник в тайлах, за пределами которого на карте пусто.
 *
 * Холст карты почти всегда больше нарисованного: лес расширяли вправо и вниз,
 * и добрая половина клеток пуста. Кто показывает карту целиком — от старта
 * игрока до полной карты на M — должен знать, где она на самом деле.
 *
 * null, если не нарисовано вообще ничего: у пустоты нет ни центра, ни границ,
 * и возвращать нули значило бы врать.
 */
export function drawnBounds(map: GameMap): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const layer of map.layers) {
    for (let i = 0; i < layer.data.length; i++) {
      if (!layer.data[i]) continue;
      const x = i % map.width;
      const y = Math.floor(i / map.width);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}
