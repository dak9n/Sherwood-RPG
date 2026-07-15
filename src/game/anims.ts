import type Phaser from 'phaser';
import { usedFrames } from './sprite-frames';
import type { Dir } from './dir';

export interface AnimSpec {
  /** Ключ загруженного листа. */
  texture: string;
  /** Сколько кадров в ряду ПО СЕТКЕ. Сколько нарисовано — посчитается само. */
  cols: number;
  frameRate: number;
  /** Зацикливать? Атака и смерть — нет. */
  loop: boolean;
}

/**
 * Создаёт анимации на четыре стороны: `<prefix>-<name>-<dir>`.
 *
 * Кадры берутся через usedFrames, а не по размеру сетки: художник заполняет
 * ряды не до конца, и анимация по сетке показывала бы пустоту (на этом уже
 * обожглись — персонаж исчезал, стоя спиной).
 */
export function createDirAnims(
  scene: Phaser.Scene,
  prefix: string,
  dirs: Dir[],
  specs: Record<string, AnimSpec>,
): void {
  for (const [name, spec] of Object.entries(specs)) {
    for (const [row, dir] of dirs.entries()) {
      const key = `${prefix}-${name}-${dir}`;
      if (scene.anims.exists(key)) continue;

      const frames = usedFrames(scene, spec.texture, row, spec.cols);
      scene.anims.create({
        key,
        frames: frames.map((frame) => ({ key: spec.texture, frame })),
        frameRate: spec.frameRate,
        repeat: spec.loop ? -1 : 0,
      });
    }
  }
}
