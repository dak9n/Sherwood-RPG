/**
 * Полоски здоровья и маны слева сверху.
 *
 * Рисуются DOM-ом поверх канваса, а не средствами Phaser. Причина простая:
 * камера игры увеличена втрое, и всё, что рисуется внутри сцены, увеличивается
 * вместе с ней — интерфейс раздулся бы втрое, а цифры на пиксельном
 * увеличении превратились бы в кашу.
 *
 * Кладём именно ПОВЕРХ канваса (position: absolute), а не колонкой рядом, как
 * панель редактора: та ужимает канвас, и сцене приходится пересчитывать камеру.
 */

const CSS = `
  #hud {
    position: absolute; inset: 0; z-index: 10;
    /* Иначе невидимый слой съест все клики по игре. */
    pointer-events: none;
    font: 11px/1 system-ui, sans-serif; color: #fff;
    text-shadow: 0 1px 2px #000;
  }
  #hud .panel { position: absolute; left: 14px; top: 14px; display: flex; gap: 8px; }
  #hud .portrait {
    width: 44px; height: 44px; border-radius: 4px;
    background: #2b3a24 linear-gradient(160deg, #4a6b3c, #223018);
    border: 2px solid #14200f; box-shadow: 0 2px 6px rgba(0,0,0,.5);
  }
  #hud .bars { display: flex; flex-direction: column; gap: 4px; justify-content: center; }
  #hud .bar {
    position: relative; width: 190px; height: 14px;
    background: #10151a; border: 1px solid #05080a; border-radius: 7px;
    box-shadow: inset 0 1px 2px rgba(0,0,0,.8), 0 1px 0 rgba(255,255,255,.06);
    overflow: hidden;
  }
  #hud .fill {
    position: absolute; inset: 0;
    transform-origin: left center;
    /* Заполняем через scaleX, а не width: это не заставляет браузер
       пересчитывать разметку каждый кадр. Градиент вертикальный — scaleX его не растянет. */
    transition: transform .12s linear;
  }
  #hud .hp .fill { background: linear-gradient(#e05c4a, #a32b1e); }
  #hud .mp .fill { background: linear-gradient(#4aa3e0, #1e5aa3); }
  #hud .num {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    font-variant-numeric: tabular-nums; font-size: 10px;
  }
  #hud .lvl {
    position: absolute; left: 0; top: 48px; width: 44px; text-align: center;
    font-size: 10px; color: #d8c07a;
  }
  #hud .death {
    position: absolute; inset: 0; display: none;
    align-items: center; justify-content: center;
    background: rgba(20,0,0,.55); font-size: 28px; letter-spacing: .1em; color: #e05c4a;
  }
  #hud.dead .death { display: flex; }
`;

export class Hud {
  private root: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private mpFill: HTMLDivElement;
  private hpNum: HTMLSpanElement;
  private mpNum: HTMLSpanElement;
  private lvlEl: HTMLDivElement;
  private style: HTMLStyleElement;
  private last = '';

  constructor() {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.append(this.style);

    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="panel">
        <div>
          <div class="portrait"></div>
          <div class="lvl">ур. 1</div>
        </div>
        <div class="bars">
          <div class="bar hp"><div class="fill"></div><span class="num"></span></div>
          <div class="bar mp"><div class="fill"></div><span class="num"></span></div>
        </div>
      </div>
      <div class="death">ТЫ ПОГИБ</div>
    `;
    document.body.append(this.root);

    this.hpFill = this.root.querySelector('.hp .fill')!;
    this.mpFill = this.root.querySelector('.mp .fill')!;
    this.hpNum = this.root.querySelector('.hp .num')!;
    this.mpNum = this.root.querySelector('.mp .num')!;
    this.lvlEl = this.root.querySelector('.lvl')!;
  }

  set(hp: number, hpMax: number, mp: number, mpMax: number, level: number): void {
    // Трогаем DOM, только когда есть что менять: set зовётся каждый кадр.
    const key = `${Math.ceil(hp)}/${hpMax}/${Math.floor(mp)}/${mpMax}/${level}`;
    if (key === this.last) return;
    this.last = key;

    this.hpFill.style.transform = `scaleX(${Math.max(0, hp) / hpMax})`;
    this.mpFill.style.transform = `scaleX(${Math.max(0, mp) / mpMax})`;
    this.hpNum.textContent = `${Math.ceil(Math.max(0, hp))} / ${hpMax}`;
    this.mpNum.textContent = `${Math.floor(Math.max(0, mp))} / ${mpMax}`;
    this.lvlEl.textContent = `ур. ${level}`;
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
