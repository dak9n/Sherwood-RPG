// С расширением: модуль выполняют и браузер, и тесты, а node без него не найдёт.
import type { MapDoc } from '../map/doc.ts';
import type { Pass } from '../map/types.ts';

/**
 * Одна изменённая клетка и то, что она делает с документом.
 *
 * Вынесено из state.ts, потому что тот тянет Phaser через applyCell и в тестах не
 * грузится. А проверять тут есть что: правки два вида, и перепутать их —
 * молчаливая порча карты.
 *
 * 'tile' — тайл в слое, before/after это значения формата (0 = пусто).
 * 'pass' — проходимость клетки, before/after это UNSET/WALK/BLOCK.
 *
 * Проходимость НЕЛЬЗЯ протащить как обычную правку: setRaw записал бы 1 или 2 в
 * слой, а это настоящие номера тайлов — в клетку молча нарисовалась бы вода.
 * Отсюда и разделение по kind.
 */
export type CellEdit =
  | { kind: 'tile'; layerIndex: number; x: number; y: number; before: number; after: number }
  | { kind: 'pass'; x: number; y: number; before: number; after: number };

/** Записать правку в документ. Экран обновляет тот, кто знает про Phaser. */
export function applyToDoc(doc: MapDoc, e: CellEdit): void {
  if (e.kind === 'pass') doc.setPass(e.x, e.y, e.after as Pass);
  else doc.setRaw(e.layerIndex, e.x, e.y, e.after);
}

/**
 * Развернуть правку для отмены. Про kind знать не надо — меняем before и after
 * местами, а применит уже applyToDoc.
 */
export const reverse = (e: CellEdit): CellEdit => ({ ...e, before: e.after, after: e.before });
