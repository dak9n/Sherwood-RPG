import { MapScene } from './MapScene';
import { Player } from '../game/player';
import { findTallObjects } from '../game/tall-objects';

/**
 * Сцена игры. Всё про геймплей — здесь и в src/game/.
 *
 * Редактор сюда не заглядывает: у него своя сцена. Общее у них — MapScene и
 * формат карты в src/map/.
 */
export class GameScene extends MapScene {
  player!: Player;

  constructor() {
    super('world');
  }

  preload(): void {
    super.preload();
    Player.preload(this);
  }

  protected onReady(): void {
    // Ставим в середину нарисованного леса, а не карты: холст расширяли вправо
    // и вниз, поэтому центр карты — пустое поле.
    const { x, y } = this.drawnCenter();
    this.player = new Player(this, x, y);

    // Большие деревья ищем один раз: карта в игре не меняется.
    const tall = findTallObjects(this.doc);
    this.player.setTallObjects(tall, this.doc.width, this.doc.map.tileWidth, this.doc.map.tileHeight);

    const cam = this.cameras.main;
    cam.setZoom(3);
    cam.startFollow(this.player.sprite, true, 0.1, 0.1);
    cam.setBounds(0, 0, this.doc.width * this.doc.map.tileWidth, this.doc.height * this.doc.map.tileHeight);
  }

  protected onUpdate(): void {
    this.player.update();
  }

  /** Центр области, где вообще что-то нарисовано. */
  private drawnCenter(): { x: number; y: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const layer of this.doc.layers) {
      for (let i = 0; i < layer.data.length; i++) {
        if (!layer.data[i]) continue;
        const x = i % this.doc.width;
        const y = Math.floor(i / this.doc.width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    const tw = this.doc.map.tileWidth;
    const th = this.doc.map.tileHeight;
    return { x: ((minX + maxX) / 2) * tw, y: ((minY + maxY) / 2) * th };
  }
}
