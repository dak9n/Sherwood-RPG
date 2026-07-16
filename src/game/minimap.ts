/**
 * Математика мини-карты: пересчёт мировых координат в экранные.
 *
 * Отдельным файлом от minimap-bake.ts намеренно: там код лезет в canvas
 * браузера, а эти формулы нужны и тестам без браузера. Тот же приём, что у
 * dir.ts рядом с anims.ts.
 */

/**
 * Куда попадёт мировая точка в окошке мини-карты, центрированном на игроке.
 *
 * Возвращает координаты внутри окошка размером size. Игрок всегда ровно в
 * середине — на этом держится вся мини-карта, и это проверяет тест.
 */
export function toMinimap(
  wx: number,
  wy: number,
  px: number,
  py: number,
  size: number,
  scale: number,
): { x: number; y: number } {
  return {
    x: size / 2 + (wx - px) * scale,
    y: size / 2 + (wy - py) * scale,
  };
}

/** Попадает ли точка в круглое окошко. За краем рисовать нельзя: там рама. */
export function insideCircle(x: number, y: number, size: number, pad = 0): boolean {
  const r = size / 2 - pad;
  const dx = x - size / 2;
  const dy = y - size / 2;
  return dx * dx + dy * dy <= r * r;
}

/**
 * Масштаб, при котором карта целиком влезает в окно. Берём меньшую сторону:
 * по большей карта вылезла бы за край.
 *
 * Никогда не возвращает ноль или минус. Это не перестраховка: окно с нулевым
 * размером бывает наяву (свёрнутая панель, вкладка в фоне), а минус в масштабе
 * — это отражённая задом наперёд карта и невалидная ширина в стилях.
 */
export function fitScale(mapW: number, mapH: number, boxW: number, boxH: number): number {
  if (mapW <= 0 || mapH <= 0 || boxW <= 0 || boxH <= 0) return 1;
  return Math.min(boxW / mapW, boxH / mapH);
}
