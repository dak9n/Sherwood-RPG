/**
 * Чужие герои на карте: спрайты игроков, пришедших по сети (см. net/online.ts).
 *
 * Это «призраки»: без физики и коллизий — сквозь них ходят, они никого не
 * толкают. Урон, лут и прочая механика их не касается: сервер присутствия
 * рассылает только «кто где стоит и что проигрывает», всё остальное у каждого
 * своё. Поэтому и рисуются они теми же листами героя `sw-*`: анимация приходит
 * готовым ключом (`sw-walk-down`) и просто проигрывается.
 *
 * Честное ограничение v1: листы `sw-*` перекрашены под БРОНЮ МЕСТНОГО игрока,
 * поэтому чужие одеты как ты, а не как они. Слоты helm/body в протоколе уже
 * ходят — когда появятся отдельные листы на игрока, раскраска подключится
 * без изменения сервера.
 *
 * Позиции приходят ~10 раз в секунду, а кадры рисуются 60 — между посылками
 * спрайт ДОТЯГИВАЕТСЯ до цели, иначе чужой герой дёргается телепортами.
 */

import Phaser from 'phaser';
import { creatureDepth } from './depth';
import type { RemoteRow } from '../net/online';

interface Ghost {
  sprite: Phaser.GameObjects.Sprite;
  tag: Phaser.GameObjects.Text;
  bubble: Phaser.GameObjects.Text | null;
  bubbleUntil: number;
  name: string;
  /** Куда тянемся: последняя позиция с сервера. */
  tx: number;
  ty: number;
  anim: string;
}

/** Дальше этого не тянемся, а прыгаем: телепорт или смена карты, тянуть нелепо. */
const SNAP_DIST = 200;
/** За сколько мс дотянуться до цели — период ростера, чтобы движение было ровным. */
const LERP_MS = 100;
const BUBBLE_MS = 5000;

/** Параметры глубины — те же, что сцена отдаёт игроку в setTallObjects. */
export interface DepthParams {
  tall: Map<number, number>;
  mapWidth: number;
  tileW: number;
  tileH: number;
  layerCount: number;
}

export class RemotePlayers {
  private ghosts = new Map<string, Ghost>();
  private scene: Phaser.Scene;
  private depth: DepthParams | null = null;
  /** Разрешение текста меток — как у ника местного героя (ZOOM+3). */
  private res: number;

  constructor(scene: Phaser.Scene, textResolution: number) {
    this.scene = scene;
    this.res = textResolution;
  }

  setDepthParams(p: DepthParams): void {
    this.depth = p;
  }

  /** Свежий ростер с сервера: кого нет — создать, кто пропал — убрать. */
  applyRoster(ps: RemoteRow[]): void {
    const seen = new Set<string>();
    for (const p of ps) {
      seen.add(p.id);
      let g = this.ghosts.get(p.id);
      if (!g) {
        g = this.spawn(p);
        this.ghosts.set(p.id, g);
      }
      g.tx = p.x;
      g.ty = p.y;
      if (g.name !== p.name) {
        g.name = p.name;
        g.tag.setText(p.name);
      }
      // Ключ анимации проигрываем как есть; чужая версия игры могла прислать
      // ключ, которого у нас нет, — тогда просто оставляем как было.
      if (p.anim && p.anim !== g.anim && this.scene.anims.exists(p.anim)) {
        g.anim = p.anim;
        g.sprite.anims.play(p.anim, true);
      }
    }
    for (const [id, g] of this.ghosts) {
      if (!seen.has(id)) {
        this.despawn(g);
        this.ghosts.delete(id);
      }
    }
  }

  private spawn(p: RemoteRow): Ghost {
    const sprite = this.scene.add
      .sprite(p.x, p.y, 'sw-idle', 0)
      .setOrigin(0.5, 0.75); // как у героя: ноги в точке (x, y)
    const tag = this.scene.add
      .text(p.x, p.y - 33, p.name, {
        fontFamily: 'monospace',
        fontSize: '4px',
        // Чуть теплее своего ника: своего игрок узнаёт по белому, чужих — по песочному.
        color: '#f0d8a8',
        stroke: '#000000',
        strokeThickness: 1,
      })
      .setOrigin(0.5, 1)
      .setResolution(this.res);
    const g: Ghost = { sprite, tag, bubble: null, bubbleUntil: 0, name: p.name, tx: p.x, ty: p.y, anim: '' };
    if (p.anim && this.scene.anims.exists(p.anim)) {
      g.anim = p.anim;
      sprite.anims.play(p.anim, true);
    }
    return g;
  }

  private despawn(g: Ghost): void {
    g.sprite.destroy();
    g.tag.destroy();
    g.bubble?.destroy();
  }

  /** Реплика из чата — облачко над головой говорившего. Ищем по имени: в чате другого ключа нет. */
  bubble(from: string, text: string): void {
    for (const g of this.ghosts.values()) {
      if (g.name !== from) continue;
      const msg = text.length > 60 ? `${text.slice(0, 59)}…` : text;
      if (!g.bubble) {
        g.bubble = this.scene.add
          .text(g.sprite.x, g.sprite.y - 44, msg, {
            fontFamily: 'monospace',
            fontSize: '5px',
            color: '#ffffff',
            backgroundColor: 'rgba(20,16,12,0.82)',
            padding: { x: 3, y: 2 },
            align: 'center',
            wordWrap: { width: 96 },
          })
          .setOrigin(0.5, 1)
          .setResolution(this.res);
      } else {
        g.bubble.setText(msg).setVisible(true);
      }
      g.bubbleUntil = this.scene.time.now + BUBBLE_MS;
      return;
    }
  }

  /** Каждый кадр: дотянуть позиции, глубину и подписи. */
  update(delta: number): void {
    const k = Math.min(1, delta / LERP_MS);
    for (const g of this.ghosts.values()) {
      const dx = g.tx - g.sprite.x;
      const dy = g.ty - g.sprite.y;
      if (Math.hypot(dx, dy) > SNAP_DIST) g.sprite.setPosition(g.tx, g.ty);
      else g.sprite.setPosition(g.sprite.x + dx * k, g.sprite.y + dy * k);

      if (this.depth) {
        const d = this.depth;
        g.sprite.setDepth(creatureDepth(g.sprite.x, g.sprite.y, d.tall, d.mapWidth, d.tileW, d.tileH, d.layerCount));
      }
      g.tag.setPosition(g.sprite.x, g.sprite.y - 33);
      g.tag.setDepth(g.sprite.depth + 0.03);
      if (g.bubble) {
        if (this.scene.time.now > g.bubbleUntil) {
          g.bubble.setVisible(false);
        } else {
          g.bubble.setPosition(g.sprite.x, g.sprite.y - 44);
          g.bubble.setDepth(g.sprite.depth + 0.04);
        }
      }
    }
  }

  /** Сколько чужих героев сейчас видно. Для строки статуса и тестов. */
  get size(): number {
    return this.ghosts.size;
  }

  destroy(): void {
    for (const g of this.ghosts.values()) this.despawn(g);
    this.ghosts.clear();
  }
}
