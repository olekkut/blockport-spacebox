// Node-only FileSource over a directory. Used by tests and the CLI; the browser build uses its own source.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FileSource } from '../core/gameset';

export function dirSource(root: string): FileSource {
  return {
    list() {
      const out: string[] = [];
      const walk = (rel: string) => {
        for (const name of readdirSync(join(root, rel))) {
          const r = rel ? `${rel}/${name}` : name;
          if (statSync(join(root, r)).isDirectory()) walk(r);
          else out.push(r);
        }
      };
      walk('');
      return out;
    },
    read: (path) => new Uint8Array(readFileSync(join(root, path))),
  };
}
