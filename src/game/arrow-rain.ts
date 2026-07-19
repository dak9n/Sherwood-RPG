import Phaser from 'phaser';

/**
 * Град стрел — активное умение героя (слот 2 хотбара, клавиша «2»).
 *
 * Не летит по прямой, как стрела/шар: игрок сначала ЦЕЛИТСЯ — у курсора появляется
 * круг (в пределах дальности от героя), кликом выбирает точку, и туда с неба волнами
 * сыплются стрелы, нанося урон всем монстрам в круге. Прицел, залп и волны урона
 * ведёт сцена (GameScene.castArrowRain и updateRains) — здесь только константы и
 * текстура падающей стрелы. Урон — в combat.ts (arrowRainDamage), чтобы формулу
 * проверяли тесты без Phaser.
 */

export const RAIN_TEX = 'rain-arrow';

/** Максимум, как далеко от героя можно поставить точку залпа, пикселей. */
export const RAIN_RANGE = 210;
/** Радиус поражения круга, пикселей. */
export const RAIN_RADIUS = 46;
/** Стоимость маны за залп. Дороже шара — это AoE. */
export const RAIN_MP_COST = 18;
/** Перезарядка, мс: сильное умение по площади не спамится. */
export const RAIN_COOLDOWN = 6000;
/** Сколько сыплется, мс. */
export const RAIN_DURATION = 1000;
/** Число волн урона за залп: монстр под градом получает урон RAIN_TICKS раз. */
export const RAIN_TICKS = 4;
/** Сколько визуальных стрел рисуем за залп. */
export const RAIN_ARROWS = 18;

/** Текстура падающей стрелы (смотрит вниз, +Y) — рисуем один раз кодом, как у стрелы. */
export function ensureRainArrowTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(RAIN_TEX)) return;
  const w = 6;
  const h = 18;
  const g = scene.add.graphics();
  g.fillStyle(0x5a3d22); // древко
  g.fillRect(w / 2 - 1, 2, 2, 11);
  g.fillStyle(0xd8d2c4); // наконечник смотрит вниз
  g.fillTriangle(0, 12, w, 12, w / 2, h);
  g.fillStyle(0x9a6b3a); // оперение у хвоста (сверху)
  g.fillTriangle(0, 0, w, 0, w / 2, 4);
  g.generateTexture(RAIN_TEX, w, h);
  g.destroy();
}
