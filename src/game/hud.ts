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

const UI = 'assets/interface/PNG/character_panel.png';
/** Лист иконок — отсюда берём монету для счётчика золота. */
const ICONS = 'assets/interface/PNG/Icons.png';

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
  #hud .death {
    position: absolute; inset: 0; display: none;
    align-items: center; justify-content: center;
    background: rgba(20,0,0,.55); font-size: 28px; letter-spacing: .1em; color: #e05c4a;
  }
  #hud.dead .death { display: flex; }

  /* Счётчик золота под панелью героя: монета из набора и число. Тратится в
     магазине (O), падает с монстров. Только для взгляда — кликать нечем. */
  #hud .gold {
    position: absolute; left: 16px; top: ${12 + PANEL.h * SCALE + 6}px;
    display: flex; align-items: center; gap: 5px;
    font: 13px/1 monospace; color: #ffe08a;
    text-shadow: 1px 1px 0 #000, -1px 0 0 #000, 1px 0 0 #000, 0 1px 0 #000;
    background: rgba(20,24,27,.5); padding: 3px 9px 3px 6px; border-radius: 5px;
  }
  #hud .gold i {
    width: 16px; height: 16px; image-rendering: pixelated;
    background: url(${ICONS}) -0px -16px;
  }
`;

export class Hud {
  private root: HTMLDivElement;
  private style: HTMLStyleElement;
  private fills: Record<'hp' | 'mp' | 'xp', HTMLDivElement>;
  private goldEl!: HTMLSpanElement;
  private last = '';
  private lastGold = -1;

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
      <div class="gold"><i></i><span class="num">0</span></div>
      <div class="death">YOU DIED</div>
    `;
    document.body.append(this.root);

    this.fills = {
      hp: this.root.querySelector('.fill.hp')!,
      mp: this.root.querySelector('.fill.mp')!,
      xp: this.root.querySelector('.fill.xp')!,
    };
    this.goldEl = this.root.querySelector('.gold .num')!;
  }

  /** Обновить золото. Как и полоски — трогаем DOM только при изменении. */
  setGold(gold: number): void {
    if (gold === this.lastGold) return;
    this.lastGold = gold;
    this.goldEl.textContent = String(gold);
  }

  /**
   * Состояние героя показывают только полоски: длина читается с одного взгляда,
   * а цифры на экране лишь мешали смотреть на лес.
   */
  set(hp: number, hpMax: number, mp: number, mpMax: number, xp = 0, xpNext = 1): void {
    // Трогаем DOM, только когда есть что менять: set зовётся каждый кадр.
    const key = `${Math.ceil(hp)}/${hpMax}/${Math.floor(mp)}/${mpMax}/${Math.floor(xp)}/${xpNext}`;
    if (key === this.last) return;
    this.last = key;

    const frac = (v: number, max: number) => Math.max(0, Math.min(1, v / max));
    this.fills.hp.style.width = `${BARS.hp.w * frac(hp, hpMax)}px`;
    this.fills.mp.style.width = `${BARS.mp.w * frac(mp, mpMax)}px`;
    this.fills.xp.style.width = `${BARS.xp.w * frac(xp, xpNext)}px`;
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
