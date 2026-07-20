/**
 * Редактор брони (?helm): рисуешь шлем или нагрудник ПРЯМО НА ГЕРОЕ.
 *
 * Спрайт — полоса 128x32: четыре ячейки 32x32 по направлениям (вниз/влево/
 * вправо/спина). Центр ячейки игра сажает в якорь предмета на каждом кадре:
 * шлему — центр головы, нагруднику — центр головы плюс WORN_TORSO_DROP вниз
 * (корпус). Здесь под ячейкой нарисован сам герой с тем же якорем по центру —
 * что видишь, то и получишь в игре.
 *
 * Появился потому, что автогенерация шлема заказчика не устроила (и
 * справедливо), а рисовать пиксели удобнее руками. Живёт только на
 * дев-сервере, в сборку не попадает (динамический импорт в main.ts).
 */

import { ITEMS, WORN_TORSO_DROP } from '../game/items';

const PARTS = 'assets/characters/PNG/Swordsman_lvl1/Parts/';
const PREFIX = 'Swordsman_lvl1_';
const FRAME = 64;
const DIRS = ['down', 'left', 'right', 'up'] as const;
const DIR_LABEL: Record<string, string> = { down: 'Front', left: 'Left', right: 'Right', up: 'Back' };
const CELL = 32; // ячейка шлема
const ZOOM = 9; // пиксель кисти на экране
/** Слои героя-референса, снизу вверх. */
const BODY = ['shadow', 'body', 'head'] as const;

/** Палитры комплектов — те же, что красят броню в игре (player.ts). */
const SWATCHES = [
  '#382214', '#583820', '#78502e', '#966a3e', '#b48854', // кожа
  '#1e1e24', '#54565e', '#787c85', '#9ea2a9', '#c4c8d0', // сталь
  '#062c32', '#126066', '#208c92', '#38b2b6', '#6cdad6', // лазурь
  '#000000', '#ffffff', '#c03a2e', '#caa04a', '#3a64c8', // акценты
];

const CSS = `
  body.helm-edit { margin: 0; background: #171c1f; color: #cfd8dc;
    font: 13px/1.5 system-ui, sans-serif; user-select: none; }
  body.helm-edit #game { display: none; }
  #helm { position: fixed; inset: 0; display: grid; grid-template-columns: 1fr 280px; }
  /* align-content: center НЕЛЬЗЯ: когда ячейки выше окна, центрирование
     выносит верхнюю за начало области прокрутки, и доскроллить до неё
     невозможно — первая ячейка (Front) просто пропадала, а рисование по ней
     выглядело как «ластик/вставка не работают». flex-start безопасен всегда. */
  #helm-stage { overflow: auto; display: flex; flex-wrap: wrap; gap: 18px; padding: 18px;
    align-content: flex-start; justify-content: center; }
  .hcell { text-align: center; }
  .hcell canvas { image-rendering: pixelated; background: #10151a; border: 1px solid #0d1114; cursor: crosshair; }
  .hcell .cap { margin: 0 0 4px; color: #9fb0ba; }
  #helm-side { background: #20272b; border-left: 1px solid #0d1114; padding: 12px; overflow-y: auto; }
  #helm h2 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #7d8f99; }
  #helm .row { display: flex; align-items: center; gap: 8px; margin: 6px 0; flex-wrap: wrap; }
  #helm select { flex: 1; font: inherit; color: #fff; background: #12171a; border: 1px solid #35424a; border-radius: 3px; padding: 3px 6px; }
  #helm button { font: inherit; color: inherit; background: #2f383e; border: 1px solid #0d1114; border-radius: 3px; padding: 5px 10px; cursor: pointer; }
  #helm button:hover { background: #3a464d; }
  #helm button.primary { background: #4a7a3f; border-color: #63a354; }
  #helm button[aria-pressed="true"] { background: #4a7a3f; border-color: #63a354; }
  #helm .swatches { display: grid; grid-template-columns: repeat(10, 22px); gap: 3px; }
  #helm .sw { width: 22px; height: 22px; border: 1px solid #0d1114; border-radius: 2px; cursor: pointer; }
  #helm .sw.on { outline: 2px solid #63a354; }
  #helm .note { min-height: 18px; font-size: 12px; margin-top: 6px; }
  #helm .note.ok { color: #8ad46a; } #helm .note.bad { color: #e0885a; }
  #helm .hint { color: #7d8f99; font-size: 12px; line-height: 1.45; margin-top: 8px; }
  #helm hr { border: none; border-top: 1px solid #2b3439; margin: 12px 0; }
  #helm-preview { image-rendering: pixelated; background: #10151a; border: 1px solid #0d1114; }
  /* Иконка предмета: то, что игрок видит в сумке и лавке — референс для рисунка. */
  #h-ref { image-rendering: pixelated; width: 64px; height: 64px;
    background: #10151a; border: 1px solid #0d1114; border-radius: 3px; }
  #helm .refcap { flex: 1; min-width: 0; line-height: 1.3; }
  #helm .refcap .dim { color: #7d8f99; font-size: 12px; }
  /* Справка — нативный dialog: Esc закрывает его сам браузер. */
  #helm-info { border: 1px solid #0d1114; border-radius: 6px; padding: 0;
    max-width: 560px; width: 92vw; background: #20272b; color: #cfd8dc;
    box-shadow: 0 12px 44px rgba(0,0,0,.55); }
  #helm-info::backdrop { background: rgba(0,0,0,.55); }
  #helm-info .card { max-height: 82vh; overflow-y: auto; padding: 0 18px 14px; }
  /* Шапка липкая: при прокрутке длинной справки кнопка Close остаётся на виду. */
  #helm-info h3 { position: sticky; top: 0; margin: 0 -18px 8px; padding: 12px 18px;
    background: #20272b; border-bottom: 1px solid #0d1114; font-size: 14px;
    display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  #helm-info h4 { margin: 10px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #7d8f99; }
  #helm-info ul { margin: 0; padding-left: 18px; }
  #helm-info li { margin: 3px 0; line-height: 1.45; }
  #helm-info button { font: inherit; color: inherit; background: #2f383e; border: 1px solid #0d1114;
    border-radius: 3px; padding: 3px 10px; cursor: pointer; }
`;

const load = (src: string): Promise<HTMLImageElement> =>
  new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error(src));
    img.src = src;
  });

export async function mountHelmEditor(): Promise<void> {
  document.body.classList.add('helm-edit');
  document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));

  // Слои героя: референс в ячейках и живой предпросмотр ходьбы.
  const sheets: Record<string, HTMLImageElement> = {};
  await Promise.all(
    ['Idle', 'Walk'].flatMap((n) => BODY.map(async (p) => {
      sheets[`${n}-${p}`] = await load(`${PARTS}${PREFIX}${n}_${p}.png`);
    })),
  );

  /** Центр головы кадра (col,row) листа: середина bbox слоя head. */
  const headCenter = (sheet: string, col: number, row: number): { x: number; y: number } => {
    const img = sheets[`${sheet}-head`];
    const c = document.createElement('canvas');
    c.width = FRAME;
    c.height = FRAME;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, col * FRAME, row * FRAME, FRAME, FRAME, 0, 0, FRAME, FRAME);
    const d = ctx.getImageData(0, 0, FRAME, FRAME).data;
    let x0 = FRAME, x1 = -1, y0 = FRAME, y1 = -1;
    for (let y = 0; y < FRAME; y++) {
      for (let x = 0; x < FRAME; x++) {
        if (d[(y * FRAME + x) * 4 + 3] > 24) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    return y1 < 0 ? { x: 32, y: 27 } : { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  };

  /** Кадр героя целиком (шахматки нет — фон игры тёмный, так честнее). */
  const heroFrame = (sheet: string, col: number, row: number): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.width = FRAME;
    c.height = FRAME;
    const ctx = c.getContext('2d')!;
    for (const p of BODY) ctx.drawImage(sheets[`${sheet}-${p}`], col * FRAME, row * FRAME, FRAME, FRAME, 0, 0, FRAME, FRAME);
    return c;
  };

  const root = document.createElement('div');
  root.id = 'helm';
  root.innerHTML = `
    <div id="helm-stage"></div>
    <div id="helm-side">
      <h2>Armor piece</h2>
      <div class="row"><select id="h-item"></select></div>
      <div class="row">
        <canvas id="h-ref" width="32" height="32" title="The item's icon as it looks in the bag and shop"></canvas>
        <div class="refcap">
          <div id="h-ref-name"></div>
          <div id="h-ref-slot" class="dim"></div>
        </div>
      </div>
      <h2>Color</h2>
      <div class="row"><div class="swatches" id="h-swatches"></div></div>
      <div class="row">
        <input type="color" id="h-custom" value="#208c92" title="Custom color">
      </div>
      <h2>Tool</h2>
      <div class="row">
        <button id="h-brush" aria-pressed="true">✏ Brush</button>
        <button id="h-eraser" aria-pressed="false">🧽 Eraser</button>
      </div>
      <div class="row">
        <button id="h-undo">Undo</button>
        <button id="h-copy">Front to sides</button>
        <button id="h-clear">Clear</button>
      </div>
      <h2>Insert item icon</h2>
      <div class="row">
        <button id="h-icon100">100%</button>
        <button id="h-icon75">75%</button>
        <button id="h-icon50">50%</button>
      </div>
      <h2>Resize drawing</h2>
      <div class="row">
        <button id="h-shrink">− Smaller</button>
        <button id="h-grow">+ Bigger</button>
      </div>
      <div class="row">
        <button id="h-hero" aria-pressed="true">Hero: on</button>
        <button id="h-info">Info</button>
      </div>
      <hr>
      <h2>Preview (walk)</h2>
      <canvas id="helm-preview" width="64" height="64" style="width:192px;height:192px"></canvas>
      <hr>
      <div class="row">
        <button id="h-save" class="primary">Save</button>
        <button id="h-reload">Reload</button>
      </div>
      <div class="note" id="h-note"></div>
      <p class="hint">
        Draw with the left button, erase with the right one. The hero under the
        pixels is the real in-game frame: the cell centre is pinned to his head,
        so what you draw here is exactly what he wears. Cover the face if you
        like — the helmet is drawn over it. Save writes the file and the game
        picks it up on reload.
      </p>
      <p class="hint">
        Hotkeys: <b>Alt+click</b> — pick a color (from your pixels, or the hero
        under them); <b>Ctrl/Cmd+Z</b> — undo; <b>Shift+drag</b> — grab the
        cell's drawing and move it; <b>arrows</b> — nudge the last-touched cell
        by a pixel; <b>+ / −</b> — resize the drawing; <b>E</b> — eraser,
        <b>B</b> — brush.
      </p>
    </div>`;
  document.body.append(root);
  const $ = <T extends HTMLElement>(id: string): T => root.querySelector(`#${id}`) as T;
  const note = $<HTMLDivElement>('h-note');

  const helms = Object.values(ITEMS).filter((d) => d.slot === 'helm' || d.slot === 'body');
  const selItem = $<HTMLSelectElement>('h-item');
  for (const h of helms) selItem.append(new Option(h.name, h.id));

  // Пиксели шлема: 4 слоя 32x32 (по направлению), рисуем в оффскрин-канвасы.
  const layers = DIRS.map(() => {
    const c = document.createElement('canvas');
    c.width = CELL;
    c.height = CELL;
    return c;
  });

  let color = '#208c92';
  let eraser = false;
  /** Ячейка, которой касались последней, — её двигают стрелки. */
  let activeCell = 0;
  /**
   * Показывать ли героя под рисунком. Выключение отвечает на «ластик не
   * работает»: стёртая заготовка туники открывала героя в почти такой же
   * тунике, и казалось, что ничего не стёрлось. Без героя виден только СВОЙ
   * рисунок — что стёр, там дырка.
   */
  let showHero = true;
  const undoStack: ImageData[][] = [];

  const pushUndo = (): void => {
    undoStack.push(layers.map((l) => l.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, CELL, CELL)));
    if (undoStack.length > 40) undoStack.shift();
  };
  const popUndo = (): void => {
    const prev = undoStack.pop();
    if (!prev) return;
    layers.forEach((l, i) => l.getContext('2d')!.putImageData(prev[i], 0, 0));
    renderAll();
    renderPreview(); // иначе превью застревает с отменённым рисунком
    dirty();
  };

  // --- Ячейки рисования: герой + пиксели шлема + сетка ---
  const stage = $<HTMLDivElement>('helm-stage');
  const cellCanvases: HTMLCanvasElement[] = [];
  DIRS.forEach((dirn, di) => {
    const wrap = document.createElement('div');
    wrap.className = 'hcell';
    const c = document.createElement('canvas');
    c.width = CELL * ZOOM;
    c.height = CELL * ZOOM;
    c.style.width = `${CELL * ZOOM}px`;
    // Подпись НАД ячейкой: под ней она при прокрутке читалась заголовком
    // СЛЕДУЮЩЕЙ ячейки — «Front» над профилем сбивал с толку.
    wrap.append(Object.assign(document.createElement('div'), { className: 'cap', textContent: DIR_LABEL[dirn] }), c);
    stage.append(wrap);
    cellCanvases.push(c);

    let drawing: 'paint' | 'erase' | null = null;
    /** Перетаскивание пикселей ячейки (Shift+драг): снимок и точка старта. */
    let moving: { snap: HTMLCanvasElement; x: number; y: number } | null = null;
    const cellPos = (e: MouseEvent): { x: number; y: number } => {
      const r = c.getBoundingClientRect();
      return {
        x: Math.floor(((e.clientX - r.left) / r.width) * CELL),
        y: Math.floor(((e.clientY - r.top) / r.height) * CELL),
      };
    };
    const paint = (e: MouseEvent): void => {
      const { x, y } = cellPos(e);
      if (x < 0 || y < 0 || x >= CELL || y >= CELL) return;
      const ctx = layers[di].getContext('2d')!;
      if (drawing === 'erase' || eraser) ctx.clearRect(x, y, 1, 1);
      else {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
      renderCell(di);
      renderPreview();
    };
    c.oncontextmenu = (e) => e.preventDefault();
    c.onmousedown = (e) => {
      activeCell = di; // стрелки двигают ту ячейку, которой касались последней
      const { x, y } = cellPos(e);

      // Alt — пипетка: цвет из рисунка, а под ним — из самого героя (удобно
      // брать тона кожи и волос). Действие не меняет пиксели — без Undo.
      if (e.altKey) {
        e.preventDefault();
        const ld = layers[di].getContext('2d')!.getImageData(x, y, 1, 1).data;
        let picked: [number, number, number] | null = ld[3] > 24 ? [ld[0], ld[1], ld[2]] : null;
        if (!picked) {
          const fx = x - Math.round(refs[di].dx);
          const fy = y - Math.round(refs[di].dy);
          if (fx >= 0 && fy >= 0 && fx < FRAME && fy < FRAME) {
            const hd = refs[di].frame.getContext('2d', { willReadFrequently: true })!.getImageData(fx, fy, 1, 1).data;
            if (hd[3] > 24) picked = [hd[0], hd[1], hd[2]];
          }
        }
        if (picked) setColor(`#${picked.map((v) => v.toString(16).padStart(2, '0')).join('')}`);
        return;
      }

      // Shift — взять рисунок ячейки и перетащить целиком.
      if (e.shiftKey) {
        pushUndo();
        const snap = document.createElement('canvas');
        snap.width = CELL;
        snap.height = CELL;
        snap.getContext('2d')!.drawImage(layers[di], 0, 0);
        moving = { snap, x, y };
        dirty();
        return;
      }

      pushUndo();
      drawing = e.button === 2 ? 'erase' : 'paint';
      dirty();
      paint(e);
    };
    c.onmousemove = (e) => {
      if (moving) {
        const { x, y } = cellPos(e);
        const ctx = layers[di].getContext('2d')!;
        ctx.clearRect(0, 0, CELL, CELL);
        ctx.drawImage(moving.snap, x - moving.x, y - moving.y);
        renderCell(di);
        renderPreview();
        return;
      }
      if (drawing) paint(e);
    };
    window.addEventListener('mouseup', () => { drawing = null; moving = null; });
  });

  /** Якорь текущего предмета: шлем — центр головы, нагрудник — ниже на корпус. */
  const drop = (): number => (ITEMS[selItem.value]?.slot === 'body' ? WORN_TORSO_DROP : 0);

  // Референс: idle-кадр направления, якорь предмета в центре ячейки.
  let refs = DIRS.map((_, di) => {
    const hc = headCenter('Idle', 0, di);
    return { frame: heroFrame('Idle', 0, di), dx: 16 - hc.x, dy: 16 - hc.y };
  });
  function rebuildRefs(): void {
    refs = DIRS.map((_, di) => {
      const hc = headCenter('Idle', 0, di);
      return { frame: heroFrame('Idle', 0, di), dx: 16 - hc.x, dy: 16 - hc.y - drop() };
    });
  }

  function renderCell(di: number): void {
    const c = cellCanvases[di];
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    // герой (голова по центру ячейки — как посадит игра): весь кадр 64x64,
    // сдвинутый так, чтобы центр головы лёг в клетку (16,16)
    if (showHero) {
      ctx.drawImage(refs[di].frame, 0, 0, FRAME, FRAME, Math.round(refs[di].dx) * ZOOM, Math.round(refs[di].dy) * ZOOM, FRAME * ZOOM, FRAME * ZOOM);
    }
    ctx.drawImage(layers[di], 0, 0, CELL, CELL, 0, 0, CELL * ZOOM, CELL * ZOOM);
    // сетка
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    for (let i = 1; i < CELL; i++) {
      ctx.beginPath(); ctx.moveTo(i * ZOOM, 0); ctx.lineTo(i * ZOOM, CELL * ZOOM); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * ZOOM); ctx.lineTo(CELL * ZOOM, i * ZOOM); ctx.stroke();
    }
    // центр головы
    ctx.strokeStyle = 'rgba(99,163,84,.5)';
    ctx.strokeRect(16 * ZOOM - 1, 16 * ZOOM - 1, 2, 2);
  }
  function renderAll(): void { DIRS.forEach((_, di) => renderCell(di)); }

  // --- Живой предпросмотр: ходьба вниз с надетым шлемом ---
  const pv = $<HTMLCanvasElement>('helm-preview');
  const pctx = pv.getContext('2d')!;
  let pvFrame = 0;
  function renderPreview(): void {
    pctx.imageSmoothingEnabled = false;
    pctx.clearRect(0, 0, 64, 64);
    pctx.drawImage(heroFrame('Walk', pvFrame, 0), 0, 0);
    const hc = headCenter('Walk', pvFrame, 0);
    pctx.drawImage(layers[0], 0, 0, CELL, CELL, Math.round(hc.x - 16), Math.round(hc.y - 16 + drop()), CELL, CELL);
  }
  window.setInterval(() => {
    pvFrame = (pvFrame + 1) % 6;
    renderPreview();
  }, 1000 / 8);

  // --- Палитра ---
  const swatches = $<HTMLDivElement>('h-swatches');
  const swEls: HTMLDivElement[] = [];
  /** Единая смена цвета: пипетка, плашки и своё поле идут через неё. */
  function setColor(hex: string): void {
    color = hex;
    setEraser(false);
    $<HTMLInputElement>('h-custom').value = hex;
    swEls.forEach((el, i) => el.classList.toggle('on', SWATCHES[i] === hex));
  }
  /**
   * Кисть или ластик. Подсвечиваем ОБЕ кнопки: у заказчика клавиша E занята
   * браузером, значит кнопка — основной способ переключения, и по ней должно
   * быть видно, какой инструмент сейчас в руке.
   */
  function setEraser(on: boolean): void {
    eraser = on;
    $<HTMLButtonElement>('h-eraser').setAttribute('aria-pressed', String(on));
    $<HTMLButtonElement>('h-brush').setAttribute('aria-pressed', String(!on));
  }
  for (const c of SWATCHES) {
    const el = document.createElement('div');
    el.className = 'sw';
    el.style.background = c;
    el.onclick = () => setColor(c);
    swatches.append(el);
    swEls.push(el);
  }
  $<HTMLInputElement>('h-custom').oninput = (e) => setColor((e.target as HTMLInputElement).value);
  // Кнопки задают инструмент прямо, а не переключают: нажал «Ластик» — ластик,
  // нажал ещё раз — он и остаётся. Так не бывает «нажал и случайно выключил».
  $<HTMLButtonElement>('h-eraser').onclick = () => setEraser(true);
  $<HTMLButtonElement>('h-brush').onclick = () => setEraser(false);

  // --- Горячие клавиши: Alt-пипетка живёт в mousedown ячейки, остальное тут ---
  /** Сдвиг рисунка ячейки на пиксель — стрелками, после Shift-перетаскивания доводка. */
  function nudge(di: number, dx: number, dy: number): void {
    pushUndo();
    const snap = document.createElement('canvas');
    snap.width = CELL;
    snap.height = CELL;
    snap.getContext('2d')!.drawImage(layers[di], 0, 0);
    const ctx = layers[di].getContext('2d')!;
    ctx.clearRect(0, 0, CELL, CELL);
    ctx.drawImage(snap, dx, dy);
    renderCell(di);
    renderPreview();
    dirty();
  }
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      popUndo();
      return;
    }
    if (e.key === 'e' || e.key === 'E') return setEraser(!eraser);
    if (e.key === 'b' || e.key === 'B') return setEraser(false);
    if (e.key === 'h' || e.key === 'H') return setHero(!showHero);
    if (e.key === '+' || e.key === '=') return scaleAll(1.125);
    if (e.key === '-' || e.key === '_') return scaleAll(1 / 1.125);
    if (e.key === 'Escape') return setInfo(false);
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const d = arrows[e.key];
    if (d) {
      e.preventDefault(); // стрелки двигают рисунок, а не прокрутку страницы
      nudge(activeCell, d[0], d[1]);
    }
  });
  // --- Вставка настоящей иконки предмета (те же листы, что в сумке/лавке) ---
  //
  // Иконка — готовый пиксель-арт: часто быстрее вставить её и подтереть, чем
  // рисовать спрайт с нуля. 100% — как в сумке (32px, крупнее героя), 75% и
  // 50% — ужатые до размеров головы/торса. Вставляется во фронтальную ячейку;
  // на бока и спину — Front to sides и правка руками.
  const ICON_SHEETS: Record<string, string> = {
    icons: 'assets/interface/PNG/Icons.png',
    armor: 'assets/armor-icons/armor_atlas.png',
    Objects: 'assets/tilesets/Objects.png',
    scroll: 'assets/interface/ui/scroll.png',
  };
  const iconSheets: Record<string, HTMLImageElement> = {};
  async function stampIcon(scale: number): Promise<void> {
    const def = ITEMS[selItem.value];
    if (!def) return;
    const ico = def.icon;
    iconSheets[ico.sheet] ??= await load(ICON_SHEETS[ico.sheet]);
    pushUndo(); // один снимок на все ячейки — одна отмена возвращает всё
    const w = Math.max(1, Math.round(ico.w * scale));
    const h = Math.max(1, Math.round(ico.h * scale));
    // Во ВСЕ четыре ячейки: вставка только во Front, прокрученный за экран,
    // выглядела как «ничего не произошло» (в превью шлем есть, в панели нет).
    for (const layer of layers) {
      const ctx = layer.getContext('2d')!;
      ctx.imageSmoothingEnabled = false; // пиксели, а не мыло
      ctx.drawImage(iconSheets[ico.sheet], ico.x, ico.y, ico.w, ico.h, Math.round(16 - w / 2), Math.round(16 - h / 2), w, h);
    }
    renderAll();
    renderPreview();
    dirty();
    // И показать результат: первая ячейка может быть прокручена прочь.
    cellCanvases[0].parentElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $<HTMLButtonElement>('h-icon100').onclick = () => void stampIcon(1);
  $<HTMLButtonElement>('h-icon75').onclick = () => void stampIcon(0.75);
  $<HTMLButtonElement>('h-icon50').onclick = () => void stampIcon(0.5);

  /**
   * Масштаб рисунка: все четыре ячейки разом, вокруг центра (там якорь — шлем
   * или нагрудник остаётся на месте). Шаг ~12%: достаточно мелкий, чтобы
   * подогнать вставленную иконку, и один клик — один Undo. Пиксель-арт при
   * многократном масштабировании сыпется — это нормально, откат всегда есть.
   */
  function scaleAll(k: number): void {
    pushUndo();
    for (const layer of layers) {
      const snap = document.createElement('canvas');
      snap.width = CELL;
      snap.height = CELL;
      snap.getContext('2d')!.drawImage(layer, 0, 0);
      const ctx = layer.getContext('2d')!;
      ctx.imageSmoothingEnabled = false; // пиксели, а не мыло
      ctx.clearRect(0, 0, CELL, CELL);
      const w = CELL * k;
      ctx.drawImage(snap, 16 - w / 2, 16 - w / 2, w, w);
    }
    renderAll();
    renderPreview();
    dirty();
  }
  $<HTMLButtonElement>('h-grow').onclick = () => scaleAll(1.125);
  $<HTMLButtonElement>('h-shrink').onclick = () => scaleAll(1 / 1.125);

  function setHero(on: boolean): void {
    showHero = on;
    const b = $<HTMLButtonElement>('h-hero');
    b.setAttribute('aria-pressed', String(on));
    b.textContent = on ? 'Hero: on' : 'Hero: off';
    renderAll();
  }
  $<HTMLButtonElement>('h-hero').onclick = () => setHero(!showHero);

  // --- Справка: все кнопки и клавиши в одном месте ---
  // Нативный <dialog>, как справка редактора карт: Esc закрывает его силами
  // браузера, даже если наш обработчик почему-то не сработает. Прошлая версия
  // была самодельным div-оверлеем, и заказчик не смог её закрыть.
  const info = document.createElement('dialog');
  info.id = 'helm-info';
  info.innerHTML = `
    <div class="card">
      <h3>Editor reference <button id="h-info-close" autofocus>Close</button></h3>
      <h4>Buttons</h4>
      <ul>
        <li><b>Armor piece</b> — which item you are drawing. Its file is what Save writes.</li>
        <li><b>Color swatches / custom</b> — brush color. Picking a color switches back to the brush.</li>
        <li><b>Brush / Eraser</b> — the current tool; the active one is highlighted. The eraser removes
            YOUR pixels. The hero underneath is background and cannot be erased — erasing over him just
            reveals him, which can look like "nothing happened" (turn Hero off to be sure).</li>
        <li><b>Undo</b> — step back (40 steps).</li>
        <li><b>Front to sides</b> — copy the Front cell onto Left and Right.</li>
        <li><b>Clear</b> — wipe all four cells.</li>
        <li><b>Insert item icon 100/75/50%</b> — stamp the item's shop icon into all four cells.</li>
        <li><b>− Smaller / + Bigger</b> — resize the drawing in all cells around its centre.</li>
        <li><b>Hero: on/off</b> — show or hide the hero under your pixels. Turn him off to see
            exactly what your sprite contains.</li>
        <li><b>Save</b> — write the file (with a backup); the game picks it up on reload.
            <b>Reload</b> — discard and reload the saved file.</li>
      </ul>
      <h4>Hotkeys</h4>
      <ul>
        <li><b>LMB</b> — draw, <b>RMB</b> — erase.</li>
        <li><b>Alt+click</b> — pick a color: from your pixels, or from the hero under them.</li>
        <li><b>Shift+drag</b> — grab the cell's drawing and move it.</li>
        <li><b>Arrows</b> — nudge the last-touched cell by one pixel.</li>
        <li><b>+ / −</b> — resize the drawing.</li>
        <li><b>Ctrl/Cmd+Z</b> — undo. <b>E</b> — eraser, <b>B</b> — brush, <b>H</b> — hero on/off.</li>
        <li><b>Esc</b> — close this help.</li>
      </ul>
    </div>`;
  document.body.append(info);
  const setInfo = (open: boolean): void => {
    if (open) info.showModal();
    else info.close();
  };
  $<HTMLButtonElement>('h-info').onclick = () => setInfo(!info.open);
  // Клик по подложке (вне карточки) тоже закрывает — третий способ выхода.
  info.onclick = (e) => { if (e.target === info) setInfo(false); };
  info.querySelector<HTMLButtonElement>('#h-info-close')!.onclick = () => setInfo(false);

  $<HTMLButtonElement>('h-undo').onclick = popUndo;
  $<HTMLButtonElement>('h-clear').onclick = () => {
    pushUndo();
    layers.forEach((l) => l.getContext('2d')!.clearRect(0, 0, CELL, CELL));
    renderAll();
    renderPreview();
    dirty();
  };
  // Спереди -> в профили: обычно рисуют фас, а бока — лёгкая правка копии.
  $<HTMLButtonElement>('h-copy').onclick = () => {
    pushUndo();
    for (const di of [1, 2]) {
      const ctx = layers[di].getContext('2d')!;
      ctx.clearRect(0, 0, CELL, CELL);
      ctx.drawImage(layers[0], 0, 0);
    }
    renderAll();
    dirty();
  };

  let isDirty = false;
  function dirty(): void {
    isDirty = true;
    note.textContent = 'unsaved changes';
    note.className = 'note bad';
  }

  /**
   * Заготовка для вещи без спрайта — ЕЁ СОБСТВЕННАЯ ИКОНКА, ужатая до героя.
   *
   * Раньше нагруднику подкладывалась перекрашенная туника, и заказчик резонно
   * спросил, почему на герое «непонятные пиксели», а не броня с иконки. Иконка
   * и есть то, что человек ожидает увидеть: ужимаем её до ширины торса (или
   * головы у шлема) — дальше правится руками.
   */
  async function seedFromIcon(id: string): Promise<boolean> {
    const def = ITEMS[id];
    if (!def) return false;
    const ico = def.icon;
    iconSheets[ico.sheet] ??= await load(ICON_SHEETS[ico.sheet]);
    // Те же ширины, что у генератора tools/worn-from-icons.py: фас/спина шире,
    // профиль уже — торс сбоку узкий.
    const widths = def.slot === 'body' ? [16, 12, 12, 16] : [17, 14, 14, 17];
    DIRS.forEach((_, di) => {
      const ctx = layers[di].getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, CELL, CELL);
      const w = widths[di];
      const h = Math.max(1, Math.round((ico.h / ico.w) * w));
      ctx.drawImage(iconSheets[ico.sheet], ico.x, ico.y, ico.w, ico.h, Math.round(16 - w / 2), Math.round(16 - h / 2), w, h);
    });
    return true;
  }

  /**
   * Иконка выбранного предмета крупно — та самая, что игрок видит в сумке и
   * лавке. Без неё непонятно, ЧТО рисуешь: в списке одно имя, а как вещь
   * выглядит в игре — не видно.
   */
  async function showItemIcon(id: string): Promise<void> {
    const def = ITEMS[id];
    const ref = $<HTMLCanvasElement>('h-ref');
    const ctx = ref.getContext('2d')!;
    ctx.clearRect(0, 0, 32, 32);
    $<HTMLDivElement>('h-ref-name').textContent = def?.name ?? '';
    $<HTMLDivElement>('h-ref-slot').textContent = def
      ? `${def.slot === 'helm' ? 'helmet' : 'chest'} · ${def.rarity ?? 'common'}`
      : '';
    if (!def) return;
    const ico = def.icon;
    iconSheets[ico.sheet] ??= await load(ICON_SHEETS[ico.sheet]);
    ctx.imageSmoothingEnabled = false;
    // Иконки бывают 16x16 и 32x32 — вписываем в клетку, сохраняя пропорции.
    const k = Math.min(32 / ico.w, 32 / ico.h);
    const w = Math.round(ico.w * k);
    const h = Math.round(ico.h * k);
    ctx.drawImage(iconSheets[ico.sheet], ico.x, ico.y, ico.w, ico.h, Math.round(16 - w / 2), Math.round(16 - h / 2), w, h);
  }

  async function loadHelm(id: string): Promise<void> {
    currentId = id; // теперь в слоях рисунок ЭТОГО предмета — Save пишет его
    void showItemIcon(id);
    rebuildRefs(); // у шлема и нагрудника разные якоря — референс сдвигается
    layers.forEach((l) => l.getContext('2d')!.clearRect(0, 0, CELL, CELL));
    try {
      const img = await load(`assets/worn/${id}.png?t=${Date.now()}`);
      DIRS.forEach((_, di) => layers[di].getContext('2d')!.drawImage(img, di * 32, 0, 32, 32, 0, 0, 32, 32));
      note.textContent = 'loaded';
      note.className = 'note ok';
    } catch {
      // Спрайта нет — подкладываем иконку предмета как заготовку.
      if (await seedFromIcon(id)) {
        note.textContent = 'seeded from the item icon — edit and save';
        note.className = 'note ok';
      } else {
        note.textContent = 'no sprite yet — draw one';
        note.className = 'note';
      }
    }
    undoStack.length = 0;
    isDirty = false;
    renderAll();
    renderPreview();
  }

  // Какой предмет сейчас в слоях. Именно ЕГО пишет Save — не selItem.value:
  // при отказе от смены select уже показывает новый id, и сохранение по нему
  // записало бы пиксели старого предмета в чужой файл.
  let currentId = '';
  selItem.onchange = () => {
    if (isDirty && !confirm('Discard unsaved changes?')) {
      selItem.value = currentId; // вернуть список к предмету, что в слоях
      return;
    }
    void loadHelm(selItem.value);
  };

  $<HTMLButtonElement>('h-save').onclick = async () => {
    const strip = document.createElement('canvas');
    strip.width = CELL * 4;
    strip.height = CELL;
    const ctx = strip.getContext('2d')!;
    layers.forEach((l, di) => ctx.drawImage(l, di * CELL, 0));
    note.textContent = 'saving…';
    note.className = 'note';
    const r = await fetch('/__save-helm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: currentId, png: strip.toDataURL('image/png') }),
    });
    const j = await r.json().catch(() => ({ ok: false, error: 'bad response' }));
    if (j.ok) {
      isDirty = false;
      note.textContent = 'saved — reload the game tab to see it';
      note.className = 'note ok';
    } else {
      note.textContent = `not saved: ${j.error ?? r.status}`;
      note.className = 'note bad';
    }
  };
  $<HTMLButtonElement>('h-reload').onclick = () => {
    if (isDirty && !confirm('Discard unsaved changes and reload?')) return;
    void loadHelm(selItem.value);
  };

  window.addEventListener('beforeunload', (e) => {
    if (isDirty) e.preventDefault();
  });

  swEls[7].click(); // стартовый цвет — сталь
  await loadHelm(selItem.value);
}
