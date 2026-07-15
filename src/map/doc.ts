import type { GameMap, Pass } from './types';

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
