// FileSource over a folder picked with <input webkitdirectory>. Files are read only when the converter asks for them,
// so nothing is uploaded and unrelated files in the folder are never opened.
import type { FileSource } from '../core/gameset';

export function fileListSource(files: FileList | File[]): FileSource {
  const map = new Map<string, File>();
  for (const f of Array.from(files)) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const parts = rel.split('/');
    map.set(parts.slice(1).join('/'), f); // drop the picked folder's own name
  }
  return {
    list: () => [...map.keys()].filter((k) => k !== ''),
    read: async (path) => {
      const f = map.get(path);
      if (!f) throw new Error(`File not found: ${path}`);
      return new Uint8Array(await f.arrayBuffer());
    },
  };
}
