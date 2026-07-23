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
  if (p.dmg) return `+${p.dmg * rank} damage`;
  if (p.rangedDmg) return `+${p.rangedDmg * rank} bow damage`;
  if (p.speed) return `+${p.speed * rank} Speed`;
  if (p.mp) return `+${p.mp * rank} Mana`;
  if (p.hp) return `+${p.hp * rank} Health`;
  if (p.def) return `+${p.def * rank} Defense`;
  if (p.critChance) return `+${pct(p.critChance * rank)} crit chance`;
  if (p.critMul) return `+${pct(p.critMul * rank)} crit damage`;
  if (p.lifesteal) return `${pct(p.lifesteal * rank)} lifesteal`;
  return '';
}

const CSS = `
  #skilltree {
    position: absolute; inset: 0; z-index: 21; display: none;
    align-items: center; justify-content: center;
    font: var(--fs-body)/1.4 var(--font-family); color: var(--ink);
    pointer-events: none;
  }
  #skilltree.open { display: flex; }
  #skilltree * { image-rendering: pixelated; }

  #skilltree .win {
    pointer-events: auto; position: relative; width: 500px; max-width: 95vw;
    border-width: var(--frame-window-w); border-image: var(--frame-window); border-style: solid;
    padding: 2px 14px 10px;
    filter: drop-shadow(0 14px 40px var(--shadow-drop));
  }
  #skilltree .title {
    position: absolute; top: -${13 * S}px; left: 0; right: 0; text-align: center;
    font-weight: var(--fw-bold); font-size: var(--fs-lg); letter-spacing: .1em; text-transform: uppercase;
    color: var(--ink-bright); text-shadow: var(--text-shadow-teal);
  }
  #skilltree .close {
    position: absolute; top: -${13 * S}px; right: 0;
    width: ${9 * S}px; height: ${9 * S}px; cursor: pointer;
    background: url(${UI}/close.png) no-repeat center / 100% 100%;
  }
  #skilltree .close:hover { filter: brightness(1.25); }

  #skilltree .free {
    text-align: center; font-size: var(--fs-md); margin: 2px 0 9px; color: var(--tan);
  }
  #skilltree .free b { font-size: var(--fs-xl); color: var(--gold); }
  #skilltree .free.none b { color: #8a6a3a; }

  #skilltree .cols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  #skilltree .col { display: flex; flex-direction: column; gap: 8px; }
  #skilltree .bhead {
    text-align: center; font-size: var(--fs-body); font-weight: var(--fw-bold); text-transform: uppercase; letter-spacing: .05em;
    padding-bottom: 3px; border-bottom: 2px solid currentColor;
  }

  /* Узел на светлой странице набора. */
  #skilltree .node {
    position: relative; padding: 6px 7px;
    border-width: var(--frame-beige-w); border-image: var(--frame-beige); border-style: solid;
    color: var(--ink-dark);
  }
  #skilltree .node.locked { filter: grayscale(.7) brightness(.92); opacity: .8; }
  #skilltree .node .nm { font-size: var(--fs-body); font-weight: var(--fw-bold); display: flex; justify-content: space-between; gap: 6px; }
  #skilltree .node .nm .rk { font-variant-numeric: tabular-nums; color: #6b4f2a; }
  #skilltree .node .pips { display: flex; gap: 3px; margin: 4px 0 3px; }
  #skilltree .node .pip { width: 8px; height: 8px; border-radius: var(--radius-1); background: var(--disabled-bg); box-shadow: inset 0 0 0 1px rgba(0,0,0,.25); }
  #skilltree .node .pip.on { background: var(--gold); box-shadow: inset 0 0 0 1px #8a6a2a; }
  #skilltree .node .desc { font-size: var(--fs-tiny); color: var(--brown-text); line-height: 1.35; min-height: 26px; }
  #skilltree .node .desc .tot { color: #2f7a2f; font-weight: var(--fw-bold); }
  #skilltree .node .req { font-size: var(--fs-tiny); color: var(--danger); margin-top: 2px; }

  /* Кнопка «+» — своя CSS-кнопка с рамкой, как в других окнах. */
  #skilltree .node .add {
    width: 100%; margin-top: 5px; cursor: pointer; text-align: center;
    padding: 5px 6px; font-size: var(--fs-body); font-weight: var(--fw-bold); color: var(--ink-bright); text-shadow: var(--text-shadow-teal);
    background: var(--green); border: 2px solid var(--shadow-teal); border-radius: var(--radius-2);
    box-shadow: inset 0 2px 0 var(--green-hi), inset 0 -2px 0 var(--green-lo);
  }
  #skilltree .node .add:hover { filter: brightness(1.1); }
  #skilltree .node .add:active { box-shadow: inset 0 2px 4px rgba(0,0,0,.4); }
  #skilltree .node .add.off {
    cursor: default; color: var(--disabled-text); background: var(--disabled-bg); border-color: var(--disabled-border);
    box-shadow: none; filter: none;
  }

  #skilltree .hint { margin-top: 9px; font-size: var(--fs-small); color: var(--disabled-border); text-align: center; }
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
        <div class="title">Skill Tree</div>
        <div class="close" title="Close (L)"></div>
        <div class="free"></div>
        <div class="cols"></div>
        <div class="hint">Skill points are earned per level — one at a time.<br>What you invest works in combat right away. No reset yet — choose wisely.</div>
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

    this.free.innerHTML = `Skill points: <b>${left}</b>`;
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
      ? `<div class="req">Requires: ${nodeName(node.requires.node)} (${node.requires.rank})</div>`
      : '';

    el.innerHTML =
      `<div class="nm" style="color:var(--ink-dark)"><span>${node.name}</span><span class="rk">${rank}/${node.maxRank}</span></div>` +
      `<div class="pips">${pips}</div>` +
      `<div class="desc">${node.desc} per rank${total}</div>` +
      req;

    const btn = document.createElement('div');
    btn.className = `add${can ? '' : ' off'}`;
    btn.textContent = maxed ? 'Max' : open ? '+ Invest' : 'Locked';
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
