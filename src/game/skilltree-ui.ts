import {
  SKILL_TREE,
  BRANCH_NAME,
  rankOf,
  unlocked,
  canAllocate,
  unspentSkill,
  type SkillBranch,
  type SkillNode,
  type SkillRanks,
} from './skilltree';

/**
 * Окно дерева навыков (клавиша L).
 *
 * Три ветви столбцами (Сила / Ловкость / Выживание), в каждой узлы идут сверху
 * вниз по зависимостям. Игрок вкладывает очки навыков (дают за уровень) в узлы;
 * можно/нельзя решает чистая canAllocate (skilltree.ts) — окно только рисует и
 * шлёт «вложить сюда».
 *
 * Отдельно от окна «Умения» (U): там простая раздача характеристик, здесь —
 * ветвящееся дерево пассивных навыков. Рисуется DOM-ом той же рамой набора.
 */

const UI = 'assets/interface/ui';
/** Только целый масштаб: на дробном пиксели рамки поехали бы. */
const S = 3;

/** Цвет ветви — рамкой узла и заголовком столбца. */
const BRANCH_COLOR: Record<SkillBranch, string> = {
  power: '#c0563a',
  agility: '#3f8f4a',
  survival: '#3a72c0',
};

const BRANCHES: SkillBranch[] = ['power', 'agility', 'survival'];

/** Итог навыка при данном ранге — человеческой строкой. У каждого узла один эффект. */
function effectTotal(node: SkillNode, rank: number): string {
  const p = node.per;
  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  if (p.dmg) return `+${p.dmg * rank} к урону`;
  if (p.rangedDmg) return `+${p.rangedDmg * rank} к урону лука`;
  if (p.speed) return `+${p.speed * rank} к скорости`;
  if (p.mp) return `+${p.mp * rank} к мане`;
  if (p.hp) return `+${p.hp * rank} к здоровью`;
  if (p.def) return `+${p.def * rank} к защите`;
  if (p.critChance) return `+${pct(p.critChance * rank)} шанс крита`;
  if (p.critMul) return `+${pct(p.critMul * rank)} к урону крита`;
  if (p.lifesteal) return `${pct(p.lifesteal * rank)} вампиризма`;
  return '';
}

const CSS = `
  #skilltree {
    position: absolute; inset: 0; z-index: 21; display: none;
    align-items: center; justify-content: center;
    font: 12px/1.4 'Survival Kit', system-ui, sans-serif; color: #f0e0c8;
    pointer-events: none;
  }
  #skilltree.open { display: flex; }
  #skilltree * { image-rendering: pixelated; }

  #skilltree .win {
    pointer-events: auto; position: relative; width: 500px; max-width: 95vw;
    border-image: url(${UI}/window.png) 16 5 5 5 fill / ${16 * S}px ${5 * S}px ${5 * S}px ${5 * S}px repeat;
    border-width: ${16 * S}px ${5 * S}px ${5 * S}px ${5 * S}px; border-style: solid;
    padding: 2px 14px 10px;
    filter: drop-shadow(0 14px 40px rgba(0,0,0,.6));
  }
  #skilltree .title {
    position: absolute; top: -${13 * S}px; left: 0; right: 0; text-align: center;
    font-weight: 700; font-size: 14px; letter-spacing: .1em; text-transform: uppercase;
    color: #eaf6f0; text-shadow: 1px 1px 0 #294040;
  }
  #skilltree .close {
    position: absolute; top: -${13 * S}px; right: 0;
    width: ${9 * S}px; height: ${9 * S}px; cursor: pointer;
    background: url(${UI}/close.png) no-repeat center / 100% 100%;
  }
  #skilltree .close:hover { filter: brightness(1.25); }

  #skilltree .free {
    text-align: center; font-size: 13px; margin: 2px 0 9px; color: #d8c0a0;
  }
  #skilltree .free b { font-size: 16px; color: #ffcf5a; }
  #skilltree .free.none b { color: #8a6a3a; }

  #skilltree .cols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  #skilltree .col { display: flex; flex-direction: column; gap: 8px; }
  #skilltree .bhead {
    text-align: center; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
    padding-bottom: 3px; border-bottom: 2px solid currentColor;
  }

  /* Узел на светлой странице набора. */
  #skilltree .node {
    position: relative; padding: 6px 7px;
    border-image: url(${UI}/panel_beige.png) 2 5 5 5 fill / ${2 * S}px ${5 * S}px ${5 * S}px ${5 * S}px repeat;
    border-width: ${2 * S}px ${5 * S}px ${5 * S}px ${5 * S}px; border-style: solid;
    color: #2b1d12;
  }
  #skilltree .node.locked { filter: grayscale(.7) brightness(.92); opacity: .8; }
  #skilltree .node .nm { font-size: 12px; font-weight: 700; display: flex; justify-content: space-between; gap: 6px; }
  #skilltree .node .nm .rk { font-variant-numeric: tabular-nums; color: #6b4f2a; }
  #skilltree .node .pips { display: flex; gap: 3px; margin: 4px 0 3px; }
  #skilltree .node .pip { width: 8px; height: 8px; border-radius: 2px; background: #b79b74; box-shadow: inset 0 0 0 1px rgba(0,0,0,.25); }
  #skilltree .node .pip.on { background: #ffcf5a; box-shadow: inset 0 0 0 1px #8a6a2a; }
  #skilltree .node .desc { font-size: 10px; color: #5a4020; line-height: 1.35; min-height: 26px; }
  #skilltree .node .desc .tot { color: #2f7a2f; font-weight: 700; }
  #skilltree .node .req { font-size: 10px; color: #a33b2e; margin-top: 2px; }

  /* Кнопка «+» — своя CSS-кнопка с рамкой, как в других окнах. */
  #skilltree .node .add {
    width: 100%; margin-top: 5px; cursor: pointer; text-align: center;
    padding: 5px 6px; font-size: 12px; font-weight: 700; color: #eaf6f0; text-shadow: 1px 1px 0 #294040;
    background: #50a978; border: 2px solid #294040; border-radius: 3px;
    box-shadow: inset 0 2px 0 #74cf8d, inset 0 -2px 0 #3f7168;
  }
  #skilltree .node .add:hover { filter: brightness(1.1); }
  #skilltree .node .add:active { box-shadow: inset 0 2px 4px rgba(0,0,0,.4); }
  #skilltree .node .add.off {
    cursor: default; color: #a08a6a; background: #b79b74; border-color: #6b5433;
    box-shadow: none; filter: none;
  }

  #skilltree .hint { margin-top: 9px; font-size: 11px; color: #6b5433; text-align: center; }
`;

/** Что окно знает о герое. Сцена отдаёт живые данные, окно только рисует. */
export interface SkillTreeHero {
  level: number;
  ranks: SkillRanks;
}

export class SkillTreeUi {
  private root: HTMLDivElement;
  private style: HTMLStyleElement;
  private free: HTMLElement;
  private cols: HTMLElement;
  private hero: (() => SkillTreeHero) | null = null;
  private key = '';

  /** Игрок вложил ранг в узел. */
  onAllocate: (nodeId: string) => void = () => {};

  constructor() {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.append(this.style);

    this.root = document.createElement('div');
    this.root.id = 'skilltree';
    this.root.innerHTML = `
      <div class="win">
        <div class="title">Дерево навыков</div>
        <div class="close" title="Закрыть (L)"></div>
        <div class="free"></div>
        <div class="cols"></div>
        <div class="hint">Очки навыков дают за уровень — по одному.<br>Вложенное сразу работает в бою. Сброса пока нет — выбирай с умом.</div>
      </div>
    `;
    document.body.append(this.root);

    this.free = this.root.querySelector('.free')!;
    this.cols = this.root.querySelector('.cols')!;
    this.root.querySelector('.close')!.addEventListener('click', () => this.close());
  }

  setHero(get: () => SkillTreeHero): void {
    this.hero = get;
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.root.classList.add('open');
    this.render();
  }

  close(): void {
    this.root.classList.remove('open');
  }

  /** Перерисовать, если что-то изменилось (уровень мог подрасти в бою). */
  render(): void {
    if (!this.isOpen) return;
    const h = this.hero?.();
    if (!h) return;

    const left = unspentSkill(h.level, h.ranks);
    const key = `${left}|${SKILL_TREE.map((n) => rankOf(h.ranks, n.id)).join(',')}`;
    if (key === this.key) return;
    this.key = key;

    this.free.innerHTML = `Очки навыков: <b>${left}</b>`;
    this.free.classList.toggle('none', left <= 0);

    this.cols.innerHTML = '';
    for (const branch of BRANCHES) {
      const col = document.createElement('div');
      col.className = 'col';
      col.style.color = BRANCH_COLOR[branch];

      const head = document.createElement('div');
      head.className = 'bhead';
      head.textContent = BRANCH_NAME[branch];
      col.append(head);

      for (const node of SKILL_TREE.filter((n) => n.branch === branch)) {
        col.append(this.nodeEl(node, h));
      }
      this.cols.append(col);
    }
  }

  private nodeEl(node: SkillNode, h: SkillTreeHero): HTMLElement {
    const rank = rankOf(h.ranks, node.id);
    const open = unlocked(node, h.ranks);
    const can = canAllocate(node.id, h.ranks, h.level);
    const maxed = rank >= node.maxRank;

    const el = document.createElement('div');
    el.className = `node${open ? '' : ' locked'}`;

    const pips = Array.from({ length: node.maxRank }, (_, i) => `<span class="pip${i < rank ? ' on' : ''}"></span>`).join('');
    const total = rank > 0 ? ` · <span class="tot">${effectTotal(node, rank)}</span>` : '';
    const req = !open && node.requires
      ? `<div class="req">Требует: ${nodeName(node.requires.node)} (${node.requires.rank})</div>`
      : '';

    el.innerHTML =
      `<div class="nm" style="color:#2b1d12"><span>${node.name}</span><span class="rk">${rank}/${node.maxRank}</span></div>` +
      `<div class="pips">${pips}</div>` +
      `<div class="desc">${node.desc} за ранг${total}</div>` +
      req;

    const btn = document.createElement('div');
    btn.className = `add${can ? '' : ' off'}`;
    btn.textContent = maxed ? 'Макс' : open ? '+ Вложить' : 'Закрыто';
    if (can) btn.onclick = () => this.onAllocate(node.id);
    el.append(btn);

    return el;
  }

  destroy(): void {
    this.root.remove();
    this.style.remove();
  }
}

/** Имя узла по id — для строки требования. */
function nodeName(id: string): string {
  return SKILL_TREE.find((n) => n.id === id)?.name ?? id;
}
