# Sherwood RPG

A tile-based 2D game set in a forest. TypeScript + [Phaser 3](https://phaser.io/), built with Vite. Comes with its own map editor — no Tiled required.

## Running

```sh
npm install
npm run dev
```

- http://localhost:5173 — the game
- http://localhost:5173/?edit — the game with the editor

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Type-check + build into `dist/` |
| `npm test` | Tests for the map document and resizing |
| `npm run convert-map` | One-off migration from Tiled (see below) |

## Editor

Opens with `?edit` and only on the dev server: it isn't part of the built game at all.

| Action | How |
|---|---|
| Draw | Left mouse button |
| Erase | Right mouse button |
| **Outline an object and pick it up as a brush** | **Alt+drag** or the "Select" button plus a drag |
| Pick up a whole object automatically | Alt+click (no drag) |
| Pick up exactly one cell | Shift+Left mouse button |
| Clear the selection | Esc |
| Pan the map | WASD, middle mouse button, or Space+Left mouse button |
| Zoom in/out | Mouse wheel |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z |
| Save | Ctrl+S |
| Grid | G key |
| Eraser | E key |
| New layer | The "＋" button next to the "Layers" heading |
| Rename a layer | ✎ in the layer row, or double-click the name |
| Delete a layer | 🗑 in the layer row (appears on hover) |
| Reorder a layer (z-order) | Drag the layer row up/down |
| Dim inactive layers | The "Dim" button |

This same cheat sheet opens right inside the editor via the "?" button. When you add a new hotkey, write it into [src/editor/ui/help.ts](src/editor/ui/help.ts).

**The brush is a stamp.** There are three ways to pick up a piece of the map as a brush, and they differ:

- **Alt+drag across the map** (or the "Select" button) — you frame a tree with a box and get exactly that. Don't like it? Frame it again; Esc clears it. This is the main method.
- **Alt+click** — the editor walks the connected tiles itself and grabs the whole object. Fast, but on a dense map the crowns of neighboring trees touch, and then the whole group gets picked up. If the object blends into the background (grass, water), a single cell is taken — use the box instead.
- **Drag in the palette** — outline tiles right in the tileset.

Empty cells inside the box stay empty: the brush won't paint over whatever you place it on with them.

**The map size** is changed with the "Size" button. It asks how many tiles to add on each side (a negative number crops). If cropping would lose anything, the editor tells you how much and on which layers — before it happens.

**A layer's "eye" hides it only on screen** and isn't written to the file. The `visible` field is part of the format and the game reads it: if the "eye" were written to the file, then hiding a layer to peek underneath it would send your friend a map with the objects missing.

**Layers** are added with the "＋" button (the new layer goes above the active one), deleted with the trash can in the row, and renamed by double-clicking the name. Names are unique and non-empty — otherwise the map won't pass validation. Adding and deleting, like resizing, rebuild the map and clear the Undo history; renaming does not. You can't delete the last layer, and deleting any layer asks for confirmation — for a layer with tiles it also shows the count of those that will be lost.

**Multiple maps.** Entering the editor (`?edit`) opens a start screen: pick a map from the list or create a new one. Each map is its own file, `public/assets/maps/<name>.json`. `forest.json` is the game's map (the game always loads it); the other maps don't affect the game. The "Save As" button writes the current map to a new file, and "Maps" returns you to the list. A new map takes its tilesets from `forest` so you have something to draw with right away. The map's name becomes the file name, so only letters/digits/hyphen/underscore are allowed — the server checks this once more so the name can't lead the write outside the maps folder.

### What protects what you've drawn

The order runs from the first line of defense to the last:

1. **Undo** in memory (200 strokes).
2. **A prompt when closing the tab** if there's anything unsaved. This isn't a formality: editing any file in `src/` reloads the page, and you'll be improving the editor with a map open.
3. **Map validation** before sending and once more on the server. A broken map won't make it into the file.
4. **A backup** in `.map-backups/` before every write; the last 20 are kept.
5. **Atomic writes**: first a temporary file, then a rename. An interrupted save won't leave a stub in place of the map.
6. **Overwrite protection**: if the file on disk has changed since it was loaded (git, a friend, the converter), the save stops and asks what to do. It won't offer "reload and lose everything" — you can write your version over the top, and theirs goes to a backup.
7. **git** — the format puts each layer on its own line, so diffs are readable and edits to different layers merge on their own.

## Map

**The game's map is `public/assets/maps/forest.json`.** It's a custom format, described in [src/map/types.ts](src/map/types.ts). The editor can open and create other maps alongside it (see "Multiple maps" above), but the game always loads `forest`.

48×32 tiles of 16 pixels each, 26 layers, 10 tilesets, 624 animated tiles (water and water lilies).

- layers are flat `width * height` arrays: `0` means empty, otherwise a global tile number;
- global number = the tileset's `firstId` + the tile's number within it;
- the top three bits hold rotation and mirror flags (Tiled's encoding), see [src/map/gid.ts](src/map/gid.ts);
- tilesets live in a shared catalog, `public/assets/tilesets.json` — one list for all maps, with animations. They aren't in the map file: they're substituted in at load time.

### Tilesets — shared across all maps

The list of tilesets lives in `public/assets/tilesets.json`, one for all maps. To add a new one:

```sh
node tools/add-tileset.mjs path/to/image.png
```

The image is copied into `public/assets/tilesets/`, the grid is computed from its size, the tileset is appended to the catalog — and it shows up in the palette **across all maps at once**.

**You must not do this by hand in the json.** The first tile's number has to continue the numbering with no gaps or overlaps: otherwise the numbers of tiles you've already drawn will start pointing into the wrong tileset, and the map will go haywire. The script keeps track of this, and `validateCatalog` checks the invariant.

Previously each map carried its own list inside it. That worked with one map, but not with several: a tileset had to be added to each one by hand (we already got burned by this — roads only appeared in `forest`), and adding them in different orders would have thrown the numbers off, so one number would mean different things in different maps.

Version-2 maps with their own list inside still work: for them the list takes precedence over the catalog, otherwise their tile numbers would go off the rails.

### How it works under the hood

**The document is the source of truth; Phaser is a one-way projection.** The map is never read back from Phaser tiles, and that's not a matter of taste: every frame the animation rewrites `Tile.index` in 624 cells, and the authored number is only there about 17% of the time. A save assembled by walking the tiles would bake random water frames into the file — and you'd notice weeks later, from the corrupted map in git.

That's why edits go only through `EditorState.apply`, and `applyCell` puts them on screen — the only function allowed to change tiles.

## Where the map came from

The map was originally drawn in Tiled and lives in `Tiled_files/`. The [tools/convert-map.mjs](tools/convert-map.mjs) script converted it into our format once: it unpacked the chunks, embedded the external `.tsx` tileset, and cropped to what was drawn.

**You don't need to run it anymore.** It recomputes the map size from Tiled's chunk boundaries and would revert it to 48×32, throwing away everything you've added since. The script refuses to run if `forest.json` already exists; the `--force` flag removes that protection — don't use it.

`Tiled_files/` and `PSD/` remain a source archive. The game doesn't read them.

## Structure

The game and the editor are **two separate scenes** that never run together: `?edit` turns on `EditorScene`, and without it `GameScene` runs. They share exactly two things: `MapScene` (load and draw the map) and the map format in `src/map/`.

| Path | What it is | Whose |
|---|---|---|
| `src/game/` | Player, gameplay | **game** |
| `src/scenes/GameScene.ts` | The game scene | **game** |
| `src/editor/` | The entire editor (not included in the prod build) | **editor** |
| `src/scenes/EditorScene.ts` | The editor scene | **editor** |
| `tools/save-map-plugin.ts` | Receives the map from the editor, writes to disk (dev) | **editor** |
| `src/scenes/MapScene.ts` | Map loading, tilemap, animation, mouse camera | **shared** |
| `src/map/` | Format, document, projection into Phaser, resize, validation | **shared** |
| `src/main.ts` | Entry point: picks the scene | **shared** |
| `public/assets/maps/` | The map | **shared** |
| `public/assets/characters/` | Character sprites | art |
| `tools/convert-map.mjs`, `tools/build-hero.py` | One-off asset-prep scripts | — |
| `Tiled_files/`, `PSD/` | Source archive | — |

## Collaborative development

**Work in your own folders — then git won't knock your heads together.** Whoever does gameplay lives in `src/game/` and `GameScene`. Whoever does the editor lives in `src/editor/` and `EditorScene`. These files don't overlap and can be edited at the same time.

**An edit to `shared` touches both of you.** `MapScene`, `src/map/`, and `main.ts` are read by both the game and the editor: here it's worth telling each other rather than committing silently. The game and the editor used to live in one scene — and the very first collision happened right there: both bound something different to WASD (camera panning and character movement), and git couldn't merge it, because the conflict wasn't textual but semantic.

**The map is shared, and git won't be able to merge its edits.** The format puts each layer on its own line, so edits to *different* layers merge on their own, and git shows which layer changed. But if you're both editing **the same layer** — agree on who holds it.

If a friend saved the map before you, your save will hit the validation check and offer a choice — either way, their version goes to `.map-backups/`.

PSD and Aseprite files don't merge at all: git will keep one person's file whole.
