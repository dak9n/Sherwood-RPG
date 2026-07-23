/**
 * Сборка серверного мира из файлов карты — та же цепочка, что у MapScene,
 * только с диска, а не по сети: карта + каталог тайлсетов -> проходимость ->
 * точки спавна. Модули все чистые (map/doc, catalog, spawn, tall-objects,
 * collision-draft) — сервер выполняет ровно тот код, что и клиент, поэтому
 * мобы стоят там же, где их видел бы одиночный режим.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapDoc, ensureCollision, drawnBounds } from '../src/map/doc.ts';
import { applyCatalog, type TilesetCatalog } from '../src/map/catalog.ts';
import type { GameMap } from '../src/map/types.ts';
import { findTallObjects } from '../src/game/tall-objects.ts';
import { draftCollision, mergeCollision } from '../src/map/collision-draft.ts';
import {
  mapMobSpawns,
  mapPlayerStart,
  pickSpawns,
  pickBossSpawns,
  type SpawnPoint,
} from '../src/game/spawn.ts';
import { ALL_CREATURES, SPAWNS, BOSS_SPAWNS } from '../src/game/creatures.ts';
import { MapWorld } from './world.ts';

const MAPS_DIR = 'public/assets/maps';
const CATALOG_FILE = 'public/assets/tilesets.json';
/** Карта по умолчанию — как DEFAULT_MAP у клиента. */
const DEFAULT_MAP = 'forest';

/** Имя карты приходит от клиента: только буквы-цифры, никаких путей. */
const SAFE_NAME = /^[a-z0-9_-]{1,64}$/i;

/**
 * Собрать мир карты. Неизвестное имя честно превращается в null — тогда на
 * этой «карте» мобов просто нет (клиент со старой картой играется без них).
 */
export function loadWorld(root: string, mapName: string): MapWorld | null {
  const name = SAFE_NAME.test(mapName) ? mapName : DEFAULT_MAP;
  const mapFile = resolve(root, MAPS_DIR, `${name}.json`);
  const catalogFile = resolve(root, CATALOG_FILE);
  if (!existsSync(mapFile) || !existsSync(catalogFile)) return null;

  let doc: MapDoc;
  try {
    const raw = JSON.parse(readFileSync(mapFile, 'utf8')) as GameMap;
    const catalog = JSON.parse(readFileSync(catalogFile, 'utf8')) as TilesetCatalog;
    doc = new MapDoc(applyCatalog(ensureCollision(raw), catalog));
  } catch {
    return null; // битый файл карты — мир без мобов, а не упавший сервер
  }

  // Проходимость — как GameScene.buildCollision: черновик из тайлов поверх
  // ручной разметки. По ней мобы не заходят в воду и не ломятся сквозь стволы.
  const tall = findTallObjects(doc);
  doc.map.collision = mergeCollision(doc.map.collision, draftCollision(doc, tall, doc.map.tileHeight).collision);

  // Спавны — как GameScene.spawnMonsters: маркеры из редактора, а без них
  // прежняя случайная рассадка вокруг старта. Случай крутится на сервере
  // ОДИН раз — потому у всех игроков мобы стоят одинаково.
  const blocked = new Set(tall.keys());
  for (let i = 0; i < doc.width * doc.height; i++) {
    if (!doc.canWalk(i % doc.width, Math.floor(i / doc.width))) blocked.add(i);
  }
  const marked = mapMobSpawns(doc).filter((p) => ALL_CREATURES[p.kind]);
  let spawns: SpawnPoint[];
  if (marked.length) {
    spawns = marked;
  } else {
    const start = mapPlayerStart(doc) ?? drawnCenter(doc);
    spawns = [
      ...pickSpawns(doc, blocked, SPAWNS, start),
      ...pickBossSpawns(doc, blocked, BOSS_SPAWNS, start),
    ];
  }

  return new MapWorld(spawns, (cx, cy) => doc.canWalk(cx, cy), doc.map.tileWidth, doc.map.tileHeight);
}

/** Центр нарисованного — как drawnCenter у GameScene: центр холста может быть пуст. */
function drawnCenter(doc: MapDoc): { x: number; y: number } {
  const b = drawnBounds(doc.map);
  const tw = doc.map.tileWidth;
  const th = doc.map.tileHeight;
  if (!b) return { x: (doc.width * tw) / 2, y: (doc.height * th) / 2 };
  return {
    x: ((b.minX + b.maxX) / 2) * tw,
    y: ((b.minY + b.maxY) / 2) * th,
  };
}
