import { unpackGid, tileTransform } from '../map/gid';
import { drawnBounds } from '../map/doc';
import type { GameMap } from '../map/types';

/**
 * Печать карты в картинку для мини-карты и полной карты.
 *
 * Карта печётся ОДИН раз при старте, а не рисуется каждый кадр. В лесу 27 слоёв
 * и 6139 тайлов; перерисовывать их 60 раз в секунду ради кружка в углу — верный
 * способ уронить частоту кадров. Карта в игре не меняется, перепечатывать нечего.
 *
 * Анимации (вода, свечи) на отпечатке застынут на первом кадре. Это осознанно:
 * на мини-карте тайл занимает пару пикселей, и рябь воды там не читается.
 *
 * Живёт отдельно от minimap.ts: здесь canvas браузера, а там формулы, которые
 * проверяются тестами без него.
 */

/** Где взять картинку тайлсета. Имя — как в каталоге; в Phaser это же ключ текстуры. */
export type ImageFor = (tilesetName: string) => CanvasImageSource | null;

export interface Baked {
  canvas: HTMLCanvasElement;
  /** Размер отпечатка в пикселях. */
  width: number;
  height: number;
  /**
   * Мировая точка, которой отвечает левый верхний угол отпечатка.
   *
   * Печатаем только нарисованное, а холст карты больше: у леса 90x70 клеток, а
   * занято меньше трети. Без обрезки полная карта была бы кусочком леса посреди
   * пустого поля. Кто ставит точки на карту, обязан вычесть этот сдвиг.
   */
  originX: number;
  originY: number;
}

/**
 * Печатает нарисованную часть карты один в один с игрой: тот же порядок слоёв,
 * те же отражения.
 *
 * Скрытые слои (visible: false) пропускаем — их не видно и в игре.
 */
export function bakeMap(map: GameMap, imageFor: ImageFor): Baked {
  const TW = map.tileWidth;
  const TH = map.tileHeight;

  // Пустая карта — отпечаток в один пиксель: рисовать нечего, а падать не за что.
  const b = drawnBounds(map) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const originX = b.minX * TW;
  const originY = b.minY * TH;

  const canvas = document.createElement('canvas');
  canvas.width = (b.maxX - b.minX + 1) * TW;
  canvas.height = (b.maxY - b.minY + 1) * TH;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('мини-карта: браузер не дал 2d-контекст');
  // Тайлы пиксельные: сглаживание превратило бы отпечаток в мыло.
  ctx.imageSmoothingEnabled = false;

  // Картинку берём по одной на тайлсет, а не искать на каждый тайл: их тысячи.
  const images = new Map<string, CanvasImageSource | null>();
  for (const ts of map.tilesets) images.set(ts.name, imageFor(ts.name));

  for (const layer of map.layers) {
    if (layer.visible === false) continue;

    for (let i = 0; i < layer.data.length; i++) {
      const raw = layer.data[i];
      if (!raw) continue;

      const { gid, flips } = unpackGid(raw);
      const ts = map.tilesets.find((t) => gid >= t.firstId && gid < t.firstId + t.tileCount);
      if (!ts) continue; // номер не из нашего каталога — пропускаем, а не падаем

      const img = images.get(ts.name);
      if (!img) continue;

      const local = gid - ts.firstId;
      const sx = (local % ts.columns) * TW;
      const sy = Math.floor(local / ts.columns) * TH;
      const dx = (i % map.width) * TW - originX;
      const dy = Math.floor(i / map.width) * TH - originY;

      if (!flips.h && !flips.v && !flips.d) {
        // Обычный тайл — без возни с матрицей: таких в лесу 96%.
        ctx.drawImage(img, sx, sy, TW, TH, dx, dy, TW, TH);
        continue;
      }

      // Поворот и отражение — ровно как их трактует Phaser, которым карта
      // рисуется в игре. Иначе отпечаток разошёлся бы с тем, что под ногами.
      const { rotation, flipX } = tileTransform(flips);
      ctx.save();
      ctx.translate(dx + TW / 2, dy + TH / 2);
      ctx.rotate(rotation);
      if (flipX) ctx.scale(-1, 1);
      ctx.drawImage(img, sx, sy, TW, TH, -TW / 2, -TH / 2, TW, TH);
      ctx.restore();
    }
  }

  return { canvas, width: canvas.width, height: canvas.height, originX, originY };
}
