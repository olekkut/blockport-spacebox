import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Dev-server only helper: lets `npm run dev` open `/?dev` with a GameSet folder and a model taken from the
// BLOCKPORT_DEV_GAMESET and BLOCKPORT_DEV_MODEL environment variables, so the app can be checked without file dialogs.
function devFiles(): Plugin {
  return {
    name: 'blockport-dev-files',
    apply: 'serve',
    configureServer(server) {
      const gs = process.env.BLOCKPORT_DEV_GAMESET;
      const model = process.env.BLOCKPORT_DEV_MODEL;
      server.middlewares.use('/__dev', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://x');
        try {
          if (url.pathname === '/info') {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ gameset: !!gs, model: model ? model.split(/[\\/]/).pop() : null }));
          } else if (url.pathname === '/list' && gs) {
            const out: string[] = [];
            const walk = (rel: string) => {
              for (const n of readdirSync(join(gs, rel))) {
                const r = rel ? `${rel}/${n}` : n;
                if (statSync(join(gs, r)).isDirectory()) walk(r); else out.push(r);
              }
            };
            walk('');
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(out));
          } else if (url.pathname === '/file' && gs) {
            const p = (url.searchParams.get('p') ?? '').replace(/\\/g, '/');
            if (p.split('/').includes('..')) throw new Error('bad path');
            res.end(readFileSync(join(gs, p)));
          } else if (url.pathname === '/model' && model) {
            res.end(readFileSync(model));
          } else { res.statusCode = 404; res.end(); }
        } catch { res.statusCode = 500; res.end(); }
      });
    },
  };
}

// Production build: ship Nucleation's wasm next to the page and point its loader at it.
function nucleationWasm(): Plugin {
  return {
    name: 'blockport-nucleation-wasm',
    apply: 'build',
    transform(_code, id) {
      if (id.replace(/\\/g, '/').endsWith('nucleation/diplomat.config.mjs')) {
        return { code: "export default { wasm_path: new URL('nucleation.wasm', document.baseURI) };", map: null };
      }
      return null;
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'nucleation.wasm', source: readFileSync(join('node_modules', 'nucleation', 'nucleation.wasm')) });
    },
  };
}

// Set base to the repository name when publishing to GitHub Pages.
export default defineConfig({
  base: './',
  plugins: [devFiles(), nucleationWasm()],
  optimizeDeps: { exclude: ['nucleation'], esbuildOptions: { target: 'esnext' } },
  build: { target: 'esnext' },
});
