/** Размеры панели помним между заходами: настраивать их заново каждый раз — мучение. */
const SIZES_KEY = 'editor-sizes';

const MIN_PANEL = 220;
const MIN_SECTION = 80;

const CSS = `
  /* minmax(0, 1fr), а не 1fr: иначе колонка не сожмётся меньше канваса,
     который держит свою ширину атрибутом, и панель уедет за край экрана.
     Ширину панели держит переменная — её двигает тяга на левом крае. */
  body.editing { display: grid; grid-template-columns: minmax(0, 1fr) var(--panel-w, 300px); }
  body.editing #game { width: 100%; height: 100vh; min-width: 0; }

  #editor {
    position: relative;
    height: 100vh; overflow: hidden; display: flex; flex-direction: column;
    background: #20272b; color: #cfd8dc; border-left: 1px solid #0d1114;
    font: 12px/1.45 system-ui, sans-serif; user-select: none;
  }

  /* Тяга ширины: узкая полоса по левому краю панели. Вынесена за край на 3px,
     чтобы попасть в неё было легко — целиться в 1px границы невозможно. */
  #ed-grip-w {
    position: absolute; left: -3px; top: 0; bottom: 0; width: 7px;
    cursor: col-resize; z-index: 5;
  }
  #ed-grip-w:hover, #ed-grip-w.dragging { background: #63a35455; }

  /* Тяга высоты: полоса между слоями и тайлами. */
  #ed-grip-h {
    height: 7px; margin: -3px 0; cursor: row-resize; z-index: 5; position: relative;
  }
  #ed-grip-h:hover, #ed-grip-h.dragging { background: #63a35455; }

  /* Пока тянем — курсор не должен прыгать на текст под мышью. */
  body.ed-resizing { cursor: col-resize; }
  body.ed-resizing.rows { cursor: row-resize; }
  body.ed-resizing * { pointer-events: none; }
  #editor h2 {
    margin: 0; padding: 7px 10px; font-size: 11px; font-weight: 600;
    letter-spacing: .06em; text-transform: uppercase; color: #7d8f99;
    background: #1a2024; border-bottom: 1px solid #0d1114;
  }
  #editor h2.action { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  #editor h2 .head-btn { text-transform: none; letter-spacing: 0; padding: 1px 8px; font-size: 13px; line-height: 16px; }
  #editor h2 .head-btn:hover { color: #fff; }
  #editor button {
    font: inherit; color: inherit; background: #2f383e; border: 1px solid #0d1114;
    border-radius: 3px; padding: 3px 8px; cursor: pointer;
  }
  #editor button:hover { background: #3a464d; }
  #editor button[aria-pressed="true"] { background: #4a7a3f; border-color: #63a354; }
  #editor button:disabled { opacity: .4; cursor: default; }

  #ed-tools { display: flex; gap: 4px; padding: 8px; flex-wrap: wrap; border-bottom: 1px solid #0d1114; }

  /* Высоту слоёв держит переменная — её двигает тяга между секциями.
     Тайлы забирают остаток: flex: 1 ниже. */
  #ed-layers { overflow-y: auto; height: var(--layers-h, 34vh); flex: none; border-bottom: 1px solid #0d1114; }
  .ed-layer {
    display: flex; align-items: center; gap: 6px; padding: 2px 8px; cursor: pointer;
  }
  .ed-layer:hover { background: #2a3237; }
  .ed-layer[aria-selected="true"] { background: #33505e; }
  .ed-layer .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ed-layer .ct { color: #6b7c85; font-variant-numeric: tabular-nums; }
  .ed-layer .eye { width: 18px; text-align: center; opacity: .75; }
  .ed-layer .eye:hover { opacity: 1; }
  .ed-layer.hidden .nm { opacity: .4; text-decoration: line-through; }
  /* Карандаш и корзина проявляются по наведению на строку: постоянные иконки на 26 слоёв — визуальный шум. */
  .ed-layer .edit, .ed-layer .del { width: 16px; text-align: center; opacity: 0; cursor: pointer; }
  .ed-layer:hover .edit, .ed-layer:hover .del { opacity: .5; }
  .ed-layer .edit:hover, .ed-layer .del:hover { opacity: 1; }
  .ed-layer input.rn {
    flex: 1; min-width: 0; font: inherit; color: #fff; background: #12171a;
    border: 1px solid #63a354; border-radius: 2px; padding: 0 3px; outline: none;
  }
  .ed-layer input.rn.bad { border-color: #e2705f; }
  .ed-layer { cursor: grab; }
  .ed-layer.dragging { opacity: .5; cursor: grabbing; }
  /* Куда встанет слой при отпускании: зелёная черта сверху или снизу строки. */
  .ed-layer.drop-above { box-shadow: inset 0 2px 0 #63a354; }
  .ed-layer.drop-below { box-shadow: inset 0 -2px 0 #63a354; }

  #ed-palette { flex: 1; overflow-y: auto; }
  .ed-ts-head {
    display: flex; justify-content: space-between; padding: 4px 8px; cursor: pointer;
    background: #262e33; border-top: 1px solid #0d1114; color: #9fb0ba;
  }
  .ed-ts-head:hover { color: #fff; }
  .ed-ts-body { padding: 4px; background: #14181b; overflow: auto; max-height: 260px; }
  .ed-ts-body img { image-rendering: pixelated; display: block; cursor: crosshair; }
  .ed-ts-wrap { position: relative; display: inline-block; }
  .ed-sel {
    position: absolute; border: 1px solid #7cf; background: rgba(120,200,255,.25);
    pointer-events: none;
  }

  #ed-status {
    padding: 5px 8px; background: #1a2024; border-top: 1px solid #0d1114;
    display: flex; justify-content: space-between; gap: 8px;
    font-variant-numeric: tabular-nums; color: #8a9aa4;
  }
  #ed-status .save-ok { color: #7fc26f; }
  #ed-status .save-dirty { color: #d8b45a; }
  #ed-status .save-err { color: #e2705f; font-weight: 600; }
`;

export interface Shell {
  tools: HTMLDivElement;
  layers: HTMLDivElement;
  addLayer: HTMLButtonElement;
  palette: HTMLDivElement;
  setStatus(left: string, right: string, cls?: string): void;
}

/**
 * Тяги: левый край панели двигает её ширину, полоса между слоями и тайлами —
 * их высоты. Размеры запоминаются.
 *
 * Игру это не задевает: канвас в соседней колонке грида, он подстроится сам.
 * А вот камере сцены надо сказать — Phaser следит за окном, а не за разметкой,
 * и смены ширины колонки не замечает. Этим занимается mount.
 */
function setupResizers(root: HTMLDivElement): void {
  const sizes = loadSizes();
  const apply = (): void => {
    document.body.style.setProperty('--panel-w', `${sizes.panelW}px`);
    document.body.style.setProperty('--layers-h', `${sizes.layersH}px`);
  };
  apply();

  const gripW = root.querySelector<HTMLDivElement>('#ed-grip-w')!;
  const gripH = root.querySelector<HTMLDivElement>('#ed-grip-h')!;

  const drag = (
    grip: HTMLDivElement,
    rows: boolean,
    onMove: (e: PointerEvent) => void,
  ): void => {
    grip.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      // Захват указателя: иначе, стоит увести мышь за пределы тяги, она «отцепится».
      grip.setPointerCapture(e.pointerId);
      grip.classList.add('dragging');
      document.body.classList.add('ed-resizing');
      if (rows) document.body.classList.add('rows');

      const move = (ev: PointerEvent): void => {
        onMove(ev);
        apply();
        // Канвас поменял размер — сообщаем игре, иначе карта останется в старых границах.
        window.dispatchEvent(new Event('resize'));
      };
      const up = (): void => {
        grip.classList.remove('dragging');
        document.body.classList.remove('ed-resizing', 'rows');
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        saveSizes(sizes);
      };

      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });
  };

  drag(gripW, false, (e) => {
    // Панель прижата к правому краю окна, поэтому ширина — это расстояние от курсора до края.
    const width = window.innerWidth - e.clientX;
    // Не даём ужать панель в ноль и не даём съесть весь экран под неё.
    sizes.panelW = Math.max(MIN_PANEL, Math.min(width, window.innerWidth - 200));
  });

  drag(gripH, true, (e) => {
    const top = root.querySelector<HTMLDivElement>('#ed-layers')!.getBoundingClientRect().top;
    const height = e.clientY - top;
    // Тайлам тоже надо оставить место, иначе палитра схлопнется в щель.
    sizes.layersH = Math.max(MIN_SECTION, Math.min(height, window.innerHeight - 260));
  });
}

interface Sizes {
  panelW: number;
  layersH: number;
}

function loadSizes(): Sizes {
  const fallback = { panelW: 300, layersH: Math.round(window.innerHeight * 0.34) };
  try {
    const saved = JSON.parse(localStorage.getItem(SIZES_KEY) ?? 'null');
    if (!saved) return fallback;
    return { panelW: saved.panelW ?? fallback.panelW, layersH: saved.layersH ?? fallback.layersH };
  } catch {
    // Испорченная запись не должна мешать открыть редактор.
    return fallback;
  }
}

function saveSizes(sizes: Sizes): void {
  try {
    localStorage.setItem(SIZES_KEY, JSON.stringify(sizes));
  } catch {
    // Приватный режим или переполненное хранилище — размеры просто не запомнятся.
  }
}

export function buildShell(): Shell {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  document.body.classList.add('editing');

  const root = document.createElement('div');
  root.id = 'editor';
  root.innerHTML = `
    <div id="ed-grip-w" title="Потяните, чтобы сделать панель шире или уже"></div>
    <div id="ed-tools"></div>
    <h2 class="action">Слои <button id="ed-add-layer" class="head-btn" title="Новый слой поверх активного">＋</button></h2>
    <div id="ed-layers"></div>
    <div id="ed-grip-h" title="Потяните, чтобы поделить высоту между слоями и тайлами"></div>
    <h2>Тайлы</h2>
    <div id="ed-palette"></div>
    <div id="ed-status"><span id="ed-status-left"></span><span id="ed-status-right"></span></div>
  `;
  document.body.append(root);

  setupResizers(root);

  const left = root.querySelector<HTMLSpanElement>('#ed-status-left')!;
  const right = root.querySelector<HTMLSpanElement>('#ed-status-right')!;

  return {
    tools: root.querySelector<HTMLDivElement>('#ed-tools')!,
    layers: root.querySelector<HTMLDivElement>('#ed-layers')!,
    addLayer: root.querySelector<HTMLButtonElement>('#ed-add-layer')!,
    palette: root.querySelector<HTMLDivElement>('#ed-palette')!,
    setStatus(l, r, cls = '') {
      left.textContent = l;
      right.textContent = r;
      right.className = cls;
    },
  };
}
