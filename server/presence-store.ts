/**
 * Кто сейчас онлайн и где стоит. Чистое состояние без сети — сеть в online.ts.
 *
 * Ключ — аккаунт (или гостевой ключ в dev), не соединение: переподключение
 * того же игрока замещает старую запись, а не плодит двойника. Позиции живут
 * только в памяти — это эфемерное «сейчас», после рестарта сервера мир пуст,
 * и это правильно: игроки переподключатся и снова о себе расскажут.
 */

export interface PresenceEntry {
  /** Показное имя — его видят другие игроки над головой. */
  name: string;
  /** Имя карты, как его знает клиент (forest, macos, …). Сравнивается как есть. */
  map: string;
  x: number;
  y: number;
  /** Ключ анимации целиком (`sw-walk-down`): чужой клиент просто её проигрывает. */
  anim: string;
  /** Что надето — чтобы чужой герой выглядел как одетый, а не голый. */
  helm: string | null;
  body: string | null;
  /** Оружие в руке — его видно у чужого героя так же, как у своего. */
  weapon: string | null;
  /** Мёртв ли герой: мобы мёртвых не трогают, как и в одиночной игре. */
  dead: boolean;
  /** Когда о игроке слышали в последний раз (мс). Для prune. */
  ts: number;
}

/**
 * Публичная строка ростера: без ts (он никому снаружи не нужен), зато с id —
 * стабильным ключом записи. По имени чужого героя не различить: два гостя
 * спокойно зовутся одинаково, а клиенту надо знать, кто из них кто, чтобы
 * спрайты не перескакивали между людьми.
 */
export type RosterRow = Omit<PresenceEntry, 'ts'> & { id: string };

/**
 * Молчит дольше этого — считаем отвалившимся, даже если сокет формально жив.
 *
 * Щедрая минута, а не 15 секунд: у свёрнутой вкладки браузер троттлит таймеры
 * до раза в минуту, позиции перестают идти — и короткий TTL выкидывал игрока
 * за простое сворачивание окна (а чат при возврате мигал «Online lost»).
 * Настоящие обрывы и так убирает закрытие сокета — мгновенно; TTL здесь
 * только страховка от зависших соединений.
 */
export const PRESENCE_TTL = 60_000;

export class PresenceStore {
  private players = new Map<string, PresenceEntry>();

  /** Игрок рассказал о себе. Некорректные числа не пускаем — они потом рисуются. */
  upsert(key: string, e: PresenceEntry): void {
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) return;
    this.players.set(key, e);
  }

  remove(key: string): void {
    this.players.delete(key);
  }

  /** Все на карте, кроме самого спрашивающего (себя игрок и так видит). */
  listFor(map: string, exceptKey: string): RosterRow[] {
    const out: RosterRow[] = [];
    for (const [key, p] of this.players) {
      if (key === exceptKey || p.map !== map) continue;
      out.push({ id: key, name: p.name, map: p.map, x: p.x, y: p.y, anim: p.anim, helm: p.helm, body: p.body, weapon: p.weapon, dead: p.dead });
    }
    return out;
  }

  /** Все на карте (включая спрашивающего) — так мир мобов узнаёт, за кем гнаться. */
  playersFor(map: string): { key: string; x: number; y: number; dead: boolean }[] {
    const out: { key: string; x: number; y: number; dead: boolean }[] = [];
    for (const [key, p] of this.players) {
      if (p.map === map) out.push({ key, x: p.x, y: p.y, dead: p.dead });
    }
    return out;
  }

  /** Выкинуть замолчавших. Возвращает ключи выкинутых — online.ts закроет сокеты. */
  prune(now: number): string[] {
    const dead: string[] = [];
    for (const [key, p] of this.players) {
      if (now - p.ts > PRESENCE_TTL) dead.push(key);
    }
    for (const k of dead) this.players.delete(k);
    return dead;
  }

  /** Карты, на которых кто-то есть, — чтобы рассылать ростер только живым мирам. */
  maps(): Set<string> {
    const out = new Set<string>();
    for (const p of this.players.values()) out.add(p.map);
    return out;
  }

  get size(): number {
    return this.players.size;
  }
}
