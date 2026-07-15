import Phaser from 'phaser';

/**
 * Ищет в ряду спрайт-листа кадры, где что-то нарисовано.
 *
 * Нужно, потому что художник заполняет сетку не до конца: у мечника в анимации
 * покоя ряд «вверх» — 4 кадра, а остальные три ряда по 12, и хвост ряда пустой.
 * Анимация, построенная по размеру сетки, две трети времени показывала пустоту —
 * персонаж, стоящий спиной, попросту исчезал.
 *
 * Считаем по картинке, а не по таблице: таблица врёт молча, стоит художнику
 * перерисовать лист или добавить кадр.
 */

/** Пустые кадры листа. Считаем один раз на текстуру: перебор пикселей не бесплатный. */
const emptyByTexture = new Map<string, Set<number>>();

function emptyFrames(scene: Phaser.Scene, key: string, frameSize: number): Set<number> {
  const cached = emptyByTexture.get(key);
  if (cached) return cached;

  const empty = new Set<number>();
  emptyByTexture.set(key, empty);

  const source = scene.textures.get(key).getSourceImage();
  const width = source.width;
  const height = source.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return empty;

  ctx.drawImage(source as CanvasImageSource, 0, 0);

  const cols = Math.floor(width / frameSize);
  const rows = Math.floor(height / frameSize);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const { data } = ctx.getImageData(col * frameSize, row * frameSize, frameSize, frameSize);
      let visible = false;
      // Смотрим только альфу — каждый четвёртый байт.
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 0) {
          visible = true;
          break;
        }
      }
      if (!visible) empty.add(row * cols + col);
    }
  }

  return empty;
}

/**
 * Номера кадров ряда, в которых что-то нарисовано.
 *
 * @param row ряд листа (у нас это направление взгляда)
 * @param cols сколько кадров в ряду по сетке
 * @returns номера кадров для Phaser; если пустых нет — весь ряд
 */
export function usedFrames(scene: Phaser.Scene, key: string, row: number, cols: number, frameSize = 64): number[] {
  const empty = emptyFrames(scene, key, frameSize);
  const frames: number[] = [];

  for (let col = 0; col < cols; col++) {
    const index = row * cols + col;
    if (!empty.has(index)) frames.push(index);
  }

  // Пустой ряд — это уже сломанный ассет; лучше показать первый кадр, чем ничего.
  return frames.length ? frames : [row * cols];
}
