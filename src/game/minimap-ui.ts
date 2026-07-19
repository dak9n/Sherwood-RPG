import { toMinimap, insideCircle, fitScale } from './minimap';
import { bakeMap, type Baked, type ImageFor } from './minimap-bake';
import type { GameMap } from '../map/types';

/**
 * Круглая мини-карта справа сверху и полная карта на M.
 *
 * Как и остальной интерфейс, рисуется DOM-ом поверх канваса: камера игры
 * увеличена втрое, и всё, что живёт в сцене, раздулось бы вместе с ней.
 *
 * Рама — настоящее кольцо из набора (character_panel.png), вырезанное
 * tools/cut-ui.mjs. Отдельного кольца в наборе нет: оно срослось с полосой
 * здоровья, поэтому справа у него остаётся основание этой полосы — читается
 * как крепление.
 */

/** Кольцо 30x30, стенка 4px. Увеличиваем впятеро: в исходном виде дырка 22px. */
const RING = { src: 30, wall: 4, scale: 5 } as const;
const FRAME = RING.src * RING.scale; // 150
const HOLE = (RING.src - RING.wall * 2) * RING.scale; // 110
const HOLE_AT = RING.wall * RING.scale; // 20

/** Во сколько раз мир ужат в кружке. 0.3 -> в окошко влезает ~23 тайла. */
const MINI_SCALE = 0.3;

const DOT = { player: '#f4e4c1', monster: '#e05c4a', loot: '#e0c48a' } as const;

const CSS = `
  #mm {
    position: absolute; right: 12px; top: 12px; z-index: 10;
    width: ${FRAME}px; height: ${FRAME}px;
    /* Мини-карта — табло, а не кнопка: клики должны уходить в игру. */
    pointer-events: none;
    font: 10px/1 'MedievalSharp', system-ui, sans-serif;
  }
  /* Дырка кольца: всё, что вылезает за круг, срезается. */
  #mm .hole {
    position: absolute; left: ${HOLE_AT}px; top: ${HOLE_AT}px;
    width: ${HOLE}px; height: ${HOLE}px;
    border-radius: 50%; overflow: hidden;
    background: #1b2a17;
  }
  #mm .hole canvas {
    position: absolute; left: 0; top: 0;
    transform-origin: 0 0; image-rendering: pixelated;
  }
  #mm .ring {
    position: absolute; inset: 0;
    background: url(assets/interface/ui/ring.png) no-repeat 0 0 / 100% 100%;
    image-rendering: pixelated;
  }
  #mm .dot {
    position: absolute; width: 4px; height: 4px; border-radius: 50%;
    margin: -2px 0 0 -2px; pointer-events: none;
  }
  #mm .dot.me {
    width: 6px; height: 6px; margin: -3px 0 0 -3px;
    background: ${DOT.player}; box-shadow: 0 0 0 1px #2b1d12;
  }

  /* --- Полная карта (M) --- */
  #mmfull {
    position: absolute; inset: 0; z-index: 21; display: none;
    align-items: center; justify-content: center;
    background: rgba(12, 16, 20, .72);
    font: 12px/1 'MedievalSharp', system-ui, sans-serif; color: #e5d6a1;
    /* Игра не на паузе — мимо карты клики уходят в неё. */
    pointer-events: none;
  }
  #mmfull.open { display: flex; }
  #mmfull .win {
    pointer-events: auto; position: relative;
    border-image: url(assets/interface/ui/panel_dark.png) 2 3 4 3 fill / 6px 9px 12px 9px repeat;
    border-width: 6px 9px 12px 9px; border-style: solid;
    image-rendering: pixelated;
  }
  #mmfull .plate { position: relative; display: block; background: #1b2a17; }
  #mmfull canvas { display: block; transform-origin: 0 0; image-rendering: pixelated; }
  #mmfull .dot { position: absolute; width: 5px; height: 5px; border-radius: 50%; margin: -2.5px 0 0 -2.5px; }
  #mmfull .dot.me { width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px; background: ${DOT.player}; box-shadow: 0 0 0 2px #2b1d12; }
  #mmfull .tip {
    position: absolute; left: 0; right: 0; bottom: -22px; text-align: center;
    text-shadow: 1px 1px 0 #000;
  }
`;

/** Что показываем точками. Сцена отдаёт живые координаты каждый кадр. */
export interface Marks {
  player: { x: number; y: number };
  monsters: { x: number; y: number }[];
  loot: { x: number; y: number }[];
}

export class MinimapUi {
  private root: HTMLDivElement;
  private full: HTMLDivElement;
  private style: HTMLStyleElement;
  private hole: HTMLDivElement;
  private plate: HTMLDivElement;
  private baked: Baked;
  private fullScale = 1;
  /** Кружки переиспользуем: создавать их заново каждый кадр — мусор для сборщика. */
  private miniDots: HTMLDivElement[] = [];
  private fullDots: HTMLDivElement[] = [];

  constructor(map: GameMap, imageFor: ImageFor) {
    this.baked = bakeMap(map, imageFor);

    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.append(this.style);

    this.root = document.createElement('div');
    this.root.id = 'mm';
    this.root.innerHTML = `<div class="hole"></div><div class="ring"></div>`;
    document.body.append(this.root);

    this.hole = this.root.querySelector('.hole')!;
    this.hole.prepend(this.baked.canvas);
    this.baked.canvas.style.transform = `scale(${MINI_SCALE})`;

    this.full = document.createElement('div');
    this.full.id = 'mmfull';
    this.full.innerHTML = `<div class="win"><div class="plate"></div><div class="tip">M — close</div></div>`;
    document.body.append(this.full);
    this.plate = this.full.querySelector('.plate')!;
  }

  get isFullOpen(): boolean {
    return this.full.classList.contains('open');
  }

  toggleFull(): void {
    if (this.isFullOpen) {
      this.full.classList.remove('open');
      this.root.style.visibility = '';
      return;
    }

    // Кружок прячем: холст у окон общий, и в кружке всё равно осталась бы дырка.
    // Да и смотреть на него поверх полной карты незачем.
    this.root.style.visibility = 'hidden';

    // Отпечаток один на оба окна, поэтому при открытии переносим холст к себе,
    // а при закрытии возвращаем в кружок. Копия стоила бы ещё одной картинки
    // размером с карту.
    //
    // Больше единицы не увеличиваем: карта пиксельная, и дробное увеличение
    // размажет её в кашу. Меньше 200px окно не считаем — иначе поля съели бы
    // его в ноль и масштаб ушёл бы в минус.
    this.fullScale = Math.min(
      1,
      fitScale(
        this.baked.width,
        this.baked.height,
        Math.max(200, window.innerWidth - 120),
        Math.max(200, window.innerHeight - 120),
      ),
    );
    this.plate.style.width = `${Math.round(this.baked.width * this.fullScale)}px`;
    this.plate.style.height = `${Math.round(this.baked.height * this.fullScale)}px`;
    this.plate.prepend(this.baked.canvas);
    this.baked.canvas.style.transform = `scale(${this.fullScale})`;
    this.full.classList.add('open');
  }

  private closeFullCanvasBack(): void {
    if (this.baked.canvas.parentElement === this.hole) return;
    this.hole.prepend(this.baked.canvas);
    this.baked.canvas.style.transform = `scale(${MINI_SCALE})`;
  }

  /** Даёт нужное число кружков, лишние прячет. */
  private dots(pool: HTMLDivElement[], host: HTMLElement, need: number): HTMLDivElement[] {
    while (pool.length < need) {
      const el = document.createElement('div');
      el.className = 'dot';
      host.append(el);
      pool.push(el);
    }
    for (let i = need; i < pool.length; i++) pool[i].style.display = 'none';
    return pool;
  }

  render(marks: Marks): void {
    if (this.isFullOpen) this.renderFull(marks);
    else {
      this.closeFullCanvasBack();
      this.renderMini(marks);
    }
  }

  private renderMini(marks: Marks): void {
    const { x: px, y: py } = marks.player;
    // Отпечаток обрезан по нарисованному, поэтому все мировые точки сдвигаем.
    const cx = px - this.baked.originX;
    const cy = py - this.baked.originY;

    // Двигаем не кружок вокруг карты, а карту под кружком: игрок прибит к центру.
    this.baked.canvas.style.transform =
      `translate(${HOLE / 2 - cx * MINI_SCALE}px, ${HOLE / 2 - cy * MINI_SCALE}px) scale(${MINI_SCALE})`;

    const list = [
      ...marks.monsters.map((m) => ({ p: m, kind: 'monster' as const })),
      ...marks.loot.map((l) => ({ p: l, kind: 'loot' as const })),
    ];
    const pool = this.dots(this.miniDots, this.hole, list.length + 1);

    for (let i = 0; i < list.length; i++) {
      const { p, kind } = list[i];
      // Сдвиг отпечатка тут сокращается: и точка, и игрок мировые.
      const at = toMinimap(p.x, p.y, px, py, HOLE, MINI_SCALE);
      const el = pool[i];
      // За круг не рисуем: там рама, и точка повисла бы поверх дерева.
      if (!insideCircle(at.x, at.y, HOLE, 3)) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = '';
      el.className = 'dot';
      el.style.background = DOT[kind];
      el.style.left = `${at.x}px`;
      el.style.top = `${at.y}px`;
    }

    const me = pool[list.length];
    me.style.display = '';
    me.className = 'dot me';
    me.style.left = `${HOLE / 2}px`;
    me.style.top = `${HOLE / 2}px`;
  }

  private renderFull(marks: Marks): void {
    const s = this.fullScale;
    // Отпечаток обрезан по нарисованному — мировые точки сдвигаем к его углу.
    const at = (p: { x: number; y: number }) => ({
      left: `${(p.x - this.baked.originX) * s}px`,
      top: `${(p.y - this.baked.originY) * s}px`,
    });

    const list = [
      ...marks.monsters.map((m) => ({ p: m, kind: 'monster' as const })),
      ...marks.loot.map((l) => ({ p: l, kind: 'loot' as const })),
    ];
    const pool = this.dots(this.fullDots, this.plate, list.length + 1);

    for (let i = 0; i < list.length; i++) {
      const { p, kind } = list[i];
      const el = pool[i];
      el.style.display = '';
      el.className = 'dot';
      el.style.background = DOT[kind];
      Object.assign(el.style, at(p));
    }

    const me = pool[list.length];
    me.style.display = '';
    me.className = 'dot me';
    Object.assign(me.style, at(marks.player));
  }

  destroy(): void {
    this.root.remove();
    this.full.remove();
    this.style.remove();
  }
}
