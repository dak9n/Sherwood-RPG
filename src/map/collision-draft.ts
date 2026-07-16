import type { MapDoc } from './doc';
// С расширением: этот модуль выполняют и браузер, и тесты, а node без него
// файл не найдёт.
import { landCells, largestArea } from '../game/spawn.ts';

const UNSET = 0;
const WALK = 1;
const BLOCK = 2;

/**
 * Сколько нижних рядов дерева считать стволом.
 *
 * Всё дерево стеной делать нельзя: крона висит в воздухе на 4-12 тайлов вверх,
 * и под ней надо ходить. Упираться должен ствол — а он внизу.
 */
const TRUNK_ROWS = 2;

export interface DraftResult {
  collision: number[];
  walkable: number;
  blocked: number;
}

/**
 * Считает проходимость по самой карте.
 *
 * Правило земли и воды — то же, что у расселения монстров (map/../game/spawn):
 * важно не «есть ли водяной тайл», а что лежит СВЕРХУ. Вода залита фоном под
 * всей картой, земля прорезает в ней водоёмы, а тайлсет с именем Water_coasts
 * вопреки имени содержит землю.
 *
 * @param trees клетки больших деревьев -> низ дерева в пикселях (findTallObjects)
 * @param tileH высота тайла, чтобы понять, где у дерева ствол
 */
export function draftCollision(doc: MapDoc, trees: Map<number, number>, tileH: number): DraftResult {
  const size = doc.width * doc.height;
  const collision = new Array<number>(size).fill(BLOCK);

  // Только самый большой кусок суши: на островке за водой игроку делать нечего,
  // а попасть туда он всё равно не сможет.
  const land = largestArea(landCells(doc), doc.width);
  for (const i of land) collision[i] = WALK;

  // Стволы. Крону оставляем проходимой — под деревом ходят.
  for (const [i, baseY] of trees) {
    const y = Math.floor(i / doc.width);
    const trunkTop = Math.floor(baseY / tileH) - TRUNK_ROWS;
    if (y >= trunkTop) collision[i] = BLOCK;
  }

  let walkable = 0;
  for (const v of collision) if (v === WALK) walkable++;

  return { collision, walkable, blocked: size - walkable };
}

/**
 * Сводит ручную разметку с черновиком.
 *
 * UNSET значит «не задано — спроси у черновика», а WALK/BLOCK — слово человека,
 * и оно сильнее. Ровно так это и описано в types.ts, но игра раньше понимала
 * разметку иначе: брала черновик, ТОЛЬКО если весь массив в нулях. Из-за этого
 * одна нарисованная стена отменяла черновик целиком, остальные клетки оставались
 * UNSET, а UNSET для canWalk — стена. Обвёл речку — и вся карта непроходима:
 * на forest это 0 проходимых клеток из 6300, игрок не мог сдвинуться.
 *
 * Теперь черновик считается всегда и служит основой, поверх которой ложится
 * ручная правка. За этим следит тест.
 */
export function mergeCollision(manual: readonly number[], draft: readonly number[]): number[] {
  // Длина расходится — доверять нечему: ручная разметка от другой карты хуже,
  // чем её отсутствие. ensureCollision такой массив всё равно пересоздаст.
  if (manual.length !== draft.length) return [...draft];

  return draft.map((d, i) => (manual[i] === UNSET ? d : manual[i]));
}
