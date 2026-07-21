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

/**
 * Листы анимаций — ТЕ ЖЕ, что грузит игра (ANIM_SHEETS в player.ts), и в том же
 * написании. Имя 'attack' со строчной буквы не опечатка: файл на диске такой.
 * На macOS регистр не важен и ошибка бы не всплыла, на Linux — всплыла бы 404.
 *
 * Редактор обязан знать про ВСЕ четыре, а не только про покой: голова героя
 * меняет форму от кадра к кадру (макушка гуляет на 3 px, высота — на 6), и
 * шлем, подогнанный по одной позе, в других садится иначе. Раньше редактор
 * показывал только Idle[0] — одну позу из тридцати трёх.
 */
const SHEETS = ['Idle', 'Walk', 'attack', 'Death'] as const;
const SHEET_LABEL: Record<string, string> = {
  Idle: 'Idle', Walk: 'Walk', attack: 'Attack', Death: 'Death',
};
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

  // Слои героя: референс в ячейках, превью и проверка волос по всем кадрам.
  const sheets: Record<string, HTMLImageElement> = {};
  await Promise.all(
    SHEETS.flatMap((n) => BODY.map(async (p) => {
      sheets[`${n}-${p}`] = await load(`${PARTS}${PREFIX}${n}_${p}.png`);
    })),
  );

  /** Сколько кадров в ряду листа. Считаем по картинке: таблица врёт молча. */
  const frameCount = (sheet: string): number => Math.floor(sheets[`${sheet}-head`].width / FRAME);

  /**
   * Центр головы и сами пиксели кадра — считаются один раз на кадр.
   *
   * Без кэша каждый вызов создавал канвас 64x64 и читал из него. Терпимо, пока
   * это был один кадр Idle[0], но проверка волос обходит все 33 кадра на четыре
   * направления, а renderCell зовётся на КАЖДЫЙ пиксель штриха — вместе это
   * тысячи канвасов в секунду.
   */
  const frameCache = new Map<string, { cx: number; cy: number; data: Uint8ClampedArray } | null>();
  const frameInfo = (sheet: string, col: number, row: number) => {
    const key = `${sheet}/${col}/${row}`;
    const hit = frameCache.get(key);
    if (hit !== undefined) return hit;

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
    // Пустой кадр (художник заполнил ряд не до конца) — не кадр.
    const out = y1 < 0 ? null : { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, data: d };
    frameCache.set(key, out);
    return out;
  };

  /** Центр головы кадра. Пустой кадр — отдаём середину, как раньше. */
  const headCenter = (sheet: string, col: number, row: number): { x: number; y: number } => {
    const f = frameInfo(sheet, col, row);
    return f ? { x: f.cx, y: f.cy } : { x: 32, y: 27 };
  };

  /** Кадр героя целиком (шахматки нет — фон игры тёмный, так честнее). */
  const heroFrame = (
    sheet: string,
    col: number,
    row: number,
    parts: readonly string[] = BODY,
  ): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.width = FRAME;
    c.height = FRAME;
    const ctx = c.getContext('2d')!;
    for (const p of parts) ctx.drawImage(sheets[`${sheet}-${p}`], col * FRAME, row * FRAME, FRAME, FRAME, 0, 0, FRAME, FRAME);
    return c;
  };

  /**
   * Герой разложен на ДВЕ части, а не склеен в одну, потому что броня лежит
   * между ними. Игра рисует так: тень, тело, НАГРУДНИК, голова, ШЛЕМ (см.
   * player.ts, drawSheet) — подбородок остаётся поверх воротника.
   *
   * Редактор же клал рисунок поверх всего готового героя, и для нагрудника это
   * была ложь: верхние 13 строк ячейки из 32 в игре закрыты головой. У Padded
   * Tunic так пропадало 169 нарисованных пикселей, у Iron Cuirass 135 — почти
   * половина холста показывала то, чего игрок никогда не увидит.
   */
  const BELOW = ['shadow', 'body'] as const;
  const HEAD = ['head'] as const;

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
        <button id="h-hair" aria-pressed="false" title="Rub out the hero's hair where it pokes out from under this helmet">💈 Hair rubber</button>
        <button id="h-hairclear">Clear hair</button>
      </div>
      <div class="row">
        <button id="h-hairfind" title="Scan every frame of every animation and rub out all the hair this helmet fails to cover">🔍 Find stray hair</button>
      </div>
      <div class="note" id="h-hairnote"></div>
      <h2>Reference pose</h2>
      <div class="row">
        <select id="h-anim"></select>
        <button id="h-prev" title="Previous frame">◀</button>
        <span id="h-frame" class="dim"></span>
        <button id="h-next" title="Next frame">▶</button>
      </div>
      <div class="row">
        <button id="h-nudgeframe" aria-pressed="false" title="Arrows move the armour on THIS frame only, instead of moving the drawing">🎯 Fit this frame</button>
      </div>
      <div class="row">
        <span id="h-offset" class="dim"></span>
        <button id="h-offreset" title="Clear the offset of this frame">Reset frame</button>
        <button id="h-offresetall" title="Clear every per-frame offset of this item">Reset all</button>
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
      <h2 id="h-pvcap">Preview</h2>
      <canvas id="helm-preview" width="128" height="128" style="width:256px;height:256px"></canvas>
      <div class="row">
        <button id="h-play" aria-pressed="true" title="Play or freeze the preview">⏸ Pause</button>
        <span id="h-pvframe" class="dim"></span>
      </div>
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
        Hotkeys: <b>B</b> brush, <b>E</b> eraser, <b>R</b> hair rubber,
        <b>M</b> fit-this-frame, <b>H</b> hero on/off, <b>Space</b> play/pause
        preview, <b>+ / −</b> resize the drawing, <b>Ctrl/Cmd+Z</b> undo,
        <b>Alt+click</b> pick a colour (from your pixels, or the hero under
        them), <b>Shift+drag</b> grab the cell's drawing and move it,
        <b>arrows</b> nudge it by a pixel.
      </p>
      <p class="hint">
        <b>Hair rubber</b> deletes the hero's hair, not your helmet — for the
        strands that poke out from under a close helm. What you rub out here
        disappears in the game too, for this helmet only — the hole you see is
        the whole feedback, nothing is drawn over it. The right button puts the
        hair back. <b>Clear hair</b> then <b>Save</b> removes the mask altogether.
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

  /**
   * Маска волос: те же 4 ячейки 32x32, но рисуется в них не шлем, а «здесь
   * голову не рисовать». Игра вырезает эти пиксели из слоя головы перед тем,
   * как поставить шлем (Player.drawHeadMasked).
   *
   * Отдельным слоем, а не стиранием самих волос в спрайте героя: голова у него
   * одна на все шлемы, а торчит из-под каждого шлема своё.
   */
  const masks = DIRS.map(() => {
    const c = document.createElement('canvas');
    c.width = CELL;
    c.height = CELL;
    return c;
  });

  let color = '#208c92';
  let eraser = false;
  /** Ластик по волосам героя вместо кисти по шлему. */
  let hairMode = false;
  /** Ячейка, которой касались последней, — её двигают стрелки. */
  let activeCell = 0;
  /**
   * Показывать ли героя под рисунком. Выключение отвечает на «ластик не
   * работает»: стёртая заготовка туники открывала героя в почти такой же
   * тунике, и казалось, что ничего не стёрлось. Без героя виден только СВОЙ
   * рисунок — что стёр, там дырка.
   */
  let showHero = true;
  // Undo хранит и шлем, и маску: инструменты переключаются на лету, и откат
  // «через границу» иначе воскрешал бы чужой слой.
  const undoStack: { pix: ImageData[]; off: string }[] = [];
  const snapshot = (): ImageData[] =>
    [...layers, ...masks].map((l) => l.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, CELL, CELL));

  const pushUndo = (): void => {
    // Поправки кадров кладём строкой: их мало, а откат «через границу» между
    // рисованием и подгонкой иначе воскрешал бы чужое состояние.
    undoStack.push({ pix: snapshot(), off: JSON.stringify(offsets) });
    if (undoStack.length > 40) undoStack.shift();
  };
  const popUndo = (): void => {
    const snap = undoStack.pop();
    if (!snap) return;
    const prev = snap.pix;
    offsets = JSON.parse(snap.off) as typeof offsets;
    layers.forEach((l, i) => l.getContext('2d')!.putImageData(prev[i], 0, 0));
    masks.forEach((m, i) => m.getContext('2d')!.putImageData(prev[layers.length + i], 0, 0));
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
    /**
     * Координаты пикселя ячейки под курсором.
     *
     * Результат ОБЯЗАН быть конечным и близким к ячейке, потому что по нему
     * тянется линия штриха: она шагает от прошлой точки до этой, пока не
     * совпадёт. Бесконечность недостижима — и вкладка вешается намертво.
     * Поймано на живой проверке: курсор ушёл за край ячейки во время
     * протягивания, и редактор перестал отвечать.
     *
     * Поэтому: нулевой размер (ячейку ещё не разложили) — отдаём заведомо
     * внешнюю точку, а всё остальное подрезаем до одного пикселя за границей.
     * Рисование при этом честно упирается в край: applyAt внешние точки не
     * пропускает.
     */
    const cellPos = (e: MouseEvent): { x: number; y: number } => {
      const r = c.getBoundingClientRect();
      if (!r.width || !r.height) return { x: -1, y: -1 };
      const clamp = (v: number): number => (Number.isFinite(v) ? Math.max(-1, Math.min(CELL, v)) : -1);
      return {
        x: clamp(Math.floor(((e.clientX - r.left) / r.width) * CELL)),
        y: clamp(Math.floor(((e.clientY - r.top) / r.height) * CELL)),
      };
    };
    /** Инструмент по ОДНОМУ пикселю ячейки. Соединять точки — забота paint. */
    const applyAt = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= CELL || y >= CELL) return;

      // Режим волос: пишем не в шлем, а в маску. Левая кнопка стирает волосы
      // (ставит пиксель маски), правая возвращает их обратно.
      if (hairMode) {
        const mctx = masks[di].getContext('2d')!;
        if (drawing === 'erase') mctx.clearRect(x, y, 1, 1);
        else {
          mctx.fillStyle = '#ffffff';
          mctx.fillRect(x, y, 1, 1);
        }
        return;
      }

      const ctx = layers[di].getContext('2d')!;
      if (drawing === 'erase' || eraser) ctx.clearRect(x, y, 1, 1);
      else {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    };

    /** Где штрих был в прошлый раз — чтобы дотянуть линию оттуда досюда. */
    let last: { x: number; y: number } | null = null;

    /**
     * Штрих от прошлой точки до текущей, а не точка под курсором.
     *
     * Браузер шлёт mousemove РЕДКО: на живом протягивании через всю ячейку их
     * приходит три штуки. Красить только пришедшие точки — значит оставлять
     * дырки между ними. Заказчик поймал это на ластике по волосам («какие-то
     * синие полосы»): три одиночных пикселя, каждый в своей рамке, и выглядело
     * это как мусор. Кисть и ластик шлема страдали тем же с самого начала,
     * просто на сплошной заливке пунктир не так заметен.
     *
     * Соединяем Брезенхэмом — целочисленно, без дробей и без пропусков.
     */
    const paint = (e: MouseEvent): void => {
      const { x, y } = cellPos(e);

      if (!last) applyAt(x, y);
      else {
        let cx = last.x;
        let cy = last.y;
        const dx = Math.abs(x - cx);
        const dy = -Math.abs(y - cy);
        const sx = cx < x ? 1 : -1;
        const sy = cy < y ? 1 : -1;
        let err = dx + dy;
        for (;;) {
          applyAt(cx, cy);
          if (cx === x && cy === y) break;
          const e2 = 2 * err;
          if (e2 >= dy) { err += dy; cx += sx; }
          if (e2 <= dx) { err += dx; cy += sy; }
        }
      }
      last = { x, y };

      renderCell(di);
      renderPreview();
    };
    c.oncontextmenu = (e) => e.preventDefault();
    c.onmousedown = (e) => {
      activeCell = di; // стрелки двигают ту ячейку, которой касались последней
      updateOffsetNote();
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
      last = null; // новый штрих начинается точкой, а не линией от прошлого
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
    window.addEventListener('mouseup', () => { drawing = null; moving = null; last = null; scheduleHairNote(); });
  });

  /** Якорь текущего предмета: шлем — центр головы, нагрудник — ниже на корпус. */
  const drop = (): number => (ITEMS[selItem.value]?.slot === 'body' ? WORN_TORSO_DROP : 0);

  /**
   * Какую позу героя показывать под рисунком.
   *
   * Раньше была намертво Idle[0]. Это и есть та слепая зона, из-за которой
   * из-под шлема вылезали волосы, невидимые в редакторе: голова в других кадрах
   * выше и уже, и рисунок, идеальный в покое, в движении садился не так.
   */
  let refSheet: string = 'Idle';
  let refCol = 0;

  /**
   * Ручные поправки посадки по кадрам: лист -> номер кадра -> [dx, dy].
   *
   * Броня и так едет за героем — игра сажает её в центр bbox головы каждого
   * кадра. Но bbox не знает про наклон: в замахе герой ведёт головой, рамка
   * почти не меняется, и шлем «плавает» относительно черепа. Эта таблица
   * дочищает такие кадры вручную.
   *
   * Номер кадра — как в игре (Player.stampWorn): fr = ряд * кадров_в_ряду +
   * столбец, ряд это направление. Разреженно: ровных кадров большинство,
   * записи у них нет.
   */
  let offsets: Record<string, Record<number, [number, number]>> = {};
  /** Стрелки двигают не рисунок, а посадку текущего кадра. */
  let nudgeFrame = false;

  /** Номер кадра в листе для ячейки di при текущей позе — нумерация игры. */
  const frameIndex = (di: number): number => di * frameCount(refSheet) + refCol;
  const offsetOf = (di: number): [number, number] => offsets[refSheet]?.[frameIndex(di)] ?? [0, 0];
  const setOffset = (di: number, dx: number, dy: number): void => {
    const sheet = (offsets[refSheet] ??= {});
    const fr = frameIndex(di);
    if (dx === 0 && dy === 0) delete sheet[fr];
    else sheet[fr] = [dx, dy];
    if (!Object.keys(sheet).length) delete offsets[refSheet];
  };

  /**
   * На сколько сдвинуть кадр героя, чтобы якорь предмета лёг в центр ячейки.
   *
   * Считается ЗЕРКАЛЬНО игре, а не «похоже»: Player.stampWorn ставит ячейку в
   * кадр по `Math.round(c.x - 16)`, значит кадр в ячейке обязан стоять по
   * `-Math.round(c.x - 16)`. Раньше тут было `Math.round(16 - c.x)` — это НЕ то
   * же самое, потому что Math.round округляет .5 всегда вверх, к плюс
   * бесконечности: round(-11.5) = -11, а -round(11.5) = -12.
   *
   * Центр головы бывает полуцелым — в 83 кадрах из 124. У покоя это профили:
   * влево (30.5, 26.5) и вправо (32.5, 26.5), тогда как фас (30, 27) и спина
   * (32, 27) целые. В таких кадрах редактор показывал героя на пиксель правее
   * и ниже, чем игра: ластик промахивался мимо пикселя, по которому щёлкнули
   * («нажимаю точно на пиксель и не стирает»). Ровно так же был сдвинут и
   * рисунок шлема — просто на сплошной заливке это не бросалось в глаза.
   */
  const heroShift = (hc: { x: number; y: number }): { x: number; y: number } => ({
    x: -Math.round(hc.x - 16),
    y: -Math.round(hc.y - 16 + drop()),
  });

  // Референс: выбранная поза, якорь предмета в центре ячейки.
  const buildRefs = () =>
    DIRS.map((_, di) => {
      const hc = headCenter(refSheet, refCol, di);
      const s = heroShift(hc);
      return {
        below: heroFrame(refSheet, refCol, di, BELOW),
        head: heroFrame(refSheet, refCol, di, HEAD),
        frame: heroFrame(refSheet, refCol, di),
        dx: s.x,
        dy: s.y,
      };
    });
  /**
   * Тона волос героя. Кожу и глаза сюда НЕ берём: подбородок и щека из-под
   * открытого шлема — это нормально и даже нужно, а прядь поверх забрала — нет.
   * Те же числа, что в tools/hair-mask.py, — там они и подобраны по листу.
   */
  const HAIR_TONES = new Set(
    [[33, 26, 28], [43, 32, 35], [59, 44, 51], [77, 57, 69], [104, 79, 90], [135, 108, 125], [17, 11, 0]]
      .map(([r, g, b]) => (r << 16) | (g << 8) | b),
  );

  /**
   * Где из-под шлема торчат волосы — по ВСЕМ кадрам ВСЕХ анимаций.
   *
   * Это перенос tools/hair-mask.py внутрь редактора. Скрипт считал то же самое,
   * но офлайн: владелец рисовал, сохранял, запускал команду, возвращался. Здесь
   * ответ виден сразу, и это главное, чего редактору не хватало — он показывал
   * одну позу, а промахи прятались в остальных тридцати двух.
   *
   * Возвращает клетки ячейки (а не пиксели кадра): именно ими рисуется маска.
   */
  function strayHair(): { cells: Set<number>[]; total: number } {
    const helm = layers.map((l) => l.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, CELL, CELL).data);
    const worn = masks.map((m) => m.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, CELL, CELL).data);
    const cells = DIRS.map(() => new Set<number>());

    for (const sheet of SHEETS) {
      for (let col = 0; col < frameCount(sheet); col++) {
        for (let row = 0; row < DIRS.length; row++) {
          const f = frameInfo(sheet, col, row);
          if (!f) continue;
          // Та же посадка, что в игре: ячейка ложится в кадр по round(центр-16).
          const ox = Math.round(f.cx - 16);
          const oy = Math.round(f.cy - 16);
          for (let y = 0; y < FRAME; y++) {
            for (let x = 0; x < FRAME; x++) {
              const p = (y * FRAME + x) * 4;
              if (f.data[p + 3] <= 24) continue;
              if (!HAIR_TONES.has((f.data[p] << 16) | (f.data[p + 1] << 8) | f.data[p + 2])) continue;

              const mx = x - ox;
              const my = y - oy;
              if (mx < 0 || my < 0 || mx >= CELL || my >= CELL) continue; // маской не достать
              const c = (my * CELL + mx) * 4;
              if (helm[row][c + 3] > 0) continue; // шлем и так закрывает
              if (worn[row][c + 3] > 0) continue; // уже стёрто
              cells[row].add(my * CELL + mx);
            }
          }
        }
      }
    }
    return { cells, total: cells.reduce((n, s) => n + s.size, 0) };
  }

  let refs = buildRefs();
  function rebuildRefs(): void {
    refs = buildRefs();
  }

  /**
   * Кадр героя с вырезанными по маске пикселями — ровно то же, что делает игра
   * в Player.drawHeadMasked: ячейка маски 32x32 садится центром в центр головы
   * кадра, и всё под ней стирается.
   *
   * Тот же расчёт повторён здесь, а не вынесен в общий модуль, потому что там
   * он работает по листу целиком и знает про Phaser, а тут — по одному кадру
   * на канвасе. Геометрия одна: центр ячейки в центр головы.
   */
  function maskedFrame(
    frame: HTMLCanvasElement,
    mask: HTMLCanvasElement,
    hc: { x: number; y: number },
  ): HTMLCanvasElement {
    const off = document.createElement('canvas');
    off.width = FRAME;
    off.height = FRAME;
    const octx = off.getContext('2d')!;
    octx.imageSmoothingEnabled = false;
    octx.drawImage(frame, 0, 0);
    octx.globalCompositeOperation = 'destination-out';
    octx.drawImage(mask, 0, 0, CELL, CELL, Math.round(hc.x - 16), Math.round(hc.y - 16), CELL, CELL);
    octx.globalCompositeOperation = 'source-over';
    return off;
  }

  /** Референсный кадр направления с тем же вырезом. */
  /**
   * Голова с вырезом. Именно ГОЛОВА, а не склеенный герой: игра вырезает маску
   * из одного слоя head (Player.drawHeadMasked), а редактор резал по всей
   * склейке — и маска прогрызала плечи и тень, которых в игре не касается.
   * У Ember Helm так съедалось до 10 фантомных пикселей на ячейку.
   */
  function maskedHead(di: number): HTMLCanvasElement {
    return maskedFrame(refs[di].head, masks[di], headCenter(refSheet, refCol, di));
  }

  function renderCell(di: number): void {
    const c = cellCanvases[di];
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    // герой (голова по центру ячейки — как посадит игра): весь кадр 64x64,
    // сдвинутый так, чтобы центр головы лёг в клетку (16,16)
    // Порядок ровно как в игре: тень+тело -> нагрудник -> голова -> шлем.
    const isBody = ITEMS[selItem.value]?.slot === 'body';
    const put = (src: CanvasImageSource): void =>
      ctx.drawImage(src, 0, 0, FRAME, FRAME, refs[di].dx * ZOOM, refs[di].dy * ZOOM, FRAME * ZOOM, FRAME * ZOOM);
    const [ox, oy] = offsetOf(di);
    const putArmor = (): void =>
      ctx.drawImage(layers[di], 0, 0, CELL, CELL, ox * ZOOM, oy * ZOOM, CELL * ZOOM, CELL * ZOOM);

    if (showHero) {
      put(refs[di].below);
      if (isBody) putArmor(); // нагрудник УХОДИТ ПОД голову — так его видит игрок
      put(maskedHead(di));
      if (!isBody) putArmor();
    } else {
      putArmor();
    }

    // Маску НИЧЕМ не помечаем. Сначала она была тёплой заливкой (заказчик: «левая
    // кнопка не стирает, а рисует»), потом холодной обводкой — и та тоже мешала
    // («убери эту голубую залупу»). И правильно: стёртый пиксель героя видно и
    // так, а любая метка поверх спорит с рисунком шлема. Обратная связь у
    // ластика одна — дырка на том месте, где было стёрто.

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
  const pvCap = $<HTMLHeadingElement>('h-pvcap');
  const pvFrameLabel = $<HTMLSpanElement>('h-pvframe');
  let pvFrame = 0;
  /** Крутить превью или замереть. На паузе показывается правимый кадр. */
  let playing = true;

  /**
   * Превью идёт за ВЫБРАННОЙ анимацией и показывает все четыре направления.
   *
   * Раньше оно было намертво прибито к ходьбе и к одному фасу: заказчик
   * переключал на Attack, а внизу по-прежнему шагал герой — «не отображается
   * эта анимация, как я пойму, что редактировать». Справедливо: подгонять кадр
   * замаха, глядя на ходьбу, невозможно.
   *
   * На паузе кадр берётся тот же, что стоит в «Reference pose», — то есть
   * ровно тот, который правится стрелками.
   */
  function renderPreview(): void {
    const sheet = refSheet;
    const n = frameCount(sheet);
    const col = playing ? pvFrame % n : refCol;
    const isBody = ITEMS[selItem.value]?.slot === 'body';
    const cols = n;

    pctx.imageSmoothingEnabled = false;
    pctx.clearRect(0, 0, pv.width, pv.height);

    DIRS.forEach((_, di) => {
      const gx = (di % 2) * FRAME;
      const gy = Math.floor(di / 2) * FRAME;
      const info = frameInfo(sheet, col, di);
      if (!info) return; // пустой кадр листа — художник заполнил ряд не до конца

      const hc = { x: info.cx, y: info.cy };
      const po = offsets[sheet]?.[di * cols + col] ?? [0, 0];
      const armor = (): void =>
        pctx.drawImage(layers[di], 0, 0, CELL, CELL,
          gx + Math.round(hc.x - 16) + po[0], gy + Math.round(hc.y - 16 + drop()) + po[1], CELL, CELL);

      pctx.drawImage(heroFrame(sheet, col, di, BELOW), gx, gy);
      if (isBody) armor();
      pctx.drawImage(maskedFrame(heroFrame(sheet, col, di, HEAD), masks[di], hc), gx, gy);
      if (!isBody) armor();
    });

    pvCap.textContent = `Preview — ${SHEET_LABEL[sheet]}`;
    pvFrameLabel.textContent = playing ? 'playing' : `frozen on ${col + 1}/${n}`;
  }

  function setPlaying(on: boolean): void {
    playing = on;
    const b = $<HTMLButtonElement>('h-play');
    b.textContent = on ? '⏸ Pause' : '▶ Play';
    b.setAttribute('aria-pressed', String(on));
    renderPreview();
  }
  $<HTMLButtonElement>('h-play').onclick = () => setPlaying(!playing);

  window.setInterval(() => {
    if (!playing) return;
    pvFrame++;
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
    hairMode = false;
    $<HTMLButtonElement>('h-eraser').setAttribute('aria-pressed', String(on));
    $<HTMLButtonElement>('h-brush').setAttribute('aria-pressed', String(!on));
    $<HTMLButtonElement>('h-hair').setAttribute('aria-pressed', 'false');
    renderAll();
  }

  /**
   * Ластик по волосам. Гасит кисть и обычный ластик: три инструмента, и в руке
   * всегда ровно один — иначе непонятно, куда попадёт клик.
   *
   * Для нагрудника выключен: маска вырезает голову, а нагрудник до неё не
   * достаёт — кнопка там только сбивала бы с толку.
   */
  function setHair(on: boolean): void {
    hairMode = on && ITEMS[selItem.value]?.slot === 'helm';
    eraser = false;
    $<HTMLButtonElement>('h-hair').setAttribute('aria-pressed', String(hairMode));
    $<HTMLButtonElement>('h-eraser').setAttribute('aria-pressed', 'false');
    $<HTMLButtonElement>('h-brush').setAttribute('aria-pressed', String(!hairMode));
    renderAll();
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
  $<HTMLButtonElement>('h-hair').onclick = () => setHair(!hairMode);
  $<HTMLButtonElement>('h-hairclear').onclick = () => {
    pushUndo();
    masks.forEach((m) => m.getContext('2d')!.clearRect(0, 0, CELL, CELL));
    renderAll();
    renderPreview();
    dirty();
    updateHairNote();
  };

  // --- Проверка волос по всем кадрам ---

  const hairNote = $<HTMLDivElement>('h-hairnote');
  /**
   * Сколько волос ещё торчит. Считается не на каждый пиксель штриха, а через
   * паузу после него: обход 33 кадров на четыре направления — это миллионы
   * сравнений, в горячем пути ему не место.
   */
  let hairTimer = 0;
  function updateHairNote(): void {
    if (ITEMS[selItem.value]?.slot !== 'helm') {
      hairNote.textContent = '';
      return;
    }
    const { total } = strayHair();
    hairNote.textContent = total
      ? `${total} px of hair still show — press “Find stray hair”`
      : 'no hair pokes out — clean in every frame';
    hairNote.className = total ? 'note bad' : 'note ok';
  }
  function scheduleHairNote(): void {
    window.clearTimeout(hairTimer);
    hairTimer = window.setTimeout(updateHairNote, 400);
  }

  $<HTMLButtonElement>('h-hairfind').onclick = () => {
    if (ITEMS[selItem.value]?.slot !== 'helm') {
      hairNote.textContent = 'only helmets have a hair mask';
      hairNote.className = 'note';
      return;
    }
    const { cells, total } = strayHair();
    if (!total) {
      updateHairNote();
      return;
    }
    pushUndo();
    cells.forEach((set, di) => {
      const ctx = masks[di].getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      for (const i of set) ctx.fillRect(i % CELL, Math.floor(i / CELL), 1, 1);
    });
    renderAll();
    renderPreview();
    dirty();
    updateHairNote();
  };

  // --- Выбор позы под рисунком ---

  const selAnim = $<HTMLSelectElement>('h-anim');
  for (const sh of SHEETS) selAnim.append(new Option(SHEET_LABEL[sh], sh));
  const frameLabel = $<HTMLSpanElement>('h-frame');

  function setPose(sheet: string, col: number): void {
    refSheet = sheet;
    // Кадры по кругу: с последнего «вперёд» — на первый, так листать удобнее.
    const n = frameCount(sheet);
    refCol = ((col % n) + n) % n;
    selAnim.value = sheet;
    frameLabel.textContent = `${refCol + 1}/${n}`;
    rebuildRefs();
    renderAll();
    renderPreview();
    updateOffsetNote();
  }
  selAnim.onchange = () => setPose(selAnim.value, 0);
  // Шагнул по кадрам — превью замирает на нём же. Иначе правишь один кадр, а
  // внизу крутится вся анимация, и результат правки не разглядеть.
  $<HTMLButtonElement>('h-prev').onclick = () => { setPose(refSheet, refCol - 1); setPlaying(false); };
  $<HTMLButtonElement>('h-next').onclick = () => { setPose(refSheet, refCol + 1); setPlaying(false); };

  // --- Покадровая подгонка посадки ---

  const offNote = $<HTMLSpanElement>('h-offset');
  function updateOffsetNote(): void {
    const [x, y] = offsetOf(activeCell);
    const total = Object.values(offsets).reduce((n, m) => n + Object.keys(m).length, 0);
    const sign = (v: number): string => (v > 0 ? `+${v}` : `${v}`);
    // Первым делом — что СЕЙЧАС сделают стрелки. Два их назначения (двигать
    // посадку одного кадра или рисунок на всех) слишком легко перепутать, а
    // цена ошибки разная: второе правит вещь целиком.
    offNote.textContent =
      (nudgeFrame
        ? `arrows: fit ${DIR_LABEL[DIRS[activeCell]]} on frame ${refCol + 1} — ${x || y ? `${sign(x)},${sign(y)}` : 'as anchored'}`
        : 'arrows: move the drawing (all frames)')
      + (total ? ` · ${total} frame${total > 1 ? 's' : ''} tuned` : '');
  }

  /**
   * Режим подгонки. Отдельной кнопкой, а не модификатором: стрелки в нём
   * означают совсем другое (двигают посадку на ОДНОМ кадре, а не рисунок на
   * всех), и путать эти два действия нельзя — второе правит вещь целиком.
   */
  function setNudgeFrame(on: boolean): void {
    nudgeFrame = on;
    $<HTMLButtonElement>('h-nudgeframe').setAttribute('aria-pressed', String(on));
    updateOffsetNote();
  }
  $<HTMLButtonElement>('h-nudgeframe').onclick = () => setNudgeFrame(!nudgeFrame);

  $<HTMLButtonElement>('h-offreset').onclick = () => {
    pushUndo();
    setOffset(activeCell, 0, 0);
    renderCell(activeCell);
    renderPreview();
    updateOffsetNote();
    dirty();
  };
  $<HTMLButtonElement>('h-offresetall').onclick = () => {
    if (!Object.keys(offsets).length) return;
    pushUndo();
    offsets = {};
    renderAll();
    renderPreview();
    updateOffsetNote();
    dirty();
  };

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
    // Автоповтор игнорируем. Зажатая стрелка слала бы nudge тридцать раз в
    // секунду: за две секунды рисунок уезжает за край ячейки и обрезается
    // насмерть, а стек отмены (40 снимков) успевает целиком забиться пустотой —
    // Ctrl+Z уже нечего возвращать. Это единственная НЕВОССТАНОВИМАЯ потеря,
    // которая тут была.
    if (e.repeat) return;

    const t = e.target as HTMLElement | null;
    // Поля ввода забирают клавиши себе — там печатают, а не рисуют.
    //
    // BUTTON сюда НЕ входит, хотя соблазн был: справка тоже ловит фокус на
    // кнопке. Но кнопок в панели два десятка, и после клика по любой из них
    // (например «▶» — шаг по кадрам) фокус остаётся на ней, а стрелки
    // становились мертвы. Заказчик поймал это так: шагнул кадр, жмёт стрелку —
    // ничего; кликнул по ячейке, чтобы расшевелить, — и стрелки поехали, но уже
    // в режиме «двигать рисунок», то есть по всем кадрам сразу.
    // Справку закрывает отдельная проверка ниже, а кнопки снимают с себя фокус
    // сразу после клика (см. blur в конце файла).
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (info.open && e.key !== 'Escape') return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      popUndo();
      return;
    }
    if (e.key === 'e' || e.key === 'E') return setEraser(!eraser);
    if (e.key === 'b' || e.key === 'B') return setEraser(false);
    if (e.key === 'r' || e.key === 'R') return setHair(!hairMode);
    if (e.key === 'm' || e.key === 'M') return setNudgeFrame(!nudgeFrame);
    if (e.key === ' ') { e.preventDefault(); return setPlaying(!playing); }
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
      if (nudgeFrame) {
        // Двигаем ПОСАДКУ на этом кадре, а не пиксели: рисунок один на все
        // кадры, а сидеть в замахе он может иначе, чем в покое.
        const [ox, oy] = offsetOf(activeCell);
        pushUndo();
        setOffset(activeCell, ox + d[0], oy + d[1]);
        renderCell(activeCell);
        renderPreview();
        updateOffsetNote();
        dirty();
      } else {
        nudge(activeCell, d[0], d[1]);
      }
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
    const widths = def.slot === 'body' ? [16, 12, 12, 16] : [16, 13, 13, 16];
    const lift = def.slot === 'body' ? 0 : -2; // шлем сидит на макушке
    DIRS.forEach((_, di) => {
      const ctx = layers[di].getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, CELL, CELL);
      const w = widths[di];
      const h = Math.max(1, Math.round((ico.h / ico.w) * w));
      ctx.drawImage(iconSheets[ico.sheet], ico.x, ico.y, ico.w, ico.h, Math.round(16 - w / 2), Math.round(16 - h / 2) + lift, w, h);
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
    masks.forEach((m) => m.getContext('2d')!.clearRect(0, 0, CELL, CELL));
    // Поправки кадров есть далеко не у всех — их отсутствие норма.
    offsets = {};
    try {
      const r = await fetch(`assets/worn/offset/${id}.json?t=${Date.now()}`);
      if (r.ok) offsets = (await r.json()) as typeof offsets;
    } catch {
      /* нет файла — посадка чисто по якорю */
    }

    // Маска нужна не каждому шлему, поэтому её отсутствие — норма, а не ошибка.
    try {
      const mimg = await load(`assets/worn/mask/${id}.png?t=${Date.now()}`);
      DIRS.forEach((_, di) => masks[di].getContext('2d')!.drawImage(mimg, di * 32, 0, 32, 32, 0, 0, 32, 32));
    } catch {
      /* маски нет — значит из-под этого шлема ничего не торчит */
    }
    // У нагрудника ластика по волосам нет: маска вырезает голову, а он до неё
    // не достаёт. Переключаемся на кисть, чтобы инструмент в руке был рабочий.
    if (hairMode && ITEMS[id]?.slot !== 'helm') setHair(false);
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
    setPose(refSheet, refCol); // подпись кадра и референс под новый предмет
    renderAll();
    renderPreview();
    updateHairNote();
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

    // Маска — второй полосой. Пустую не шлём вовсе: тогда сервер сотрёт файл,
    // и «Clear hair» + «Save» честно означают «маски у этого шлема больше нет».
    const maskStrip = document.createElement('canvas');
    maskStrip.width = CELL * 4;
    maskStrip.height = CELL;
    const mctx = maskStrip.getContext('2d')!;
    masks.forEach((m, di) => mctx.drawImage(m, di * CELL, 0));
    const hasMask = mctx.getImageData(0, 0, CELL * 4, CELL).data.some((v, i) => i % 4 === 3 && v > 0);

    // Пустая полоса — это НЕ «нет брони», это «броня, которую не видно».
    // Игра, найдя файл, выключает фолбэк-перекраску (helmetize), и предмет
    // пропадает с героя совсем. Отличить такое сохранение от случайного Clear
    // невозможно, поэтому спрашиваем.
    const hasPixels = ctx.getImageData(0, 0, CELL * 4, CELL).data.some((v, i) => i % 4 === 3 && v > 0);
    if (!hasPixels && !confirm('The strip is empty. Saving it makes the item invisible in the game — the palette fallback stops working. Save anyway?')) {
      return;
    }

    const btn = $<HTMLButtonElement>('h-save');
    btn.disabled = true; // второй клик слал бы второй POST поверх первого
    note.textContent = 'saving…';
    note.className = 'note';
    try {
      const r = await fetch('/__save-helm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: currentId,
          png: strip.toDataURL('image/png'),
          mask: hasMask ? maskStrip.toDataURL('image/png') : null,
          // Пустую таблицу шлём как null — сервер тогда сотрёт файл, и
          // «Reset all» + «Save» честно означают «поправок у вещи больше нет».
          offsets: Object.keys(offsets).length ? offsets : null,
        }),
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
    } catch (err) {
      // Дев-сервер упал или сеть отвалилась. Без этого «saving…» висело бы
      // вечно, и владелец считал бы работу сохранённой.
      note.textContent = `not saved: ${(err as Error).message} — is the dev server running?`;
      note.className = 'note bad';
    } finally {
      btn.disabled = false;
    }
  };
  $<HTMLButtonElement>('h-reload').onclick = () => {
    if (isDirty && !confirm('Discard unsaved changes and reload?')) return;
    void loadHelm(selItem.value);
  };

  window.addEventListener('beforeunload', (e) => {
    if (isDirty) e.preventDefault();
  });

  /**
   * Кнопка отпускает фокус сразу после клика.
   *
   * Браузер оставляет фокус на нажатой кнопке, и дальше клавиатура принадлежит
   * ей: пробел «нажимает» её повторно, а стрелки в неё же и уходят. В
   * рисовалке это ломает главное — стрелки и пробел должны править холст, а не
   * последнюю тронутую кнопку.
   */
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b && !info.contains(b)) b.blur();
  });

  swEls[7].click(); // стартовый цвет — сталь
  await loadHelm(selItem.value);
}
