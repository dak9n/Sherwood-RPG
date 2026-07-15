import Phaser from 'phaser';
import type { GameMap } from '../map/types';

const MAP_KEY = 'forest';
const MAP_URL = 'assets/maps/forest.json';
const TILESET_URL = 'assets/tilesets/';

/** Тайлы с одинаковым номером анимируются синхронно — держим их одной пачкой. */
interface AnimatedGroup {
  frames: { gid: number; duration: number }[];
  tiles: Phaser.Tilemaps.Tile[];
  frame: number;
  elapsed: number;
}

export class WorldScene extends Phaser.Scene {
  private animated: AnimatedGroup[] = [];

  constructor() {
    super('world');
  }

  preload(): void {
    this.load.json(MAP_KEY, MAP_URL);

    // Картинки тайлсетов перечислены в самой карте, поэтому грузим их после json.
    this.load.once(`filecomplete-json-${MAP_KEY}`, () => {
      const map = this.cache.json.get(MAP_KEY) as GameMap;
      for (const ts of map.tilesets) {
        this.load.image(ts.name, TILESET_URL + ts.image);
      }
    });
  }

  create(): void {
    const data = this.cache.json.get(MAP_KEY) as GameMap;
    const map = this.make.tilemap({
      tileWidth: data.tileWidth,
      tileHeight: data.tileHeight,
      width: data.width,
      height: data.height,
    });

    const tilesets = data.tilesets.map((ts) =>
      map.addTilesetImage(ts.name, ts.name, data.tileWidth, data.tileHeight, 0, 0, ts.firstId)!,
    );

    const framesByGid = this.collectAnimations(data);
    const pending = new Map<number, Phaser.Tilemaps.Tile[]>();

    for (const layerData of data.layers) {
      const layer = map.createBlankLayer(layerData.name, tilesets)!;
      layer.setVisible(layerData.visible);

      for (let i = 0; i < layerData.data.length; i++) {
        const raw = layerData.data[i];
        if (!raw) continue;

        const x = i % data.width;
        const y = Math.floor(i / data.width);

        // Флаги поворота Tiled кодируются в старших битах — разбирает Phaser.
        const parsed = Phaser.Tilemaps.Parsers.Tiled.ParseGID(raw);
        const tile = layer.putTileAt(parsed.gid, x, y);
        tile.rotation = parsed.rotation;
        tile.flipX = parsed.flipped;

        if (framesByGid.has(parsed.gid)) {
          const list = pending.get(parsed.gid) ?? [];
          list.push(tile);
          pending.set(parsed.gid, list);
        }
      }
    }

    this.animated = [...pending].map(([gid, tiles]) => ({
      frames: framesByGid.get(gid)!,
      tiles,
      frame: 0,
      elapsed: 0,
    }));

    this.setupCamera(data);

    const animatedTiles = this.animated.reduce((n, g) => n + g.tiles.length, 0);
    console.log(
      `Карта ${data.width}x${data.height}, слоёв ${data.layers.length}, анимированных тайлов ${animatedTiles}`,
    );
  }

  /** Глобальный номер тайла -> кадры анимации (тоже в глобальных номерах). */
  private collectAnimations(data: GameMap): Map<number, { gid: number; duration: number }[]> {
    const result = new Map<number, { gid: number; duration: number }[]>();
    for (const ts of data.tilesets) {
      for (const [tileId, frames] of Object.entries(ts.animations)) {
        result.set(ts.firstId + Number(tileId), frames.map((f) => ({
          gid: ts.firstId + f.tileId,
          duration: f.duration,
        })));
      }
    }
    return result;
  }

  private setupCamera(data: GameMap): void {
    const cam = this.cameras.main;
    const mapWidth = data.width * data.tileWidth;
    const mapHeight = data.height * data.tileHeight;

    cam.setZoom(Math.min(this.scale.width / mapWidth, this.scale.height / mapHeight));
    cam.centerOn(mapWidth / 2, mapHeight / 2);

    // Перетаскивание карты мышью.
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return;
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
    });

    // Зум колесом, с курсором как центром.
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const before = cam.getWorldPoint(p.x, p.y);
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.25, 16));
      const after = cam.getWorldPoint(p.x, p.y);
      cam.scrollX += before.x - after.x;
      cam.scrollY += before.y - after.y;
    });
  }

  update(_time: number, delta: number): void {
    for (const group of this.animated) {
      group.elapsed += delta;
      const current = group.frames[group.frame];
      if (group.elapsed < current.duration) continue;

      group.elapsed -= current.duration;
      group.frame = (group.frame + 1) % group.frames.length;
      const gid = group.frames[group.frame].gid;
      for (const tile of group.tiles) tile.index = gid;
    }
  }
}
