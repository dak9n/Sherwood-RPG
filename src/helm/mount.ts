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
  #helm-stage { overflow: auto; display: flex; flex-wrap: wrap; gap: 18px; padding: 18px; align-content: center; justify-content: center; }
  .hcell { text-align: center; }
  .hcell canvas { image-rendering: pixelated; background: #10151a; border: 1px solid #0d1114; cursor: crosshair; }
  .hcell .cap { margin: 4px 0 0; color: #9fb0ba; }
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
      <h2>Color</h2>
      <div class="row"><div class="swatches" id="h-swatches"></div></div>
      <div class="row">
        <input type="color" id="h-custom" value="#208c92" title="Custom color">
        <button id="h-eraser">Eraser</button>
      </div>
      <div class="row">
        <button id="h-undo">Undo</button>
        <button id="h-copy">Front to sides</button>
        <button id="h-clear">Clear</button>
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
    wrap.append(c, Object.assign(document.createElement('div'), { className: 'cap', textContent: DIR_LABEL[dirn] }));
    stage.append(wrap);
    cellCanvases.push(c);

    let drawing: 'paint' | 'erase' | null = null;
    const paint = (e: MouseEvent): void => {
      const r = c.getBoundingClientRect();
      const x = Math.floor(((e.clientX - r.left) / r.width) * CELL);
      const y = Math.floor(((e.clientY - r.top) / r.height) * CELL);
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
      pushUndo();
      drawing = e.button === 2 ? 'erase' : 'paint';
      dirty();
      paint(e);
    };
    c.onmousemove = (e) => { if (drawing) paint(e); };
    window.addEventListener('mouseup', () => { drawing = null; });
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
    ctx.drawImage(refs[di].frame, 0, 0, FRAME, FRAME, Math.round(refs[di].dx) * ZOOM, Math.round(refs[di].dy) * ZOOM, FRAME * ZOOM, FRAME * ZOOM);
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
  for (const c of SWATCHES) {
    const el = document.createElement('div');
    el.className = 'sw';
    el.style.background = c;
    el.onclick = () => {
      color = c;
      eraser = false;
      swEls.forEach((e) => e.classList.toggle('on', e === el));
      $<HTMLButtonElement>('h-eraser').setAttribute('aria-pressed', 'false');
    };
    swatches.append(el);
    swEls.push(el);
  }
  $<HTMLInputElement>('h-custom').oninput = (e) => {
    color = (e.target as HTMLInputElement).value;
    eraser = false;
    swEls.forEach((el) => el.classList.remove('on'));
  };
  $<HTMLButtonElement>('h-eraser').onclick = () => {
    eraser = !eraser;
    $<HTMLButtonElement>('h-eraser').setAttribute('aria-pressed', String(eraser));
  };
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

  async function loadHelm(id: string): Promise<void> {
    rebuildRefs(); // у шлема и нагрудника разные якоря — референс сдвигается
    layers.forEach((l) => l.getContext('2d')!.clearRect(0, 0, CELL, CELL));
    try {
      const img = await load(`assets/worn/${id}.png?t=${Date.now()}`);
      DIRS.forEach((_, di) => layers[di].getContext('2d')!.drawImage(img, di * 32, 0, 32, 32, 0, 0, 32, 32));
      note.textContent = 'loaded';
      note.className = 'note ok';
    } catch {
      note.textContent = 'no sprite yet — draw one';
      note.className = 'note';
    }
    undoStack.length = 0;
    isDirty = false;
    renderAll();
    renderPreview();
  }

  selItem.onchange = () => {
    if (isDirty && !confirm('Discard unsaved changes?')) {
      return; // остаёмся как есть: select уже переключился, вернём
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
      body: JSON.stringify({ id: selItem.value, png: strip.toDataURL('image/png') }),
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
