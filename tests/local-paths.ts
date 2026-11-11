// Tests that need proprietary or large local files read their paths from environment variables and are skipped
// when a variable is not set, so CI stays green with no game files in the repo.
//   SPACEBOX_GAMESET     Spacebox install: Mods/GameSets/Default (or another GameSet folder)
//   SPACEBOX_STRUCTURES  Spacebox install: Structures folder (ship.sbs, asteroid.sbs)
//   BLOCKPORT_FALCON     a .litematic test model
//   BLOCKPORT_ENTERPRISE a .schem test model
import { existsSync } from 'node:fs';

function path(name: string): string | undefined {
  const v = process.env[name];
  return v && existsSync(v) ? v : undefined;
}

export const local = {
  gameSet: path('SPACEBOX_GAMESET'),
  structures: path('SPACEBOX_STRUCTURES'),
  falcon: path('BLOCKPORT_FALCON'),
  enterprise: path('BLOCKPORT_ENTERPRISE'),
};
