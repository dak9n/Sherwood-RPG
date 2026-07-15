import Phaser from 'phaser';
import type { CellEdit, EditorState } from './state';

export type Tool = 'brush' | 'eraser';

export interface ToolHandlers {
  onPick?: () => void;
  onHover?: (x: number, y: number) => void;
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

  const pick = (x: number, y: number): void => {
    // Пипетка берёт значение целиком, вместе с флагами поворота, и переключает
    // слой: при 26 слоях вида lianas3/lianas4 угадывать, куда попал тайл, невозможно.
    const layer = state.doc.topLayerAt(x, y);
    if (layer === -1) return;

    const raw = state.doc.getRaw(layer, x, y);
    state.setActiveLayer(layer);
    state.setBrush({ w: 1, h: 1, raws: [raw] });
    handlers.onPick?.();
  };

  scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
    const { x, y } = cellUnder(p);
    if (!state.doc.inBounds(x, y)) return;

    if (p.event instanceof MouseEvent && p.event.shiftKey && p.leftButtonDown()) {
      pick(x, y);
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

    if (!stroke) return;
    const key = `${x},${y}`;
    if (key === lastCell) return; // не перерисовываем одну клетку 60 раз в секунду
    lastCell = key;

    if (!state.doc.inBounds(x, y)) return;
    const edits = stamp(x, y, p.rightButtonDown() || getTool() === 'eraser');
    stroke.push(...edits);
    state.apply(edits, { record: false });
  });

  const endStroke = (): void => {
    if (!stroke) return;
    // Штрих кладётся в историю целиком: Ctrl+Z должен отменять мазок, а не клетку.
    const batch = stroke.filter((e) => e.before !== e.after);
    stroke = null;
    if (batch.length) state.pushHistory(batch);
  };

  scene.input.on('pointerup', endStroke);
  scene.input.on('pointerupoutside', endStroke);
}
