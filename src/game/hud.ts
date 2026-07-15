/**
 * Панель героя слева сверху: портрет, здоровье, мана, опыт.
 *
 * Рисуется DOM-ом поверх канваса, а не средствами Phaser. Причина простая:
 * камера игры увеличена втрое, и всё, что рисуется внутри сцены, увеличивается
 * вместе с ней — интерфейс раздулся бы втрое, а цифры на пиксельном
 * увеличении превратились бы в кашу.
 *
 * Кладём именно ПОВЕРХ канваса (position: absolute), а не колонкой рядом, как
 * панель редактора: та ужимает канвас, и сцене приходится пересчитывать камеру.
 */

const UI = 'assets/craftpix-net-255216-free-basic-pixel-art-ui-for-rpg/PNG/character_panel.png';

/**
 * Раскладка внутри character_panel.png (измерено по пикселям).
 *
 * В листе панель нарисована дважды: слева пустая, справа — с полными полосками.
 * Берём пустую как фон, а куски полосок из правой — как заполнение. Полоски
 * разной длины не по прихоти: панель сужается к хвосту, и рисунок это учитывает.
 */
const PANEL = { x: 2, y: 2, w: 84, h: 30 };
const FILLED = { x: 98, y: 2 };
const BARS = {
  hp: { x: 30, y: 8, w: 52, h: 2 },
  mp: { x: 32, y: 13, w: 43, h: 2 },
  xp: { x: 32, y: 18, w: 37, h: 2 },
} as const;

/** Во сколько раз увеличить панель: в исходном виде она 84x30 и нечитаема. */
const SCALE = 3;

const CSS = `
  #hud {
    position: absolute; inset: 0; z-index: 10;
    /* Иначе невидимый слой съест все клики по игре. */
    pointer-events: none;
    font: 10px/1 monospace; color: #f4e4c1;
    text-shadow: 1px 1px 0 #000;
  }
  #hud .panel {
    position: absolute; left: 12px; top: 12px;
    width: ${PANEL.w}px; height: ${PANEL.h}px;
    background-image: url(${UI});
    background-position: -${PANEL.x}px -${PANEL.y}px;
    image-rendering: pixelated;
    transform: scale(${SCALE});
    transform-origin: top left;
  }
  #hud .fill {
    position: absolute; height: 2px;
    background-image: url(${UI});
    image-rendering: pixelated;
    /* Ширина, а не scaleX: полоска склеена из пиксельного рисунка, и растягивать
       её нельзя — торцы поедут. Обрезаем. */
    transition: width .12s linear;
    overflow: hidden;
  }
  #hud .lvl {
    position: absolute; left: 12px; top: ${12 + PANEL.h * SCALE + 4}px;
    font-size: 11px;
  }
  #hud .nums {
    position: absolute; left: ${12 + PANEL.w * SCALE + 8}px; top: 16px;
    display: flex; flex-direction: column; gap: 6px;
    font-variant-numeric: tabular-nums;
  }
  #hud .nums .hp { color: #e05c4a; }
  #hud .nums .mp { color: #5ba3e0; }
  #hud .death {
    position: absolute; inset: 0; display: none;
    align-items: center; justify-content: center;
    background: rgba(20,0,0,.55); font-size: 28px; letter-spacing: .1em; color: #e05c4a;
  }
  #hud.dead .death { display: flex; }
`;

export class Hud {
  private root: HTMLDivElement;
  private style: HTMLStyleElement;
  private fills: Record<'hp' | 'mp' | 'xp', HTMLDivElement>;
  private lvlEl: HTMLDivElement;
  private hpNum: HTMLSpanElement;
  private mpNum: HTMLSpanElement;
  private last = '';

  constructor() {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.append(this.style);

    this.root = document.createElement('div');
    this.root.id = 'hud';

    const bar = (kind: keyof typeof BARS) => {
      const b = BARS[kind];
      // Кусок полоски берём из правой (заполненной) панели листа.
      return `<div class="fill ${kind}" style="left:${b.x}px; top:${b.y}px;
        background-position:-${FILLED.x + b.x}px -${FILLED.y + b.y}px"></div>`;
    };

    this.root.innerHTML = `
      <div class="panel">
        ${bar('hp')}${bar('mp')}${bar('xp')}
      </div>
      <div class="lvl">ур. 1</div>
      <div class="nums">
        <span class="hp"></span><span class="mp"></span>
      </div>
      <div class="death">ТЫ ПОГИБ</div>
    `;
    document.body.append(this.root);

    this.fills = {
      hp: this.root.querySelector('.fill.hp')!,
      mp: this.root.querySelector('.fill.mp')!,
      xp: this.root.querySelector('.fill.xp')!,
    };
    this.lvlEl = this.root.querySelector('.lvl')!;
    this.hpNum = this.root.querySelector('.nums .hp')!;
    this.mpNum = this.root.querySelector('.nums .mp')!;
  }

  set(hp: number, hpMax: number, mp: number, mpMax: number, level: number, xp = 0, xpNext = 1): void {
    // Трогаем DOM, только когда есть что менять: set зовётся каждый кадр.
    const key = `${Math.ceil(hp)}/${hpMax}/${Math.floor(mp)}/${mpMax}/${level}/${Math.floor(xp)}`;
    if (key === this.last) return;
    this.last = key;

    const frac = (v: number, max: number) => Math.max(0, Math.min(1, v / max));
    this.fills.hp.style.width = `${BARS.hp.w * frac(hp, hpMax)}px`;
    this.fills.mp.style.width = `${BARS.mp.w * frac(mp, mpMax)}px`;
    this.fills.xp.style.width = `${BARS.xp.w * frac(xp, xpNext)}px`;

    this.lvlEl.textContent = `ур. ${level}`;
    this.hpNum.textContent = `${Math.ceil(Math.max(0, hp))}/${hpMax}`;
    this.mpNum.textContent = `${Math.floor(Math.max(0, mp))}/${mpMax}`;
  }

  showDeath(on: boolean): void {
    this.root.classList.toggle('dead', on);
  }

  /** Иначе при перезапуске сцены на экране окажется два интерфейса. */
  destroy(): void {
    this.root.remove();
    this.style.remove();
  }
}
