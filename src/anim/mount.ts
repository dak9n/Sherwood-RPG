/**
 * Редактор поз оружия (?anim). Правит src/game/weapon-anchors.json руками.
 *
 * Зачем: позы считает tools/weapon-anchors.mjs по слою меча, но автоматика знает
 * лишь то, что нарисовано, а на кадрах удара нарисован смазанный след — из него
 * поза жёсткого клинка не выводится точно. Последнее слово должно быть за глазом,
 * поэтому здесь можно взять любой кадр и поставить меч ровно так, как нравится.
 *
 * Рисуем обычным canvas 2D, а не движком: тут нужен ОДИН кадр под увеличением и
 * точное перетаскивание мышью, а не игровой цикл.
 *
 * Живёт только на дев-сервере: в собранную игру не попадает (см. main.ts).
 */

import { ITEMS } from '../game/items';

const PARTS = 'assets/characters/PNG/Swordsman_lvl1/Parts/';
const PREFIX = 'Swordsman_lvl1_';
const FRAME = 64;
/** Порядок рядов в листах набора. */
const DIRS = ['down', 'left', 'right', 'up'] as const;
/** Ключ анимации -> имя в файлах набора. */
const SHEETS: Record<string, string> = { idle: 'Idle', walk: 'Walk', attack: 'attack', death: 'Death' };
/** Слои безоружного героя, снизу вверх — как в игре. */
const BODY = ['shadow', 'body', 'head'] as const;

/** Клинок на иконке нарисован по диагонали вверх-вправо (-45°), рукоять — низ-лево. */
const ICON_BLADE_ANGLE = -45;
const ICON_BLADE_LEN = 34;
const ICON_GRIP = { x: 0.12, y: 0.88 };

interface Anchor { x: number; y: number; angle: number; len: number; behind?: boolean }
interface Table { bladeLen: number; anims: Record<string, { cols: number; rows: number; frames: (Anchor | null)[] }> }

const CSS = `
  body.anim-edit { margin: 0; background: #171c1f; color: #cfd8dc;
    font: 13px/1.5 system-ui, sans-serif; user-select: none; }
  /* Контейнер игры убираем совсем: Phaser тут не запускается, а пустой div на
     весь экран стоит в разметке ПЕРВЫМ и сдвигал бы редактор ниже сгиба —
     экран выглядел бы пустым, будто редактор не загрузился. */
  body.anim-edit #game { display: none; }
  #anim { position: fixed; inset: 0; display: grid; grid-template-columns: 1fr 300px; }
  /* Кадр может быть крупнее экрана при большом увеличении — пусть прокручивается
     внутри своей колонки, а не растягивает страницу. */
  #anim-stage { display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 12px; overflow: auto; padding: 12px; }
  #anim-canvas { image-rendering: pixelated; background: #10151a; border: 1px solid #0d1114; cursor: grab; }
  #anim-canvas.dragging { cursor: grabbing; }
  #anim-strip { display: flex; gap: 4px; flex-wrap: wrap; justify-content: center; max-width: 90%; }
  #anim-strip canvas { image-rendering: pixelated; background: #10151a; border: 2px solid #2b3439; cursor: pointer; }
  #anim-strip canvas.on { border-color: #63a354; }
  #anim-strip canvas.empty { opacity: .35; }
  #anim-side { background: #20272b; border-left: 1px solid #0d1114; padding: 12px; overflow-y: auto; }
  #anim h2 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #7d8f99; }
  #anim .row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
  #anim .row label { width: 76px; color: #9fb0ba; }
  #anim select, #anim input[type=number] {
    flex: 1; min-width: 0; font: inherit; color: #fff; background: #12171a;
    border: 1px solid #35424a; border-radius: 3px; padding: 3px 6px;
  }
  #anim input[type=range] { flex: 1; }
  #anim button {
    font: inherit; color: inherit; background: #2f383e; border: 1px solid #0d1114;
    border-radius: 3px; padding: 5px 10px; cursor: pointer;
  }
  #anim button:hover { background: #3a464d; }
  #anim button.primary { background: #4a7a3f; border-color: #63a354; }
  #anim .hint { color: #7d8f99; font-size: 12px; line-height: 1.45; margin: 8px 0 0; }
  #anim .note { min-height: 18px; font-size: 12px; margin-top: 6px; }
  #anim .note.ok { color: #8ad46a; } #anim .note.bad { color: #e0885a; }
  #anim hr { border: none; border-top: 1px solid #2b3439; margin: 12px 0; }
`;

/** Грузит картинку и ждёт готовности — canvas без этого рисует пустоту. */
const load = (src: string): Promise<HTMLImageElement> =>
  new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error(src));
    img.src = src;
  });

export async function mountAnimEditor(): Promise<void> {
  document.body.classList.add('anim-edit');
  document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));

  const table: Table = await (await fetch('/__anchors')).json();

  // Слои героя и иконки оружия — грузим разом, дальше рисуем синхронно.
  const parts: Record<string, HTMLImageElement> = {};
  await Promise.all(
    Object.entries(SHEETS).flatMap(([key, name]) =>
      BODY.map(async (p) => { parts[`${key}-${p}`] = await load(`${PARTS}${PREFIX}${name}_${p}.png`); }),
    ),
  );
  const weapons = Object.values(ITEMS).filter((d) => d.held);
  const icons: Record<string, HTMLImageElement> = {};
  await Promise.all(weapons.map(async (d) => { icons[d.id] = await load(d.held!); }));

  const root = document.createElement('div');
  root.id = 'anim';
  root.innerHTML = `
    <div id="anim-stage">
      <canvas id="anim-canvas"></canvas>
      <div id="anim-strip"></div>
    </div>
    <div id="anim-side">
      <h2>Animation</h2>
      <div class="row"><label>Animation</label><select id="a-anim"></select></div>
      <div class="row"><label>Facing</label><select id="a-dir"></select></div>
      <div class="row"><label>Weapon</label><select id="a-weapon"></select></div>
      <div class="row"><label>Zoom</label><input id="a-zoom" type="range" min="4" max="14" step="1"></div>
      <hr>
      <h2>Frame pose</h2>
      <div class="row"><label>X</label><input id="a-x" type="number" step="0.5"></div>
      <div class="row"><label>Y</label><input id="a-y" type="number" step="0.5"></div>
      <div class="row"><label>Angle</label><input id="a-angle" type="number" step="1"></div>
      <div class="row"><input id="a-angle-r" type="range" min="-180" max="180" step="1"></div>
      <div class="row"><label>Behind</label><input id="a-behind" type="checkbox"></div>
      <div class="row">
        <button id="a-hide">No weapon</button>
        <button id="a-copy">Copy</button>
        <button id="a-paste">Paste</button>
      </div>
      <hr>
      <h2>All frames</h2>
      <div class="row"><label>Blade len</label><input id="a-blade" type="number" step="0.1"></div>
      <div class="row">
        <button id="a-play">▶ Play</button>
        <button id="a-apply-row">Angle to row</button>
      </div>
      <hr>
      <div class="row">
        <button id="a-save" class="primary">Save</button>
        <button id="a-reload">Reload</button>
      </div>
      <div class="note" id="a-note"></div>
      <p class="hint">
        Drag the weapon to move the grip. Drag with the right button (or hold Shift)
        to rotate it. The frame strip below shows every frame of the chosen facing;
        click one to edit it. Saving writes weapon-anchors.json, with a backup.
      </p>
    </div>`;
  document.body.append(root);

  const $ = <T extends HTMLElement>(id: string): T => root.querySelector(`#${id}`) as T;
  const canvas = $<HTMLCanvasElement>('anim-canvas');
  const ctx = canvas.getContext('2d')!;
  const strip = $<HTMLDivElement>('anim-strip');
  const note = $<HTMLDivElement>('a-note');

  const selAnim = $<HTMLSelectElement>('a-anim');
  const selDir = $<HTMLSelectElement>('a-dir');
  const selWeapon = $<HTMLSelectElement>('a-weapon');
  for (const k of Object.keys(SHEETS)) selAnim.append(new Option(k, k));
  for (const d of DIRS) selDir.append(new Option(d, d));
  for (const w of weapons) selWeapon.append(new Option(w.name, w.id));
  selAnim.value = 'attack'; // ради него всё и затевалось

  let zoom = 8;
  let frame = 0; // индекс кадра в листе
  let playing = 0;
  let clipboard: Anchor | null = null;
  $<HTMLInputElement>('a-zoom').value = String(zoom);
  $<HTMLInputElement>('a-blade').value = String(table.bladeLen);

  const anim = (): { cols: number; rows: number; frames: (Anchor | null)[] } => table.anims[selAnim.value];
  const rowIndex = (): number => DIRS.indexOf(selDir.value as (typeof DIRS)[number]);
  const rowStart = (): number => rowIndex() * anim().cols;
  const current = (): Anchor | null => anim().frames[frame] ?? null;

  /** Рисует один кадр героя и оружие поверх — общий код для сцены и полосы кадров. */
  function drawFrame(c: CanvasRenderingContext2D, index: number, scale: number, showGuides: boolean): void {
    const a = anim();
    const col = index % a.cols;
    const row = Math.floor(index / a.cols);
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, FRAME * scale, FRAME * scale);

    const pose = a.frames[index] ?? null;
    const icon = icons[selWeapon.value];

    const drawWeapon = (): void => {
      if (!pose || !icon) return;
      const len = (table.bladeLen / ICON_BLADE_LEN) * icon.width;
      c.save();
      c.translate(pose.x * scale, pose.y * scale);
      c.rotate(((pose.angle - ICON_BLADE_ANGLE) * Math.PI) / 180);
      const s = (len / icon.width) * scale;
      c.drawImage(icon, -icon.width * ICON_GRIP.x * s, -icon.height * ICON_GRIP.y * s, icon.width * s, icon.height * s);
      c.restore();
    };

    // Порядок как в игре: за спиной — под героем, иначе поверх.
    if (pose?.behind) drawWeapon();
    for (const p of BODY) {
      const img = parts[`${selAnim.value}-${p}`];
      c.drawImage(img, col * FRAME, row * FRAME, FRAME, FRAME, 0, 0, FRAME * scale, FRAME * scale);
    }
    if (!pose?.behind) drawWeapon();

    if (showGuides && pose) {
      // Рукоять и направление клинка — чтобы видеть, за что тянешь.
      c.strokeStyle = '#63a354';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(pose.x * scale, pose.y * scale);
      const r = (pose.angle * Math.PI) / 180;
      c.lineTo((pose.x + Math.cos(r) * table.bladeLen) * scale, (pose.y + Math.sin(r) * table.bladeLen) * scale);
      c.stroke();
      c.fillStyle = '#e2705f';
      c.beginPath();
      c.arc(pose.x * scale, pose.y * scale, 4, 0, Math.PI * 2);
      c.fill();
    }
  }

  function renderStrip(): void {
    strip.textContent = '';
    const a = anim();
    for (let i = 0; i < a.cols; i++) {
      const index = rowStart() + i;
      const c = document.createElement('canvas');
      c.width = c.height = FRAME * 2;
      c.className = (index === frame ? 'on ' : '') + (a.frames[index] ? '' : 'empty');
      c.title = `frame ${i}`;
      drawFrame(c.getContext('2d')!, index, 2, false);
      c.onclick = () => { frame = index; render(); };
      strip.append(c);
    }
  }

  function syncInputs(): void {
    const p = current();
    const set = (id: string, v: number | null): void => {
      const el = $<HTMLInputElement>(id);
      el.value = v === null ? '' : String(Math.round(v * 10) / 10);
      el.disabled = v === null;
    };
    set('a-x', p ? p.x : null);
    set('a-y', p ? p.y : null);
    set('a-angle', p ? p.angle : null);
    const r = $<HTMLInputElement>('a-angle-r');
    r.value = String(p ? p.angle : 0);
    r.disabled = !p;
    const b = $<HTMLInputElement>('a-behind');
    b.checked = !!p?.behind;
    b.disabled = !p;
  }

  function render(): void {
    canvas.width = canvas.height = FRAME * zoom;
    drawFrame(ctx, frame, zoom, true);
    renderStrip();
    syncInputs();
  }

  /** Правка текущего кадра: единственный вход, чтобы всё перерисовывалось разом. */
  function edit(patch: Partial<Anchor>): void {
    const a = anim();
    const p = a.frames[frame];
    if (!p) return;
    a.frames[frame] = { ...p, ...patch };
    render();
    dirty();
  }

  let isDirty = false;
  function dirty(): void {
    isDirty = true;
    note.textContent = 'unsaved changes';
    note.className = 'note bad';
  }

  // --- Мышь: тянем рукоять, с правой кнопкой (или Shift) — вращаем ---
  let drag: 'move' | 'rotate' | null = null;
  const posOf = (e: MouseEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * FRAME, y: ((e.clientY - r.top) / r.height) * FRAME };
  };
  canvas.oncontextmenu = (e) => e.preventDefault();
  canvas.onmousedown = (e) => {
    if (!current()) return;
    drag = e.button === 2 || e.shiftKey ? 'rotate' : 'move';
    canvas.classList.add('dragging');
    canvas.onmousemove?.(e);
  };
  canvas.onmousemove = (e) => {
    if (!drag) return;
    const p = posOf(e);
    const cur = current();
    if (!cur) return;
    if (drag === 'move') edit({ x: p.x, y: p.y });
    else edit({ angle: Math.round((Math.atan2(p.y - cur.y, p.x - cur.x) * 180) / Math.PI) });
  };
  const stop = (): void => { drag = null; canvas.classList.remove('dragging'); };
  window.addEventListener('mouseup', stop);

  // --- Поля справа ---
  const num = (id: string, key: 'x' | 'y' | 'angle') => {
    $<HTMLInputElement>(id).oninput = (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      if (Number.isFinite(v)) edit({ [key]: v } as Partial<Anchor>);
    };
  };
  num('a-x', 'x'); num('a-y', 'y'); num('a-angle', 'angle');
  $<HTMLInputElement>('a-angle-r').oninput = (e) => edit({ angle: Number((e.target as HTMLInputElement).value) });
  $<HTMLInputElement>('a-behind').onchange = (e) => edit({ behind: (e.target as HTMLInputElement).checked });

  $<HTMLInputElement>('a-zoom').oninput = (e) => { zoom = Number((e.target as HTMLInputElement).value); render(); };
  $<HTMLInputElement>('a-blade').oninput = (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    if (v > 0) { table.bladeLen = v; render(); dirty(); }
  };
  selAnim.onchange = () => { frame = rowStart(); render(); };
  selDir.onchange = () => { frame = rowStart(); render(); };
  selWeapon.onchange = render;

  $('a-hide').onclick = () => {
    // Кадр без оружия: на некоторых кадрах меча и не должно быть видно.
    const a = anim();
    a.frames[frame] = a.frames[frame] ? null : { x: 32, y: 32, angle: 0, len: table.bladeLen };
    render();
    dirty();
  };
  $('a-copy').onclick = () => { clipboard = current(); note.textContent = 'pose copied'; note.className = 'note ok'; };
  $('a-paste').onclick = () => {
    if (!clipboard) return;
    anim().frames[frame] = { ...clipboard };
    render();
    dirty();
  };
  $('a-apply-row').onclick = () => {
    // Один угол на весь ряд — быстрый способ выровнять «стойку» по направлению.
    const cur = current();
    if (!cur) return;
    const a = anim();
    for (let i = 0; i < a.cols; i++) {
      const f = a.frames[rowStart() + i];
      if (f) a.frames[rowStart() + i] = { ...f, angle: cur.angle };
    }
    render();
    dirty();
  };

  $('a-play').onclick = () => {
    if (playing) { window.clearInterval(playing); playing = 0; $('a-play').textContent = '▶ Play'; return; }
    $('a-play').textContent = '❚❚ Stop';
    playing = window.setInterval(() => {
      const a = anim();
      frame = rowStart() + (((frame - rowStart()) + 1) % a.cols);
      render();
    }, 1000 / 16); // как в игре: 16 кадров в секунду
  };

  $('a-save').onclick = async () => {
    note.textContent = 'saving…';
    note.className = 'note';
    const r = await fetch('/__save-anchors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(table),
    });
    const j = await r.json().catch(() => ({ ok: false, error: 'bad response' }));
    if (j.ok) { isDirty = false; note.textContent = 'saved'; note.className = 'note ok'; }
    else { note.textContent = `not saved: ${j.error ?? r.status}`; note.className = 'note bad'; }
  };
  $('a-reload').onclick = () => {
    if (isDirty && !confirm('Discard unsaved changes and reload the saved poses?')) return;
    location.reload();
  };

  window.addEventListener('beforeunload', (e) => {
    if (isDirty) e.preventDefault();
  });

  frame = rowStart();
  render();
  note.textContent = 'loaded';
  note.className = 'note ok';
}
