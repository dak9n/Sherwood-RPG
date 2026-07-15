import { MapScene } from './MapScene';
import { Player } from '../game/player';
import { findTallObjects } from '../game/tall-objects';

/** Целый зум: при дробном пиксели карты не легли бы на пиксели экрана. */
const ZOOM = 3;

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
    cam.setZoom(ZOOM);
    cam.setBounds(0, 0, this.doc.width * this.doc.map.tileWidth, this.doc.height * this.doc.map.tileHeight);

    // Своё округление камеры (см. followPlayer). Родное выключаем: оно живёт в
    // preRender и делает Math.floor до целого мирового пикселя — то есть до трёх
    // экранных при зуме 3 — независимо от того, следует камера за кем-то или нет.
    cam.setRoundPixels(false);

    // startFollow не используем по той же причине: он вдобавок пишет округлённое
    // значение обратно, и следующий шаг плавности считается уже от него.
    this.followPlayer();
  }

  protected onUpdate(): void {
    this.player.update();
    this.followPlayer();
  }

  /**
   * Камера идёт за игроком, вставая на целые ЭКРАННЫЕ пиксели.
   *
   * Родное следование Phaser округляет прокрутку до целого мирового пикселя,
   * то есть до трёх экранных при зуме 3. Вдобавок с плавностью 0.1 шаг камеры
   * (0.08 пикселя за кадр) целиком съедался округлением: камера стояла,
   * копила отставание и прыгала рывком. Отсюда и дёрганая карта на диагонали.
   *
   * Округление до экранного пикселя (треть мирового) сохраняет чёткость
   * пиксель-арта — карта не встаёт между пикселями экрана — и при этом даёт
   * шаг втрое мельче, то есть плавное движение.
   */
  private followPlayer(): void {
    const cam = this.cameras.main;
    cam.centerOn(this.player.sprite.x, this.player.sprite.y);
    cam.scrollX = Math.round(cam.scrollX * ZOOM) / ZOOM;
    cam.scrollY = Math.round(cam.scrollY * ZOOM) / ZOOM;
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
