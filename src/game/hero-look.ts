/**
 * Внешность чужого героя: набор листов под ЕГО экипировку.
 *
 * Разрешение экипировки в текстуры повторяет applyGear из GameScene: сперва
 * нарисованный спрайт брони (assets/worn, правится в ?helm), без него — фолбэк
 * перекраски по палитре предмета; маска волос и покадровые поправки — те же.
 * Поэтому чужой герой в Gilded Helm выглядит ровно как ты сам в Gilded Helm.
 *
 * Наборы кэшируются по префиксу `rp-<helm>-<body>`: три игрока в одинаковой
 * броне делят один набор текстур, а смена шлема строит новый набор один раз.
 */

import Phaser from 'phaser';
import { Player, type ArmorTint, type FrameOffsets } from './player';
import { ITEMS } from './items';

/** Только известные предметы в ключ: чужой клиент мог прислать мусор. */
const safe = (id: string | null): string | null => (id && ITEMS[id] ? id : null);

/**
 * Собрать (или взять из кэша) набор листов под экипировку. Возвращает префикс
 * анимаций: `<prefix>-walk-down` и родня уже существуют после вызова.
 */
export function ensureHeroLook(scene: Phaser.Scene, helmRaw: string | null, bodyRaw: string | null): string {
  const helm = safe(helmRaw);
  const body = safe(bodyRaw);
  const prefix = `rp-${helm ?? 'none'}-${body ?? 'none'}`;
  if (scene.anims.exists(`${prefix}-idle-down`)) return prefix;

  // То же разрешение, что в applyGear: спрайт брони сильнее фолбэка-перекраски.
  const tintOf = (id: string | null): ArmorTint | null => (id && ITEMS[id]?.tint) || null;
  const wornTex = (id: string | null): string | null =>
    id && scene.textures.exists(`worn-${id}`) ? `worn-${id}` : null;
  const maskTex = (id: string | null): string | null =>
    id && scene.textures.exists(`worn-mask-${id}`) ? `worn-mask-${id}` : null;
  const offsetsOf = (id: string | null): FrameOffsets | undefined =>
    (id && (scene.cache.json.get(`worn-offset-${id}`) as FrameOffsets | undefined)) || undefined;

  Player.buildGearSet(
    scene,
    prefix,
    tintOf(body),
    tintOf(helm),
    wornTex(helm),
    wornTex(body),
    maskTex(helm),
    offsetsOf(helm),
    offsetsOf(body),
  );
  return prefix;
}
