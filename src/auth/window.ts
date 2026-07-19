import { login, register } from './client';

/**
 * Окно входа при запуске игры.
 *
 * Возвращает промис, который решится именем игрока, когда тот войдёт или
 * зарегистрируется. Пока не вошёл — окно не закрыть: без аккаунта игре нечего
 * показывать (так решил заказчик, выбрав настоящие аккаунты).
 *
 * Поле пароля — честное <input type="password">, значение уходит на сервер по
 * первому же запросу и в браузере не оседает. Никакой «проверки пароля» на
 * клиенте: это была бы имитация защиты.
 */

// Куски рамы из нашего набора — те же, что в окне инвентаря. Тянутся
// девятислайсом (border-image), поэтому окно любого размера собирается без швов.
const UI = 'assets/interface/ui';
/** Масштаб рамки окна. Только целый: на дробном пиксели поехали бы. */
const S = 3;
/** Кадр мечника анфас для портрета — тот же, что в панели персонажа. */
const HERO = {
  sheet: 'assets/characters/PNG/Swordsman_lvl1/With_shadow/Swordsman_lvl1_Idle_with_shadow.png',
  x: 19, y: 20, w: 20, h: 27, zoom: 3,
};

const CSS = `
  #auth {
    position: fixed; inset: 0; z-index: 100;
    display: flex; align-items: center; justify-content: center;
    background: radial-gradient(circle at 50% 35%, #2a3a2c, #12100c 72%);
    font: 14px/1.5 'Survival Kit', system-ui, sans-serif; color: #f0e0c8;
  }
  #auth * { image-rendering: pixelated; }
  #auth i, #auth img { display: block; }

  /* Окно целиком — кусок набора: зелёная шапка и коричневое тело одной рамой. */
  #auth .win {
    position: relative; width: 300px; max-width: 92vw;
    border-image: url(${UI}/window.png) 16 5 5 5 fill / ${16 * S}px ${5 * S}px ${5 * S}px ${5 * S}px repeat;
    border-width: ${16 * S}px ${5 * S}px ${5 * S}px ${5 * S}px; border-style: solid;
    padding: 2px 16px 6px;
    filter: drop-shadow(0 14px 40px rgba(0,0,0,.6));
  }
  /* Заголовок ложится на зелёную шапку, уже нарисованную в рамке окна. */
  #auth .title {
    position: absolute; top: -${13 * S}px; left: 0; right: 0; text-align: center;
    font-weight: 700; font-size: 16px; letter-spacing: .1em; text-transform: uppercase;
    color: #eaf6f0; text-shadow: 1px 1px 0 #294040;
  }
  #auth .sub { margin: 0 0 12px; text-align: center; font-size: 12px; color: #d8c0a0; }

  /* Портрет героя — тот же приём, что в панели персонажа: спрайт на цвете травы. */
  #auth .portrait {
    width: ${HERO.w * HERO.zoom + 16}px; height: ${HERO.h * HERO.zoom + 10}px;
    margin: 2px auto 10px; position: relative; overflow: hidden;
    background: #7aad55; border: ${S}px solid #3e1f1d; box-shadow: inset 0 0 0 ${S}px #70492a;
    display: flex; align-items: flex-end; justify-content: center;
  }
  #auth .portrait i {
    width: ${HERO.w}px; height: ${HERO.h}px; margin-bottom: 4px;
    background: url(${HERO.sheet}) -${HERO.x}px -${HERO.y}px;
    transform: scale(${HERO.zoom}); transform-origin: bottom center;
  }

  /* Вкладки — свои CSS-кнопки, а не куски набора: у тех вкладок низ открыт
     (рассчитан на панель под ними) и висел обрезанным. Здесь рамка со ВСЕХ
     сторон, а объём даёт двойная внутренняя тень — светлая сверху, тёмная снизу,
     как фаска на пиксельной кнопке. Цвета — из набора: зелёный #50a978 у
     выбранной, коричневый #825c2f у прочих. */
  #auth .tabs { display: flex; gap: 6px; margin-bottom: 8px; }
  #auth .tab {
    flex: 1; text-align: center; cursor: pointer;
    padding: 9px 6px; font-size: 12px; font-weight: 600; color: #e6d3b0;
    background: #825c2f; border: 2px solid #3e1f1d; border-radius: 3px;
    box-shadow: inset 0 2px 0 #9c7040, inset 0 -3px 0 #5f3d22;
    text-shadow: 1px 1px 0 rgba(0,0,0,.35);
  }
  #auth .tab:hover { filter: brightness(1.08); }
  #auth .tab:active { box-shadow: inset 0 2px 4px rgba(0,0,0,.35); }
  #auth .tab[aria-selected="true"] {
    color: #eaf6f0; background: #50a978; border-color: #294040;
    box-shadow: inset 0 2px 0 #74cf8d, inset 0 -3px 0 #3f7168;
    text-shadow: 1px 1px 0 #294040;
  }

  /* Светлая страница под вкладками — та же, что держит сетку сумки в инвентаре. */
  #auth .page {
    border-image: url(${UI}/panel_beige.png) 2 5 5 5 fill / ${2 * S}px ${5 * S}px ${5 * S}px ${5 * S}px repeat;
    border-width: ${2 * S}px ${5 * S}px ${5 * S}px ${5 * S}px; border-style: solid;
    padding: ${2 * S}px ${2 * S}px;
  }
  #auth label { display: block; margin: 6px 0 3px; color: #6b4f2a; font-size: 12px; }
  #auth .page label:first-child { margin-top: 2px; }
  #auth input {
    width: 100%; box-sizing: border-box; font: inherit; padding: 7px 9px; color: #f0e0c8;
    background: #241811; border: 2px solid #70492a; border-radius: 2px;
    image-rendering: auto;
  }
  #auth input:focus { outline: none; border-color: #63a354; }

  /* Кнопка — зелёная из набора, той же рамой, что и в инвентаре. */
  #auth .go {
    width: 100%; margin-top: 16px; cursor: pointer; font: inherit; font-weight: 700; font-size: 14px;
    padding: ${2 * S}px 8px; color: #eaf6f0; text-shadow: 1px 1px 0 #294040;
    border-image: url(${UI}/button.png) 4 3 3 3 fill / ${4 * S}px ${3 * S}px ${3 * S}px ${3 * S}px repeat;
    border-width: ${4 * S}px ${3 * S}px ${3 * S}px ${3 * S}px; border-style: solid;
  }
  #auth .go:hover { filter: brightness(1.12); }
  #auth .go:active { transform: translateY(1px); }
  #auth .go:disabled { filter: grayscale(.5) brightness(.8); cursor: default; }

  #auth .msg { min-height: 16px; margin-top: 8px; font-size: 13px; color: #e2705f; text-align: center; }
  #auth .hint { font-size: 11px; color: #9a835f; text-align: center; line-height: 1.5; }
  #auth .hint:not(:empty) { margin-top: 8px; }
`;

type Mode = 'login' | 'register';

export function showAuthWindow(): Promise<string> {
  return new Promise((resolve) => {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);

    const root = document.createElement('div');
    root.id = 'auth';
    root.innerHTML = `
      <div class="win">
        <div class="title">Forest</div>
        <div class="portrait"><i></i></div>
        <p class="sub">Log in or create a hero to begin.</p>
        <div class="tabs">
          <div class="tab" data-mode="login">Log in</div>
          <div class="tab" data-mode="register">Register</div>
        </div>
        <div class="page">
          <label>Name</label>
          <input class="name" autocomplete="username" maxlength="20" />
          <label>Password</label>
          <input class="pw" type="password" autocomplete="current-password" maxlength="200" />
          <button class="go"></button>
        </div>
        <div class="msg"></div>
        <div class="hint"></div>
      </div>
    `;
    document.body.append(root);

    const q = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
    const nameEl = q<HTMLInputElement>('.name');
    const pwEl = q<HTMLInputElement>('.pw');
    const goEl = q<HTMLButtonElement>('.go');
    const msgEl = q<HTMLDivElement>('.msg');
    const hintEl = q<HTMLDivElement>('.hint');
    const tabs = [...root.querySelectorAll<HTMLDivElement>('.tab')];

    let mode: Mode = 'login';
    let busy = false;

    const applyMode = (): void => {
      for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.mode === mode));
      goEl.textContent = mode === 'login' ? 'Log in' : 'Create Hero';
      pwEl.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
      hintEl.textContent =
        mode === 'register'
          ? 'Name from 3 characters, password from 6. The password is stored on the server only in encrypted form.'
          : '';
      msgEl.textContent = '';
    };

    for (const t of tabs) {
      t.onclick = () => {
        mode = t.dataset.mode as Mode;
        applyMode();
        nameEl.focus();
      };
    }

    const submit = async (): Promise<void> => {
      if (busy) return;
      const name = nameEl.value.trim();
      const pw = pwEl.value;
      if (!name || !pw) {
        msgEl.textContent = 'Enter name and password';
        return;
      }

      busy = true;
      goEl.disabled = true;
      msgEl.style.color = '#8a9aa4';
      msgEl.textContent = 'One moment…';

      const r = mode === 'login' ? await login(name, pw) : await register(name, pw);

      if (r.ok && r.name) {
        style.remove();
        root.remove();
        resolve(r.name);
        return;
      }

      busy = false;
      goEl.disabled = false;
      msgEl.style.color = '#e2705f';
      msgEl.textContent = r.error ?? 'Something went wrong';
      pwEl.select();
    };

    goEl.onclick = () => void submit();
    for (const el of [nameEl, pwEl]) {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') void submit();
      });
    }

    applyMode();
    nameEl.focus();
  });
}

/** Маленькая плашка «вошёл как …» с выходом. Иначе аккаунт не сменить. */
export function showAccountBadge(name: string, onLogout: () => void): void {
  const style = document.createElement('style');
  style.textContent = `
    #acc {
      position: fixed; left: 10px; bottom: 8px; z-index: 15;
      font: 11px/1 'Survival Kit', system-ui, sans-serif; color: #cfd8dc;
      display: flex; align-items: center; gap: 6px;
      background: rgba(20,24,27,.72); padding: 4px 8px; border-radius: 4px;
      user-select: none;
    }
    #acc b { color: #e0c48a; }
    #acc .out { cursor: pointer; color: #8a9aa4; }
    #acc .out:hover { color: #e2705f; }
  `;
  document.head.append(style);

  const el = document.createElement('div');
  el.id = 'acc';
  el.innerHTML = `<span><b class="nm"></b></span><span class="out" title="Log out">log out</span>`;
  el.querySelector<HTMLElement>('.nm')!.textContent = name;
  el.querySelector<HTMLElement>('.out')!.onclick = onLogout;
  document.body.append(el);
}
