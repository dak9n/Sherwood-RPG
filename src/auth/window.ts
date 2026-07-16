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

const CSS = `
  #auth {
    position: fixed; inset: 0; z-index: 100;
    display: flex; align-items: center; justify-content: center;
    background: #14181b; background-image: radial-gradient(circle at 50% 30%, #223038, #14181b 70%);
    font: 14px/1.5 system-ui, sans-serif; color: #cfd8dc;
  }
  #auth .card {
    width: 320px; max-width: 92vw; background: #20272b;
    border: 1px solid #0d1114; border-radius: 8px;
    box-shadow: 0 16px 50px rgba(0,0,0,.6); padding: 22px;
  }
  #auth h1 { margin: 0 0 2px; font-size: 20px; color: #eaf0f2; }
  #auth .sub { margin: 0 0 18px; color: #8a9aa4; font-size: 13px; }
  #auth .tabs { display: flex; gap: 4px; margin-bottom: 16px; }
  #auth .tab {
    flex: 1; padding: 7px; text-align: center; cursor: pointer;
    background: #2a3237; border: 1px solid #0d1114; border-radius: 4px; color: #b7c2c8;
  }
  #auth .tab[aria-selected="true"] { background: #4a7a3f; border-color: #63a354; color: #fff; }
  #auth label { display: block; margin: 10px 0 3px; color: #8a9aa4; font-size: 12px; }
  #auth input {
    width: 100%; box-sizing: border-box; font: inherit; padding: 8px 10px;
    background: #12171a; color: #eaf0f2; border: 1px solid #3a464d; border-radius: 4px;
  }
  #auth input:focus { outline: none; border-color: #63a354; }
  #auth .go {
    width: 100%; margin-top: 16px; padding: 9px; font: inherit; font-weight: 600; cursor: pointer;
    background: #4a7a3f; color: #fff; border: 1px solid #63a354; border-radius: 4px;
  }
  #auth .go:hover { background: #55893f; }
  #auth .go:disabled { opacity: .5; cursor: default; }
  #auth .msg { min-height: 18px; margin-top: 10px; font-size: 13px; color: #e2705f; text-align: center; }
  #auth .hint { margin-top: 14px; font-size: 11px; color: #6b7c85; text-align: center; line-height: 1.5; }
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
      <div class="card">
        <h1>Лес</h1>
        <p class="sub">Войдите или создайте героя, чтобы начать.</p>
        <div class="tabs">
          <div class="tab" data-mode="login">Вход</div>
          <div class="tab" data-mode="register">Регистрация</div>
        </div>
        <label>Имя</label>
        <input class="name" autocomplete="username" maxlength="20" />
        <label>Пароль</label>
        <input class="pw" type="password" autocomplete="current-password" maxlength="200" />
        <button class="go"></button>
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
      goEl.textContent = mode === 'login' ? 'Войти' : 'Создать героя';
      pwEl.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
      hintEl.textContent =
        mode === 'register'
          ? 'Имя от 3 символов, пароль от 6. Пароль хранится на сервере только в зашифрованном виде.'
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
        msgEl.textContent = 'Заполните имя и пароль';
        return;
      }

      busy = true;
      goEl.disabled = true;
      msgEl.style.color = '#8a9aa4';
      msgEl.textContent = 'Минуту…';

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
      msgEl.textContent = r.error ?? 'Не получилось';
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
      font: 11px/1 system-ui, sans-serif; color: #cfd8dc;
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
  el.innerHTML = `<span><b class="nm"></b></span><span class="out" title="Выйти из аккаунта">выйти</span>`;
  el.querySelector<HTMLElement>('.nm')!.textContent = name;
  el.querySelector<HTMLElement>('.out')!.onclick = onLogout;
  document.body.append(el);
}
