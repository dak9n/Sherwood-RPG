import Phaser from 'phaser';
import { UNSET, WALK, BLOCK } from '../map/doc';
import type { MapDoc } from '../map/doc';
import type { MapView } from '../map/view';

/**
 * Накладка проходимости: цветная заливка поверх карты в режиме стен.
 *
 * Это ОТДЕЛЬНЫЙ слой тайлмапы, а не Graphics, и вот почему. Клеток на карте до
 * 9800. Graphics — список команд: стереть один прямоугольник в нём нельзя, только
 * очистить и нарисовать всё заново. То есть либо 9800 заливок каждый кадр, либо
 * полный обход на каждый мазок кистью. У слоя тайлмапы цена изменения клетки —
 * одно присваивание, а за кадром камера сама отсекает невидимое: на зуме 3 из
 * 9800 клеток рисуется около 630.
 *
 * Приём тот же, что у applyCell и у невидимого слоя стен в игре: createBlankLayer
 * уже создал объекты тайлов на все клетки, поэтому getTileAt(x, y, true) всегда
 * вернёт живой тайл, и putTileAt не нужен.
 */

/** Три состояния — три цвета. Игроку важно различать «не задано» и «можно». */
const TINT: Record<number, number> = {
  [UNSET]: 0x8899aa, // серый: черновик решит сам
  [WALK]: 0x63a354, // зелёный: сказано «можно»
  [BLOCK]: 0xe2705f, // красный: сказано «нельзя»
};

/** Выше слоёв карты (у самой большой 34 слоя -> 330), но ниже сетки (1000). */
const DEPTH = 900;

const TEX = '__pass';

export class PassOverlay {
  private layer: Phaser.Tilemaps.TilemapLayer | null = null;
  private firstId = 0;
  private on = false;

  constructor(
    private scene: Phaser.Scene,
    private doc: MapDoc,
    private view: MapView,
  ) {
    this.build();
  }

  /**
   * Пересоздать после rebuild сцены: тот уничтожает тайлмапу целиком вместе с
   * нашим слоем, причём молча.
   */
  relayer(doc: MapDoc, view: MapView): void {
    this.doc = doc;
    this.view = view;
    this.layer = null;
    this.build();
    this.setVisible(this.on);
  }

  private build(): void {
    // Тайла сплошной заливки в наборе нет — рисуем свой белый квадрат один раз.
    // Белый потому, что цвет даём через tile.tint: у TilemapLayer нет setTint.
    if (!this.scene.textures.exists(TEX)) {
      const g = this.scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 0, this.doc.map.tileWidth, this.doc.map.tileHeight);
      g.generateTexture(TEX, this.doc.map.tileWidth, this.doc.map.tileHeight);
      g.destroy();
    }

    // Номер за последним настоящим тайлом: пересечься с ними нельзя, иначе
    // накладка стала бы рисоваться картинками из чужих тайлсетов.
    this.firstId = Math.max(...this.doc.map.tilesets.map((t) => t.firstId + t.tileCount));

    const ts = this.view.map.addTilesetImage(
      TEX, TEX, this.doc.map.tileWidth, this.doc.map.tileHeight, 0, 0, this.firstId,
    );
    if (!ts) return;

    this.layer = this.view.map.createBlankLayer(TEX, [ts]);
    if (!this.layer) return;

    this.layer.setDepth(DEPTH);
    this.layer.setAlpha(0.45);
    this.layer.setVisible(false);
    this.redrawAll();
  }

  /** Полный обход — только при постройке и по кнопке «Черновик». */
  redrawAll(): void {
    if (!this.layer) return;
    for (let y = 0; y < this.doc.height; y++) {
      for (let x = 0; x < this.doc.width; x++) this.paint(x, y);
    }
  }

  /** Одна клетка. Зовётся на каждую правку кистью — поэтому тут O(1). */
  paint(x: number, y: number, pass: number = this.doc.getPass(x, y)): void {
    const tile = this.layer?.getTileAt(x, y, true);
    if (!tile) return;

    tile.index = this.firstId;
    tile.tint = TINT[pass] ?? TINT[UNSET];
  }

  setVisible(on: boolean): void {
    this.on = on;
    this.layer?.setVisible(on);
  }

  get visible(): boolean {
    return this.on;
  }
}
