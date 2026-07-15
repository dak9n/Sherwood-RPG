import Phaser from 'phaser';
import type { MapDoc } from './doc';

/** Тайлы с одинаковым номером анимируются синхронно — держим их одной пачкой. */
export interface AnimatedGroup {
  frames: { gid: number; duration: number }[];
  tiles: Phaser.Tilemaps.Tile[];
  frame: number;
  elapsed: number;
}

/**
 * Проекция документа в Phaser. Односторонняя: сюда пишут, отсюда не читают.
 * Общая для игры и редактора — иначе они разъедутся, и редактор будет рисовать
 * не по тому, что видно в игре.
 */
export interface MapView {
  map: Phaser.Tilemaps.Tilemap;
  layers: Phaser.Tilemaps.TilemapLayer[];
  groups: AnimatedGroup[];
  /** Номер тайла -> кадры его анимации. */
  framesByGid: Map<number, { gid: number; duration: number }[]>;
  /** Номер тайла -> его анимационная группа. */
  groupByGid: Map<number, AnimatedGroup>;
  /** Тайл -> группа, в которой он сейчас состоит. Нужен, чтобы вынуть его при правке. */
  groupOf: Map<Phaser.Tilemaps.Tile, AnimatedGroup>;
}

export function buildTilemap(scene: Phaser.Scene, doc: MapDoc): MapView {
  const data = doc.map;
  const map = scene.make.tilemap({
    tileWidth: data.tileWidth,
    tileHeight: data.tileHeight,
    width: data.width,
    height: data.height,
  });

  const tilesets = data.tilesets.map(
    (ts) => map.addTilesetImage(ts.name, ts.name, data.tileWidth, data.tileHeight, 0, 0, ts.firstId)!,
  );

  const view: MapView = {
    map,
    layers: [],
    groups: [],
    framesByGid: new Map(),
    groupByGid: new Map(),
    groupOf: new Map(),
  };

  // Номер тайла -> кадры его анимации (тоже в глобальных номерах).
  for (const ts of data.tilesets) {
    for (const [tileId, frames] of Object.entries(ts.animations)) {
      view.framesByGid.set(
        ts.firstId + Number(tileId),
        frames.map((f) => ({ gid: ts.firstId + f.tileId, duration: f.duration })),
      );
    }
  }

  for (const layerData of data.layers) {
    const layer = map.createBlankLayer(layerData.name, tilesets)!;
    layer.setVisible(layerData.visible);
    // Слои получают глубину с запасом между ними: без этого у всех depth = 0,
    // и любой спрайт рисуется либо поверх всей карты, либо под ней. Промежутки
    // нужны, чтобы персонажей и объекты можно было вставлять между слоями.
    layer.setDepth(view.layers.length * 10);
    view.layers.push(layer);

    const layerIndex = view.layers.length - 1;
    for (let i = 0; i < layerData.data.length; i++) {
      const raw = layerData.data[i];
      if (!raw) continue;
      applyCell(view, layerIndex, i % data.width, Math.floor(i / data.width), raw);
    }
  }

  view.groups = [...view.groupByGid.values()].filter((g) => g.tiles.length > 0);
  return view;
}

/**
 * Кладёт значение из документа в клетку Phaser — единственный способ менять картинку.
 *
 * Тайл обязательно снимается со старой анимационной группы и ставится в новую,
 * иначе: нарисованный поверх воды камень исчезнет через кадр, стёртая вода
 * воскреснет, а нарисованная вода застынет мёртвым кадром — группы держат
 * ссылки на живые объекты тайлов и переписывают им index каждый кадр.
 */
export function applyCell(view: MapView, layerIndex: number, x: number, y: number, raw: number): void {
  const layer = view.layers[layerIndex];
  // createBlankLayer уже создал объекты тайлов на все клетки с index=-1,
  // поэтому putTileAt не нужен. Он бы ещё и падал: для пустой клетки он лезет
  // в tilesets[0], которого нет — первый тайлсет начинается с номера 1.
  const tile = layer.getTileAt(x, y, true);
  if (!tile) return;

  const old = view.groupOf.get(tile);
  if (old) {
    const at = old.tiles.indexOf(tile);
    if (at !== -1) old.tiles.splice(at, 1);
    view.groupOf.delete(tile);
  }

  if (!raw) {
    // Пусто в нашем формате — 0, а в Phaser — -1.
    tile.index = -1;
    tile.rotation = 0;
    tile.flipX = false;
    return;
  }

  const parsed = Phaser.Tilemaps.Parsers.Tiled.ParseGID(raw);
  // Все поля пишутся каждый раз: иначе поворот от прежнего тайла останется
  // висеть на новом, и документ разойдётся с экраном.
  tile.index = parsed.gid;
  tile.rotation = parsed.rotation;
  tile.flipX = parsed.flipped;

  const frames = view.framesByGid.get(parsed.gid);
  if (!frames) return;

  let group = view.groupByGid.get(parsed.gid);
  if (!group) {
    group = { frames, tiles: [], frame: 0, elapsed: 0 };
    view.groupByGid.set(parsed.gid, group);
    view.groups.push(group);
  }
  group.tiles.push(tile);
  view.groupOf.set(tile, group);
}

export function updateAnimations(view: MapView, delta: number): void {
  for (const group of view.groups) {
    if (group.tiles.length === 0) continue;

    group.elapsed += delta;
    const current = group.frames[group.frame];
    if (group.elapsed < current.duration) continue;

    group.elapsed -= current.duration;
    group.frame = (group.frame + 1) % group.frames.length;
    const gid = group.frames[group.frame].gid;
    for (const tile of group.tiles) tile.index = gid;
  }
}
