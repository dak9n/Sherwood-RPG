/** Формат карты, который читает игра и пишет редактор. Генерируется tools/convert-map.mjs. */

export interface AnimationFrame {
  /** Номер тайла внутри тайлсета (не глобальный). */
  tileId: number;
  /** Длительность кадра в миллисекундах. */
  duration: number;
}

export interface Tileset {
  name: string;
  /** Имя файла картинки в public/assets/tilesets/. */
  image: string;
  imageWidth: number;
  imageHeight: number;
  columns: number;
  tileCount: number;
  /** Глобальный номер первого тайла этого тайлсета. */
  firstId: number;
  /** Ключ — номер тайла внутри тайлсета. */
  animations: Record<number, AnimationFrame[]>;
}

export interface Layer {
  name: string;
  visible: boolean;
  /**
   * Плоский массив width*height. 0 — пусто, иначе глобальный номер тайла.
   * В трёх старших битах — флаги отражения (см. FLIP_* в render/gid.ts).
   */
  data: number[];
}

export interface GameMap {
  version: 1;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  tilesets: Tileset[];
  layers: Layer[];
}
