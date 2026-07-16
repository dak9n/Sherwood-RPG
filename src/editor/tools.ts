import Phaser from 'phaser';
import { selectObject, extractRect, rectBetween, type Rect } from '../map/region';
import type { EditorState } from './state';
import type { CellEdit } from './edit';
import { WALK, BLOCK } from '../map/doc';

export type Tool = 'brush' | 'eraser' | 'select' | 'wall';

export type { Rect };

/** Размер кисти стен в клетках. Свой, а не state.brush — см. stampPass. */
let wallSize = 1;
export const setWallSize = (n: number): void => {
  wallSize = Math.max(1, Math.min(16, Math.round(n)));
};
export const getWallSize = (): number => wallSize;

export interface ToolHandlers {
  onPick?: (note?: string) => void;
  onHover?: (x: number, y: number) => void;
  /** Рамка выделения под Alt: показать её на карте или убрать (null). */
  onSelection?: (rect: Rect | null) => void;
}

/**
 * Кисть, ластик и пипетка на самой карте.
 *
 * Границы и содержимое клеток спрашиваем у документа, а не у Phaser: у стёртой
 * клетки Phaser держит index -1 и считает её «нет тайла», а нам нужно знать,
 * что там пусто именно по документу.
 */
export function installTools(
  scene: Phaser.Scene,
  state: EditorState,
  getTool: () => Tool,
  handlers: ToolHandlers = {},
): void {
  const tileW = state.doc.map.tileWidth;
  const tileH = state.doc.map.tileHeight;

  let stroke: CellEdit[] | null = null;
  let lastCell = '';
  /** Откуда начали тянуть рамку выделения. */
  let pickAnchor: { x: number; y: number } | null = null;

  const cellUnder = (p: Phaser.Input.Pointer) => {
    const world = scene.cameras.main.getWorldPoint(p.x, p.y);
    return { x: Math.floor(world.x / tileW), y: Math.floor(world.y / tileH) };
  };

  /** Клетки, которые кисть кладёт из точки (x, y). */
  const stamp = (x: number, y: number, erase: boolean): CellEdit[] => {
    const { w, h, raws } = state.brush;
    const edits: CellEdit[] = [];

    for (let dy = 0; dy < (erase ? 1 : h); dy++) {
      for (let dx = 0; dx < (erase ? 1 : w); dx++) {
        const cx = x + dx;
        const cy = y + dy;
        if (!state.doc.inBounds(cx, cy)) continue;

        const after = erase ? 0 : raws[dy * w + dx];
        if (!erase && !after) continue; // дырка в штампе — не затираем то, что под ней

        edits.push({
          kind: 'tile',
          layerIndex: state.activeLayer,
          x: cx,
          y: cy,
          before: state.doc.getRaw(state.activeLayer, cx, cy),
          after,
        });
      }
    }
    return edits;
  };

  /**
   * Кисть стен. Отдельно от stamp: тот прибит к активному слою и кладёт тайлы, а
   * проходимость — одна на всю карту и в слои не пишется.
   *
   * Размер свой, а не state.brush: его перетирают палитра и пипетка, и выбранное
   * дерево 5x5 расставляло бы стены штампом, да ещё с дырками на месте нулей.
   */
  const stampPass = (x: number, y: number, value: number): CellEdit[] => {
    const edits: CellEdit[] = [];
    for (let dy = 0; dy < wallSize; dy++) {
      for (let dx = 0; dx < wallSize; dx++) {
        const cx = x + dx;
        const cy = y + dy;
        if (!state.doc.inBounds(cx, cy)) continue;
        edits.push({ kind: 'pass', x: cx, y: cy, before: state.doc.getPass(cx, cy), after: value });
      }
    }
    return edits;
  };

  /**
   * Пипетка. Берёт значения дословно, вместе с флагами поворота, и переключает
   * слой: при 26 слоях вида lianas3/lianas4 угадывать, куда попал тайл, невозможно.
   *
   * Берём с верхнего ВИДИМОГО слоя: спрятал дерево «глазом», ткнул в траву под
   * ним — и должна взяться трава, а не невидимое дерево.
   *
   * whole=true (Alt) — берёт объект под курсором целиком, обходя связные тайлы.
   * whole=false (Shift) — ровно одну клетку.
   */
  const pick = (x: number, y: number, whole: boolean): void => {
    const layer = state.topVisibleLayerAt(x, y);
    if (layer === -1) return;
    state.setActiveLayer(layer);

    if (!whole) {
      state.setBrush({ w: 1, h: 1, raws: [state.doc.getRaw(layer, x, y)] });
      handlers.onPick?.();
      return;
    }

    const region = selectObject(state.doc, layer, x, y);
    if (!region) return;

    state.setBrush({ w: region.w, h: region.h, raws: region.raws });
    handlers.onPick?.(
      region.tooBig
        ? 'всё слилось — взят один тайл, обведите Alt+рамкой'
        : region.count > 1
          ? `объект ${region.w}×${region.h}`
          : undefined,
    );
  };

  const pickRect = (layer: number, r: Rect): boolean => {
    const { raws, count } = extractRect(state.doc, layer, r);
    if (!count) return false; // обвели пустоту — кисть-пустышка ничего не нарисует

    state.setActiveLayer(layer);
    state.setBrush({ w: r.w, h: r.h, raws });
    handlers.onPick?.(`область ${r.w}×${r.h}`);
    return true;
  };

  scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
    const { x, y } = cellUnder(p);
    if (!state.doc.inBounds(x, y)) return;

    // Стены рисуются раньше всех проверок, кроме панорамы: ни пипетка, ни
    // выделение, ни ластик тут не при чём — правится не слой, а проходимость.
    if (getTool() === 'wall') {
      if (p.leftButtonDown() && scene.input.keyboard?.checkDown(scene.input.keyboard.addKey('SPACE'), 0)) return;
      if (!p.leftButtonDown() && !p.rightButtonDown()) return;

      // ЛКМ — стена, ПКМ — проход. Не «стереть в UNSET»: игрок обводит речку и
      // хочет сказать «сюда нельзя», а соседнюю клетку — «сюда можно», и оба
      // слова должны быть сильнее черновика.
      stroke = [];
      lastCell = `${x},${y}`;
      const edits = stampPass(x, y, p.rightButtonDown() ? WALK : BLOCK);
      stroke.push(...edits);
      state.apply(edits, { record: false });
      return;
    }

    // Пипетка: Alt с любым инструментом либо режим «Выделить» без модификаторов.
    // Клик берёт объект целиком, протяжка — обведённую область; что именно из
    // двух, решаем на отпускании кнопки, когда уже видно, тянули мышь или нет.
    const selecting = p.event instanceof MouseEvent && (p.event.altKey || getTool() === 'select');
    if (selecting && p.leftButtonDown()) {
      pickAnchor = { x, y };
      handlers.onSelection?.({ x, y, w: 1, h: 1 });
      return;
    }
    if (p.event instanceof MouseEvent && p.leftButtonDown() && p.event.shiftKey) {
      pick(x, y, false);
      return;
    }
    // Пробел с левой кнопкой — это панорама камеры, не рисование.
    if (p.leftButtonDown() && scene.input.keyboard?.checkDown(scene.input.keyboard.addKey('SPACE'), 0)) return;

    const erase = p.rightButtonDown();
    if (!p.leftButtonDown() && !erase) return;

    stroke = [];
    lastCell = `${x},${y}`;
    const edits = stamp(x, y, erase);
    stroke.push(...edits);
    state.apply(edits, { record: false });
  });

  scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
    const { x, y } = cellUnder(p);
    handlers.onHover?.(x, y);

    // Тянем рамку выделения: показываем, что именно захватим.
    if (pickAnchor) {
      handlers.onSelection?.(rectBetween(pickAnchor, { x, y }));
      return;
    }

    if (!stroke) return;
    const key = `${x},${y}`;
    if (key === lastCell) return; // не перерисовываем одну клетку 60 раз в секунду
    lastCell = key;

    if (!state.doc.inBounds(x, y)) return;
    const edits =
      getTool() === 'wall'
        ? stampPass(x, y, p.rightButtonDown() ? WALK : BLOCK)
        : stamp(x, y, p.rightButtonDown() || getTool() === 'eraser');
    stroke.push(...edits);
    state.apply(edits, { record: false });
  });

  const endStroke = (p?: Phaser.Input.Pointer): void => {
    // Отпустили Alt-рамку: решаем здесь, потому что на нажатии ещё не было
    // известно, потянут мышь или это одиночный клик.
    if (pickAnchor) {
      const anchor = pickAnchor;
      pickAnchor = null;

      const end = p ? cellUnder(p) : anchor;
      const rect = rectBetween(anchor, state.doc.inBounds(end.x, end.y) ? end : anchor);

      if (rect.w === 1 && rect.h === 1) {
        // Клик без протяжки — берём объект целиком.
        pick(anchor.x, anchor.y, true);
        handlers.onSelection?.(null);
        return;
      }

      // Слой ищем по любой занятой клетке рамки, а не по её углу: угол часто
      // приходится на пустоту рядом с деревом, и по нему слой не определить.
      // Только по видимым слоям — обводить спрятанное «глазом» незачем.
      let layer = -1;
      for (let dy = 0; dy < rect.h && layer === -1; dy++) {
        for (let dx = 0; dx < rect.w && layer === -1; dx++) {
          layer = state.topVisibleLayerAt(rect.x + dx, rect.y + dy);
        }
      }

      if (layer === -1 || !pickRect(layer, rect)) {
        handlers.onSelection?.(null);
        return;
      }
      // Рамка остаётся на карте: видно, что выбрано, и можно обвести заново.
      handlers.onSelection?.(rect);
      return;
    }

    if (!stroke) return;
    // Штрих кладётся в историю целиком: Ctrl+Z должен отменять мазок, а не клетку.
    const batch = stroke.filter((e) => e.before !== e.after);
    stroke = null;
    if (batch.length) state.pushHistory(batch);
  };

  scene.input.on('pointerup', endStroke);
  scene.input.on('pointerupoutside', endStroke);

  /** Сбросить выделение и вернуться к кисти из одной клетки. */
  const clearSelection = (): void => {
    pickAnchor = null;
    handlers.onSelection?.(null);
  };

  scene.input.keyboard?.on('keydown-ESC', clearSelection);
}
