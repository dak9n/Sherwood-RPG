/**
 * Чат слева, как в MMORPG. Открыт всегда: системные события (уровни, добыча,
 * бой) текут сами, а игрок может написать в поле внизу.
 *
 * Пока игра одиночная и локальная, «чат» — это эхо своих же строк. Честно: это
 * не общий чат с другими игроками (их пока нет), а лента событий и заметок.
 * Появится настоящий сервер — сюда придут и чужие сообщения.
 *
 * Клавиатура: пока игрок печатает, игровые клавиши глушатся (см. onFocusChange),
 * иначе WASD разом и ходят, и печатаются. Enter в поле — отправить и вернуться
 * в игру; Enter в игре — встать в поле; Escape — выйти из поля.
 */

/** Канал сообщения — для вкладок-фильтров. */
type Channel = 'sys' | 'chat';

interface Line {
  channel: Channel;
  html: string;
}

/** Больше не храним: старое всё равно уезжает вверх за пределы окна. */
const MAX_LINES = 120;

const CSS = `
  #chat {
    position: absolute; left: 10px; bottom: 12px; z-index: 16;
    width: 320px; max-width: 42vw;
    display: flex; flex-direction: column;
    font: 12px/1.45 'Survival Kit', system-ui, sans-serif;
    pointer-events: none;
  }
  #chat .tabs { display: flex; gap: 4px; margin-bottom: 4px; pointer-events: auto; }
  #chat .tab {
    cursor: pointer; font-size: 11px; font-weight: 600; color: #c9b59a;
    padding: 3px 10px; border-radius: 4px 4px 0 0;
    background: rgba(20,16,12,.55); border: 1px solid rgba(0,0,0,.4); border-bottom: none;
  }
  #chat .tab:hover { color: #eee; }
  #chat .tab[aria-selected="true"] { color: #ffe08a; background: rgba(40,30,18,.8); }

  #chat .log {
    pointer-events: auto;
    height: 168px; overflow-y: auto; overscroll-behavior: contain;
    padding: 6px 8px; color: #e6ddc8;
    background: rgba(16,13,10,.56); border: 1px solid rgba(0,0,0,.45); border-radius: 4px;
    text-shadow: 1px 1px 0 rgba(0,0,0,.6);
  }
  #chat .log::-webkit-scrollbar { width: 8px; }
  #chat .log::-webkit-scrollbar-thumb { background: rgba(138,106,72,.7); border-radius: 4px; }
  #chat .log::-webkit-scrollbar-track { background: transparent; }
  #chat .ln { margin: 1px 0; word-wrap: break-word; }
  #chat .ln .who { color: #7fd0ff; font-weight: 700; }
  #chat .ln.sys { color: #d8c68f; }
  #chat .ln.sys .tag { color: #9a8a5a; }

  #chat .inputrow { display: flex; margin-top: 4px; pointer-events: auto; }
  #chat .prompt {
    flex: 1; box-sizing: border-box; font: inherit; padding: 6px 9px; color: #f0e6d0;
    background: rgba(16,13,10,.78); border: 1px solid rgba(0,0,0,.5); border-radius: 4px;
    outline: none;
  }
  #chat .prompt:focus { border-color: #63a354; background: rgba(20,26,18,.85); }
  #chat .prompt::placeholder { color: #8a7d64; }
`;

export class ChatUi {
  private root: HTMLDivElement;
  private style: HTMLStyleElement;
  private logEl: HTMLElement;
  private input: HTMLInputElement;
  private tabsEl: HTMLElement;
  private lines: Line[] = [];
  private filter: 'all' | Channel = 'all';
  private onKeyToFocus: (e: KeyboardEvent) => void;

  /** Игрок отправил сообщение. Сцена решает, что с ним делать (пока — эхо). */
  onSend: (text: string) => void = () => {};
  /** Игрок начал/закончил печатать: сцена глушит игровые клавиши, пока true. */
  onFocusChange: (typing: boolean) => void = () => {};

  constructor() {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.append(this.style);

    this.root = document.createElement('div');
    this.root.id = 'chat';
    this.root.innerHTML = `
      <div class="tabs">
        <div class="tab" data-f="all">Всё</div>
        <div class="tab" data-f="sys">Система</div>
        <div class="tab" data-f="chat">Чат</div>
      </div>
      <div class="log"></div>
      <div class="inputrow">
        <input class="prompt" maxlength="200" placeholder="Enter — написать…" />
      </div>
    `;
    document.body.append(this.root);

    this.logEl = this.root.querySelector('.log')!;
    this.input = this.root.querySelector('.prompt')!;
    this.tabsEl = this.root.querySelector('.tabs')!;

    for (const t of this.tabsEl.querySelectorAll<HTMLElement>('.tab')) {
      t.onclick = () => {
        this.filter = t.dataset.f as 'all' | Channel;
        this.renderTabs();
        this.renderLog();
      };
    }

    // Печатаем — глушим игру; закончили — вернули управление.
    this.input.addEventListener('focus', () => this.onFocusChange(true));
    this.input.addEventListener('blur', () => this.onFocusChange(false));
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // до Phaser эти нажатия доходить не должны
      if (e.key === 'Enter') {
        const text = this.input.value.trim();
        this.input.value = '';
        if (text) this.onSend(text);
        this.input.blur();
      } else if (e.key === 'Escape') {
        this.input.value = '';
        this.input.blur();
      }
    });

    // Enter в игре — встать в поле ввода. Слушаем на документе (не Phaser),
    // чтобы работало, даже когда игровая клавиатура ещё включена.
    this.onKeyToFocus = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter') return;
      const active = document.activeElement;
      const typingElsewhere =
        active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLButtonElement;
      if (typingElsewhere) return;
      e.preventDefault();
      this.input.focus();
    };
    document.addEventListener('keydown', this.onKeyToFocus);

    this.renderTabs();
  }

  /** Системная строка: уровень, добыча, бой, кузница. */
  system(msg: string): void {
    this.add('sys', `<span class="tag">[Система]</span> ${escapeHtml(msg)}`);
  }

  /** Реплика игрока в чат. */
  local(name: string, msg: string): void {
    this.add('chat', `<span class="who">${escapeHtml(name || 'Ты')}:</span> ${escapeHtml(msg)}`);
  }

  private add(channel: Channel, html: string): void {
    this.lines.push({ channel, html });
    if (this.lines.length > MAX_LINES) this.lines.shift();
    // Дорисовываем только новую строку, если она проходит фильтр, — не гоняем
    // весь лог каждый раз. Прокручиваем вниз, только если уже были внизу.
    const atBottom = this.logEl.scrollTop + this.logEl.clientHeight >= this.logEl.scrollHeight - 4;
    if (this.filter === 'all' || this.filter === channel) {
      this.logEl.append(this.lineEl(channel, html));
      while (this.logEl.childElementCount > MAX_LINES) this.logEl.firstElementChild?.remove();
      if (atBottom) this.logEl.scrollTop = this.logEl.scrollHeight;
    }
  }

  private lineEl(channel: Channel, html: string): HTMLElement {
    const el = document.createElement('div');
    el.className = `ln ${channel}`;
    el.innerHTML = html;
    return el;
  }

  private renderTabs(): void {
    for (const t of this.tabsEl.querySelectorAll<HTMLElement>('.tab')) {
      t.setAttribute('aria-selected', String(t.dataset.f === this.filter));
    }
  }

  private renderLog(): void {
    this.logEl.innerHTML = '';
    for (const l of this.lines) {
      if (this.filter === 'all' || this.filter === l.channel) this.logEl.append(this.lineEl(l.channel, l.html));
    }
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  destroy(): void {
    document.removeEventListener('keydown', this.onKeyToFocus);
    this.root.remove();
    this.style.remove();
  }
}

/** Экранируем всё, что идёт в innerHTML: имя и текст — от игрока, тегам там не место. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
