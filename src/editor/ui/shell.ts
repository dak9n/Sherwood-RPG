import { applySizes, dragSize, sizes, MIN_PANEL, MIN_SECTION } from './sizes';

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
  /* Слой в группе: отступ как у вложенности папок; спрятанная группа гасит слои. */
  .ed-layer.in-grp { padding-left: 24px; }
  .ed-layer.grp-off .nm { opacity: .35; }
  .ed-layer .grp { width: 16px; text-align: center; opacity: 0; cursor: pointer; }
  .ed-layer:hover .grp { opacity: .5; }
  .ed-layer .grp:hover { opacity: 1; }

  /* Заголовок группы — папка, как в Photoshop: темнее строк, жирнее, со стрелкой. */
  .ed-group {
    display: flex; align-items: center; gap: 6px; padding: 3px 8px 3px 4px; cursor: pointer;
    background: #20272c; border-top: 1px solid #0d1114; border-bottom: 1px solid #0d1114;
    font-weight: 600;
  }
  .ed-group:hover { background: #2a3237; }
  .ed-group .tri { width: 14px; text-align: center; opacity: .7; }
  .ed-group .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ed-group .ct { color: #6b7c85; font-variant-numeric: tabular-nums; }
  .ed-group .eye { width: 18px; text-align: center; opacity: .75; }
  .ed-group .eye:hover { opacity: 1; }
  .ed-group.off .nm { opacity: .4; }
  .ed-group .edit, .ed-group .del { width: 16px; text-align: center; opacity: 0; cursor: pointer; }
  .ed-group:hover .edit, .ed-group:hover .del { opacity: .5; }
  .ed-group .edit:hover, .ed-group .del:hover { opacity: 1; }
  /* Подсветка при перетаскивании над заголовком: низ — в папку, верх — над папкой (наружу). */
  .ed-group.drop-into { background: #33505e; box-shadow: inset 0 0 0 1px #57c767; }
  .ed-group.drop-above { box-shadow: inset 0 3px 0 #57c767; }
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
  /* Высоту превью держит переменная — её двигает тяга под ним. Раньше тут стоял
     жёсткий потолок 260px, и у высоких тайлсетов (у деревни 1152px) было видно
     меньше четверти картинки, без всякой возможности растянуть. */
  .ed-ts-body { padding: 4px; background: #14181b; overflow: auto; max-height: var(--tiles-h, 260px); }
  .ed-ts-body img { image-rendering: pixelated; display: block; cursor: crosshair; }

  /* Тяга высоты превью: полоса под открытым тайлсетом. Толще прочих и с
     насечкой — её ищут глазами, а не наводят наугад по курсору.

     sticky обязателен: превью высокое, и обычная полоса под ним уезжала бы под
     нижний край палитры — чем сильнее растянул, тем дальше. Прилипнув к низу,
     тяга остаётся под рукой всегда. */
  .ed-ts-grip {
    position: sticky; bottom: 0; z-index: 2;
    height: 9px; cursor: row-resize; background: #262e33;
    border-top: 1px solid #0d1114; border-bottom: 1px solid #0d1114;
    display: flex; align-items: center; justify-content: center;
  }
  /* Обязательно: display выше перебивает браузерное [hidden] { display: none },
     и полоски торчали под КАЖДЫМ закрытым тайлсетом — 39 штук поперёк списка. */
  .ed-ts-grip[hidden] { display: none; }
  .ed-ts-grip::before {
    content: ''; width: 28px; height: 3px; border-radius: 2px; background: #55656e;
  }
  .ed-ts-grip:hover { background: #2f3a41; }
  .ed-ts-grip:hover::before { background: #8fd47a; }
  .ed-ts-grip.dragging { background: #63a35455; }
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
 * Тяги каркаса: левый край панели двигает её ширину, полоса между слоями и
 * тайлами — их высоты. Третья тяга — высота превью тайлсета — живёт в палитре.
 *
 * Игру это не задевает: канвас в соседней колонке грида, он подстроится сам.
 * А вот камере сцены надо сказать — Phaser следит за окном, а не за разметкой,
 * и смены ширины колонки не замечает. Этим занимается mount.
 */
function setupResizers(root: HTMLDivElement): void {
  applySizes();

  const gripW = root.querySelector<HTMLDivElement>('#ed-grip-w')!;
  const gripH = root.querySelector<HTMLDivElement>('#ed-grip-h')!;

  dragSize(gripW, { notifyGame: true }, (e) => {
    // Панель прижата к правому краю окна, поэтому ширина — это расстояние от курсора до края.
    const width = window.innerWidth - e.clientX;
    // Не даём ужать панель в ноль и не даём съесть весь экран под неё.
    sizes.panelW = Math.max(MIN_PANEL, Math.min(width, window.innerWidth - 200));
  });

  dragSize(gripH, { rows: true }, (e) => {
    const top = root.querySelector<HTMLDivElement>('#ed-layers')!.getBoundingClientRect().top;
    const height = e.clientY - top;
    // Тайлам тоже надо оставить место, иначе палитра схлопнется в щель.
    sizes.layersH = Math.max(MIN_SECTION, Math.min(height, window.innerHeight - MIN_SECTION * 2));
  });
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
