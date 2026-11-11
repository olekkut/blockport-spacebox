# Blockport for Spacebox

Convert Minecraft structures (`.schem`, `.litematic`, `.schematic`, `.nbt`, `.mcstructure`) into Spacebox
structure files (`.sbs`), edit existing `.sbs` files, or generate new structures from math expressions.
Unofficial community tool, not affiliated with Spacebox or its developer.

**Status: early.** The conversion core, a command-line converter and a browser app with a 3D preview,
click-to-remap editor and structure generator work.

**Open the app: https://olekkut.github.io/blockport-spacebox/** (Chrome, Edge or Firefox; nothing is uploaded).
To run it locally, use `npm install` and `npm run dev`.

## Browser app

1. Optional: click **Load GameSet** and pick `Mods/GameSets/Default` (the GameSet folder itself, not the game's root).
   Without it the app shows a demo look: coloured cubes for the default block list, with no Spacebox textures.
   Pick the folder for the real textures and for blocks from your own GameSets.
2. Click **Open Structure** (or drop a file on the view) to load a Minecraft structure or an existing `.sbs` file,
   or click **Generate 3D** to make one (see below).
3. The 3D view shows the converted result. Click a block in the view, or a row in the list, to select that block
   type (highlighted in yellow, or alone with "Show only this"), then click a Spacebox block on the right to use it
   instead. "Automatic" removes your override, "Make air" drops the block and "Reset all remaps" clears every
   override. The list can also group blocks by material (all oak variants together). Under "Only these states",
   click values such as `type: top` or `half: bottom` to remap just those states of the selected block.
4. Switch the tool in the viewport toolbar. **Place** attaches the Spacebox block you pick on the right to the face you
   click. A ghost preview shows its size and an arrow its direction; set the direction and roll with the buttons on
   the right, or press `R` to turn it and `Shift+R` to roll it. Multi-blocks such as 2x2x2 thrusters are always
   placed this way. **Erase** removes the block you click, whole if it is a multi-block. Camera buttons give a
   turntable and quick Front, Top, Side and Iso views. `Ctrl+Z` and `Ctrl+Y` undo and redo remaps, settings and
   placed blocks.
5. Set slab, stair, door and other shape rules, a cross-section crop, optional hollowing, and the name, author and
   description. Profiles (including your overrides) can be saved and loaded as JSON.
6. **Export .sbs** downloads the file through your browser. Move it into the game's `Structures` folder (the in-game
   Structures menu has an "Open folder" button).

Everything is read in the browser. Files are never uploaded, and only the files the app needs are opened.

### Generate 3D

Builds a structure from a formula, then hands it to the same remap, edit and export steps. It accepts WorldEdit
style commands such as `//g -h stone x^2 + y^2 + z^2 < 0.8` or a plain expression:

- Variables `x y z` (scaled to the domain `[-S, +S]`), `r` (distance from the centre), `theta`, `phi`, `t` (the
  thickness slider), `pi`, `e`, and functions such as `sin`, `sqrt`, `abs`, `min`, `max`, `pow`, `mod`, `clamp`.
- `^` is a power. With a comparison (`<`, `<=`, `>`, `>=`) the expression is a condition; otherwise every point
  where its value is `<= 0` is solid. `-h` keeps only a shell.
- Presets: gyroid, Schwarz P and diamond lattices, a WorldEdit torus variant, an orbital ring, a (7, 3) torus knot,
  a Menger sponge, a Mandelbulb and a ribbed Dyson shell.
- Material layers: one block, five radial layers or five height bands, each a separate Minecraft block that you can
  remap on its own.

Expressions are parsed by the app's own small parser; they are never run as code.

## What it does

- Reads Minecraft files through [Nucleation](https://github.com/Schem-at/Nucleation) (MIT, WebAssembly).
- Reads your own Spacebox GameSet folder to learn which blocks exist, their sizes and their texture colours.
  No textures, models or other game files are included in this repository or uploaded anywhere. The demo block list
  in `src/core/fallback.ts` holds only the default block ids, names and sizes, with rough colours, so `.sbs` files
  can be opened before a GameSet folder is picked.
- Maps every Minecraft block state to a Spacebox block, or to air, using a profile you can edit and save as JSON.
- Writes `.sbs` files in the same layout the game's own `Structures` export produces. Drop them into the game's
  `Structures` folder and use the in-game `Structures` menu or the Ship viewer.

## Mapping rules

1. **Explicit rules** win: `{ "match": "minecraft:*_stairs[half=top]", "target": "air" }` (globs on the block id,
   optional state filters). A rule with more state filters beats a broader one, whatever the order.
2. **Shape rules** handle blocks that are not full cubes: slabs (all / top only / bottom only / drop), stairs,
   walls, fences and bars, glass panes, doors (the lower half only, or drop), trapdoors and other decoration.
   Grass, flowers, carpets, buttons, torches and similar blocks become air instead of solid hull.
3. **Colour matching** (CIELAB distance) picks from a category pool. The built-in ship profile only uses
   `MetalBlocks` for solids, `Windows` for glass and `Lights` for light sources, so a ship never turns into rocks, ores
   or bombs. The asteroid profile uses `Resources` (without ores). Only 1x1x1 blocks are ever picked automatically.

Blocks of an opened `.sbs` file keep their Spacebox block, direction and multi-block layout unless a rule remaps them.

Other options: a crop box (to cut off a floor, for example), an optional hollow pass that removes buried filler
blocks and keeps a shell of 1 to 3 blocks, and a Z-mirror switch.

## Command line

```bash
npm install
npx tsx scripts/convert.ts model.litematic out.sbs --gameset "<Spacebox>/Mods/GameSets/Default" --crop-min ,1, --report
```

Pick the GameSet folder itself (for example `Mods/GameSets/Default`), not the game's root folder.

Options: `--profile ship|asteroid|file.json`, `--crop-min x,y,z`, `--crop-max x,y,z` (source coordinates, inclusive;
leave a value empty to skip that side), `--hollow [thickness]`, `--no-hollow`, `--flip-z`, `--name`, `--author`,
`--description` (shown in the game's Structures menu; the default names the source file), `--report` (prints what
every block became).

## Development

```bash
npm test          # unit tests; tests that need local files are skipped when their paths are not set
npm run typecheck
npm run build     # static site in dist/ (nucleation.wasm is emitted next to the page)
```

Tests that use real game files or large models read paths from environment variables (see
`tests/local-paths.ts`): `SPACEBOX_GAMESET`, `SPACEBOX_STRUCTURES`, `BLOCKPORT_FALCON`, `BLOCKPORT_ENTERPRISE`.

```
src/core/     parsing, mapping, conversion, generator. No DOM or Three.js imports.
src/viewer/   Three.js rendering (instanced meshes, picking)
src/ui/       DOM controls and the app entry point
src/node/     Node-only helpers for the CLI and tests
data/         Minecraft block facts (kind, solidity, colour) generated from Nucleation's block database
```

`npx tsx scripts/extract-mc-db.ts` regenerates `data/mc_block_db.json`. `npx tsx scripts/dump-defs.ts <GameSet>`
prints block definitions in the format of the demo block list.

## Credits

- [Nucleation](https://github.com/Schem-at/Nucleation) by Schem-at (MIT) reads the Minecraft formats and provides
  the block facts in `data/`.
- The NBT and `.sbs` handling follows the structure bridge of
  [open-corneroids](https://github.com/olekkut/open-corneroids), whose author also wrote this tool.

## License

MIT
