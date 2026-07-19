import { cleanName, MAX_NAME } from '../game/save';

/**
 * Экран создания героя — после входа, до старта игры.
 *
 * Пока класс один — Мечник. Карточка класса выбрана и показана, а рядом честная
 * приписка, что другие классы будут позже (заказчик так и сказал). Игрок
 * придумывает ник — он покажется над персонажем и в чате.
 *
 * Возвращает промис с ником и классом. Рама — та же, что у окна входа и сумки.
 */

const UI = 'assets/interface/ui';
const S = 3;

/** Кадр мечника анфас — тот же, что в панели персонажа и окне входа. */
const HERO = {
  sheet: 'assets/characters/PNG/Swordsman_lvl1/With_shadow/Swordsman_lvl1_Idle_with_shadow.png',
  x: 19, y: 20, w: 20, h: 27, zoom: 3,
};

/** Классы. Пока один; массив — чтобы добавить остальные строкой, а не переписью. */
const CLASSES = [{ id: 'swordsman', label: 'Swordsman', hint: 'Melee, sturdy health' }];

const CSS = `
  #charwin {
    position: fixed; inset: 0; z-index: 100;
    display: flex; align-items: center; justify-content: center;
    background: radial-gradient(circle at 50% 35%, #2a3a2c, #12100c 72%);
    font: 14px/1.5 'Simplified Gothic', system-ui, sans-serif; color: #f0e0c8;
  }
  #charwin * { image-rendering: pixelated; }
  #charwin i { display: block; }

  #charwin .win {
    position: relative; width: 340px; max-width: 92vw;
    border-image: url(${UI}/window.png) 16 5 5 5 fill / ${16 * S}px ${5 * S}px ${5 * S}px ${5 * S}px repeat;
    border-width: ${16 * S}px ${5 * S}px ${5 * S}px ${5 * S}px; border-style: solid;
    padding: 2px 16px 8px;
    filter: drop-shadow(0 14px 40px rgba(0,0,0,.6));
  }
  #charwin .title {
    position: absolute; top: -${13 * S}px; left: 0; right: 0; text-align: center;
    font-weight: 700; font-size: 15px; letter-spacing: .08em; text-transform: uppercase;
    color: #eaf6f0; text-shadow: 1px 1px 0 #294040;
  }
  #charwin .sub { margin: 2px 0 10px; text-align: center; font-size: 12px; color: #d8c0a0; }

  /* Ряд карточек классов. Выбранная — золотой рамкой. */
  #charwin .classes { display: flex; gap: 8px; justify-content: center; margin-bottom: 8px; }
  #charwin .cls {
    width: 96px; cursor: pointer; text-align: center;
    background: rgba(20,14,9,.35); border: 2px solid #3e1f1d; border-radius: 5px; padding: 6px 4px 5px;
  }
  #charwin .cls[aria-selected="true"] { border-color: #ffcf5a; box-shadow: 0 0 10px rgba(255,207,90,.4); }
  #charwin .cls .portrait {
    width: ${HERO.w * HERO.zoom + 12}px; height: ${HERO.h * HERO.zoom + 8}px; margin: 0 auto 5px;
    position: relative; overflow: hidden; background: #7aad55;
    border: ${S}px solid #3e1f1d; box-shadow: inset 0 0 0 ${S}px #70492a;
    display: flex; align-items: flex-end; justify-content: center;
  }
  #charwin .cls .portrait i {
    width: ${HERO.w}px; height: ${HERO.h}px; margin-bottom: 3px;
    background: url(${HERO.sheet}) -${HERO.x}px -${HERO.y}px;
    transform: scale(${HERO.zoom}); transform-origin: bottom center;
  }
  #charwin .cls .nm { font-size: 13px; font-weight: 700; color: #ffe08a; }
  #charwin .cls .h { font-size: 10px; color: #c9b59a; line-height: 1.35; margin-top: 2px; }
  #charwin .soon {
    width: 96px; display: flex; align-items: center; justify-content: center; text-align: center;
    border: 2px dashed #5a4026; border-radius: 5px; color: #7a6a52; font-size: 11px; padding: 6px;
  }

  #charwin .page {
    border-image: url(${UI}/panel_beige.png) 2 5 5 5 fill / ${2 * S}px ${5 * S}px ${5 * S}px ${5 * S}px repeat;
    border-width: ${2 * S}px ${5 * S}px ${5 * S}px ${5 * S}px; border-style: solid;
    padding: ${2 * S}px;
  }
  #charwin label { display: block; margin: 0 0 4px; color: #6b4f2a; font-size: 12px; }
  #charwin input {
    width: 100%; box-sizing: border-box; font: inherit; padding: 8px 9px; color: #f0e0c8;
    background: #241811; border: 2px solid #70492a; border-radius: 2px; image-rendering: auto;
  }
  #charwin input:focus { outline: none; border-color: #63a354; }

  #charwin .go {
    width: 100%; margin-top: 14px; cursor: pointer; font: inherit; font-weight: 700; font-size: 15px;
    padding: ${2 * S}px 8px; color: #eaf6f0; text-shadow: 1px 1px 0 #294040;
    border-image: url(${UI}/button.png) 4 3 3 3 fill / ${4 * S}px ${3 * S}px ${3 * S}px ${3 * S}px repeat;
    border-width: ${4 * S}px ${3 * S}px ${3 * S}px ${3 * S}px; border-style: solid;
  }
  #charwin .go:hover { filter: brightness(1.12); }
  #charwin .go:active { transform: translateY(1px); }
  #charwin .go:disabled { filter: grayscale(.5) brightness(.8); cursor: default; }

  #charwin .msg { min-height: 16px; margin-top: 8px; font-size: 12px; color: #e2705f; text-align: center; }
`;

export function showCharacterCreate(): Promise<{ name: string; class: string }> {
  return new Promise((resolve) => {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);

    const root = document.createElement('div');
    root.id = 'charwin';
    root.innerHTML = `
      <div class="win">
        <div class="title">Create Hero</div>
        <p class="sub">Choose a class and name your hero.</p>
        <div class="classes">
          ${CLASSES.map(
            (c, i) => `
            <div class="cls" data-class="${c.id}" aria-selected="${i === 0}">
              <div class="portrait"><i></i></div>
              <div class="nm">${c.label}</div>
              <div class="h">${c.hint}</div>
            </div>`,
          ).join('')}
          <div class="soon">More classes — soon</div>
        </div>
        <div class="page">
          <label>Hero name</label>
          <input class="name" maxlength="${MAX_NAME}" autocomplete="off" placeholder="e.g. Aragorn" />
          <button class="go">Begin!</button>
        </div>
        <div class="msg"></div>
      </div>
    `;
    document.body.append(root);

    const nameEl = root.querySelector<HTMLInputElement>('.name')!;
    const goEl = root.querySelector<HTMLButtonElement>('.go')!;
    const msgEl = root.querySelector<HTMLDivElement>('.msg')!;
    const cards = [...root.querySelectorAll<HTMLDivElement>('.cls')];

    let chosen = CLASSES[0].id;
    for (const card of cards) {
      card.onclick = () => {
        chosen = card.dataset.class!;
        for (const c of cards) c.setAttribute('aria-selected', String(c === card));
        nameEl.focus();
      };
    }

    const submit = (): void => {
      const name = cleanName(nameEl.value);
      if (name.length < 2) {
        msgEl.textContent = 'Name must be at least 2 characters';
        nameEl.focus();
        return;
      }
      style.remove();
      root.remove();
      resolve({ name, class: chosen });
    };

    goEl.onclick = submit;
    nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });

    nameEl.focus();
  });
}
