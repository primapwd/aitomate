/**
 * Minimal static file server for the e2e smoke (spec §3.7). Serves
 * `examples/demo-ssr` verbatim on 8081 — no URL rewriting, no cleanUrls —
 * because the demo scenario asserts `urlMatches` on success.html URLs and a
 * rewriting server (e.g. npx serve) would redirect the `.html` suffix away.
 * Node-only: no new dependencies, no python-in-CI requirement.
 */
import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../examples/demo-ssr',
);
const REAL_ROOT = await realpath(ROOT);
const PORT = 8081;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
};

function assertInsideRoot(filePath) {
  const relative = path.relative(REAL_ROOT, filePath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('forbidden');
  }
}

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const filePath = path.resolve(ROOT, `.${decodeURIComponent(url.pathname)}`);
      assertInsideRoot(filePath);
      const candidate = (await stat(filePath)).isDirectory()
        ? path.join(filePath, 'index.html')
        : filePath;
      // realpath also prevents a symlink inside the fixture from serving a
      // file outside it.
      const target = await realpath(candidate);
      assertInsideRoot(target);
      const data = await readFile(target);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream',
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  })
  .listen(PORT, 'localhost', () =>
    console.log(`demo-ssr listening on http://localhost:${PORT}`),
  );
