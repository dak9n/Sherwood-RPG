/**
 * Серверный мир одной карты: мобы, общие для всех игроков.
 *
 * До этого каждый клиент растил СВОИХ мобов: у двоих на одной поляне жили две
 * разные стаи, и бить «одного и того же» паука было физически невозможно.
 * Теперь мобами владеет сервер: он решает, где они стоят, за кем гонятся и
 * когда умирают; клиенты только рисуют и присылают свой урон.
 *
 * AI нарочно повторяет клиентский Monster (та же чистая decideChase, те же
 * статы из creatures.ts), но без физики: шаг напрямик с соскальзыванием вдоль
 * непроходимых клеток. Волновой обход препятствий сюда не переносим — на
 * сервере нет нужной точности, а «упёрся в стену и стоит» честнее, чем моб,
 * гуляющий по воде.
 *
 * Чистый модуль: ни сети, ни таймеров, ни диска — время и игроков подают
 * снаружи. Поэтому он целиком проверяется тестами.
 */

import { decideChase, type Chase } from '../src/game/chase.ts';
import { ALL_CREATURES, type MonsterStats } from '../src/game/creatures.ts';
import type { SpawnPoint } from '../src/game/spawn.ts';

/** Кадры атаки листаются на этой скорости (см. createDirAnims в monster.ts). */
const ATTACK_FPS = 16;
/** Кадров в ряду атаки по умолчанию — как COLS_DEFAULT в monster.ts. */
const ATTACK_COLS_DEFAULT = 8;
/** Обычный монстр возвращается через полминуты — как RESPAWN_MS в monster.ts. */
const RESPAWN_MS = 30_000;
/** Больше этого за один удар не верим: столько не бьёт даже крит тяжёлым. */
const MAX_HIT = 1000;

export type MobMode = Chase | 'attack' | 'dead';
export type MobDir = 'down' | 'left' | 'right' | 'up';

export interface WorldPlayer {
  key: string;
  x: number;
  y: number;
  dead: boolean;
}

/** Моб глазами клиента: ровно то, что уходит в сообщении {t:'mobs'}. */
export interface MobRow {
  id: number;
  k: string;
  x: number;
  y: number;
  hp: number;
  m: MobMode;
  d: MobDir;
}

/** Моб укусил игрока: доставить событие клиенту-жертве. */
export interface MobHitEvent {
  player: string;
  mobId: number;
  dmg: number;
}

interface Mob {
  id: number;
  /** Имя вида в ALL_CREATURES ('spider1') — по нему клиент найдёт статы. */
  kind: string;
  stats: MonsterStats;
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  hp: number;
  mode: MobMode;
  dir: MobDir;
  provoked: boolean;
  /** Кого бьём в текущем замахе — удар прилетит ему, даже если он отошёл. */
  targetKey: string | null;
  nextAttackAt: number;
  attackEndAt: number;
  hitAt: number;
  hitDone: boolean;
  respawnAt: number;
  /** Кто ударил последним — тому и засчитается убийство. */
  lastHitBy: string | null;
}

export class MapWorld {
  private mobs: Mob[] = [];
  private canWalk: (cx: number, cy: number) => boolean;
  private tileW: number;
  private tileH: number;

  constructor(
    spawns: SpawnPoint[],
    canWalk: (cx: number, cy: number) => boolean,
    tileW = 16,
    tileH = 16,
  ) {
    this.canWalk = canWalk;
    this.tileW = tileW;
    this.tileH = tileH;
    let id = 0;
    for (const p of spawns) {
      const stats = ALL_CREATURES[p.kind];
      if (!stats) continue; // чужой kind из старой карты — молча мимо, как клиент
      this.mobs.push({
        id: ++id,
        kind: p.kind,
        stats,
        homeX: p.x,
        homeY: p.y,
        x: p.x,
        y: p.y,
        hp: stats.hp,
        mode: 'idle',
        dir: 'down',
        provoked: false,
        targetKey: null,
        nextAttackAt: 0,
        attackEndAt: 0,
        hitAt: 0,
        hitDone: false,
        respawnAt: 0,
        lastHitBy: null,
      });
    }
  }

  /** Снимок для рассылки клиентам. Позиции целыми — байты в сети не бесплатные. */
  snapshot(): MobRow[] {
    return this.mobs.map((m) => ({
      id: m.id,
      k: m.kind,
      x: Math.round(m.x),
      y: Math.round(m.y),
      hp: m.hp,
      m: m.mode,
      d: m.dir,
    }));
  }

  /**
   * Игрок ударил моба. Урон верим клиенту (он считает криты и заточку), но в
   * пределах разумного: отрицательное и астрономическое — мимо.
   * Возвращает 'dead', если именно этот удар убил, — звать награду убийце.
   */
  hit(mobId: number, dmg: number, byKey: string, now: number): 'dead' | 'ok' | 'ignored' {
    const m = this.mobs.find((x) => x.id === mobId);
    if (!m || m.mode === 'dead') return 'ignored';
    const amount = Math.floor(Number(dmg));
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_HIT) return 'ignored';

    m.hp -= amount;
    m.provoked = true; // стрела издалека будит так же, как у клиентского Monster
    m.lastHitBy = byKey;
    if (m.hp > 0) return 'ok';

    m.hp = 0;
    m.mode = 'dead';
    m.respawnAt = now + (m.stats.respawnMs ?? RESPAWN_MS);
    return 'dead';
  }

  /** Один шаг мира. Возвращает укусы мобов — сеть доставит их жертвам. */
  tick(now: number, dtMs: number, players: WorldPlayer[]): MobHitEvent[] {
    const events: MobHitEvent[] = [];
    const alive = players.filter((p) => !p.dead);

    for (const m of this.mobs) {
      if (m.mode === 'dead') {
        if (now >= m.respawnAt) this.reset(m);
        continue;
      }

      // Замах уже идёт: удар падает в свой кадр, потом откат — как у клиента.
      if (m.mode === 'attack') {
        if (!m.hitDone && now >= m.hitAt) {
          m.hitDone = true;
          const t = alive.find((p) => p.key === m.targetKey);
          // Бьём по месту, где жертва СЕЙЧАС: отошла за время замаха — промах.
          if (t && this.dist2(m.x, m.y, t.x, t.y) <= this.reach2(m, 8)) {
            events.push({ player: t.key, mobId: m.id, dmg: m.stats.dmg });
          }
        }
        if (now >= m.attackEndAt) {
          m.mode = 'chase';
          m.nextAttackAt = now + m.stats.cooldown;
        }
        continue;
      }

      // Ближайший живой игрок — цель. Никого нет — мир спит.
      const target = this.closest(m, alive);
      if (!target) {
        if (m.mode !== 'idle') this.leashStep(m, dtMs); // догуляем домой
        continue;
      }

      const toPlayer2 = this.dist2(m.x, m.y, target.x, target.y);
      const toHome2 = this.dist2(m.x, m.y, m.homeX, m.homeY);
      const was: Chase = m.mode === 'chase' || m.mode === 'leash' ? m.mode : 'idle';
      const mode = decideChase(
        { mode: was, toPlayer2, toHome2, homeTol2: this.tileW * this.tileW, provoked: m.provoked },
        m.stats,
      );

      if (mode === 'leash') {
        m.provoked = false; // поводок снимает обиду — как у клиента
        m.mode = 'leash';
        this.leashStep(m, dtMs);
        continue;
      }
      if (was === 'leash' && mode === 'idle') m.hp = m.stats.hp; // дошёл — вылечился
      m.mode = mode;

      if (mode === 'idle') continue;

      // Догнал — замах, если откат прошёл.
      if (toPlayer2 < this.reach2(m, 0)) {
        m.dir = this.dirTo(m, target.x, target.y);
        if (now >= m.nextAttackAt) {
          const cols = m.stats.cols?.attack ?? ATTACK_COLS_DEFAULT;
          m.mode = 'attack';
          m.targetKey = target.key;
          m.hitDone = false;
          m.hitAt = now + (m.stats.hitFrame / ATTACK_FPS) * 1000;
          m.attackEndAt = now + (cols / ATTACK_FPS) * 1000;
        }
        continue;
      }

      this.step(m, target.x, target.y, dtMs);
    }
    return events;
  }

  private reset(m: Mob): void {
    m.hp = m.stats.hp;
    m.mode = 'idle';
    m.dir = 'down';
    m.x = m.homeX;
    m.y = m.homeY;
    m.provoked = false;
    m.targetKey = null;
    m.lastHitBy = null;
  }

  private leashStep(m: Mob, dtMs: number): void {
    this.step(m, m.homeX, m.homeY, dtMs);
    if (this.dist2(m.x, m.y, m.homeX, m.homeY) <= this.tileW * this.tileW) {
      m.mode = 'idle';
      m.hp = m.stats.hp;
    }
  }

  /**
   * Шаг к цели напрямик, но не в стену: непроходимая клетка съедает движение по
   * своей оси, вторая ось остаётся — так моб соскальзывает вдоль препятствия.
   */
  private step(m: Mob, tx: number, ty: number, dtMs: number): void {
    const d = Math.hypot(tx - m.x, ty - m.y);
    if (d < 1) return;
    let left = Math.min(d, (m.stats.speed * dtMs) / 1000);
    const ux = (tx - m.x) / d;
    const uy = (ty - m.y) / d;

    const walkable = (x: number, y: number): boolean =>
      this.canWalk(Math.floor(x / this.tileW), Math.floor(y / this.tileH));

    // Подшагами не длиннее полуклетки: длинный шаг (большой dt) перепрыгивал
    // бы клетку стены целиком и моб туннелировал сквозь неё.
    while (left > 0) {
      const len = Math.min(left, this.tileW / 2);
      left -= len;
      const nx = m.x + ux * len;
      const ny = m.y + uy * len;
      if (walkable(nx, ny)) {
        m.x = nx;
        m.y = ny;
      } else if (walkable(nx, m.y)) {
        m.x = nx;
      } else if (walkable(m.x, ny)) {
        m.y = ny;
      } else break; // упёрся всеми осями — дальше идти некуда
    }
    m.dir = this.dirTo(m, tx, ty);
  }

  /** Куда смотреть при движении к цели. Горизонталь важнее — как dirFromVelocity. */
  private dirTo(m: Mob, tx: number, ty: number): MobDir {
    const dx = tx - m.x;
    const dy = ty - m.y;
    if (!dx && !dy) return m.dir;
    if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'down' : 'up';
  }

  private closest(m: Mob, players: WorldPlayer[]): WorldPlayer | null {
    let best: WorldPlayer | null = null;
    let bestD = Infinity;
    for (const p of players) {
      const d = this.dist2(m.x, m.y, p.x, p.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  private dist2(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return dx * dx + dy * dy;
  }

  /** Квадрат дистанции удара с допуском: за время замаха жертва чуть съезжает. */
  private reach2(m: Mob, pad: number): number {
    const r = m.stats.reach + pad;
    return r * r;
  }

  get size(): number {
    return this.mobs.length;
  }
}
