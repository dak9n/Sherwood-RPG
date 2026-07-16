import Phaser from 'phaser';
import { ITEMS, type Icon } from './items';

/** С какого расстояния предмет прыгает в сумку. Чуть больше тайла. */
const PICKUP_RANGE = 20;
/** Дальше этого лежать не будет — иначе лес зарастёт неподобранным. */
const LIFETIME_MS = 120000;

/**
 * Нарезает кадры из листов под предметы.
 *
 * Зовётся один раз после загрузки: тайлсеты карты грузятся вторым проходом уже
 * в create, и в preload текстуры Objects ещё нет — add() молча ничего бы не сделал.
 */
export function registerItemFrames(scene: Phaser.Scene): void {
  const cut = (key: string, icon: Icon): void => {
    const tex = scene.textures.get(icon.sheet);
    if (!tex || tex.key === '__MISSING') return;
    if (tex.has(key)) return;
    tex.add(key, 0, icon.x, icon.y, icon.w, icon.h);
  };

  for (const def of Object.values(ITEMS)) {
    cut(`item-${def.id}`, def.icon);
    if (def.world) cut(`world-${def.id}`, def.world);
  }
}

/** Лежащая на земле добыча. */
export class Loot {
  readonly sprite: Phaser.GameObjects.Sprite;
  private bornAt: number;

  constructor(
    private scene: Phaser.Scene,
    readonly id: string,
    /**
     * Сколько лежит. НЕ readonly: если в сумку влезла только часть стопки,
     * остаток обязан остаться лежать, а не исчезнуть вместе с подобранным.
     */
    public qty: number,
    x: number,
    y: number,
  ) {
    const def = ITEMS[id];
    const icon = def.world ?? def.icon;
    const frame = def.world ? `world-${id}` : `item-${id}`;

    this.sprite = scene.add.sprite(x, y, icon.sheet, frame);
    this.sprite.setOrigin(0.5, 0.9);
    // Под ногами игрока, но поверх травы: добыча должна быть заметна.
    this.sprite.setDepth(290);
    this.bornAt = scene.time.now;

    // Короткий подскок при выпадении: иначе непонятно, что это новое.
    scene.tweens.add({
      targets: this.sprite,
      y: y - 6,
      duration: 160,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  /** Мигает перед тем, как исчезнуть: пропажа без предупреждения выглядит багом. */
  update(now: number): void {
    const age = now - this.bornAt;
    if (age > LIFETIME_MS - 5000) {
      this.sprite.setAlpha(Math.floor(now / 150) % 2 ? 0.3 : 1);
    }
  }

  expired(now: number): boolean {
    return now - this.bornAt > LIFETIME_MS;
  }

  inReach(x: number, y: number): boolean {
    return Phaser.Math.Distance.Between(this.sprite.x, this.sprite.y, x, y) < PICKUP_RANGE;
  }

  /** Летит к игроку и исчезает — так видно, что подобрано, а не пропало. */
  flyTo(x: number, y: number, done: () => void): void {
    this.scene.tweens.add({
      targets: this.sprite,
      x,
      y: y - 10,
      alpha: 0,
      scale: 0.6,
      duration: 180,
      onComplete: () => {
        this.sprite.destroy();
        done();
      },
    });
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
