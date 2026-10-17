import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = await realpath(process.env.RELAY_ROOT || path.dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end('Method not allowed'); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filename = await realpath(path.join(root, pathname === '/' ? 'index.html' : pathname));
    if (!filename.startsWith(root + path.sep)) throw new Error('Outside root');
    const extension = path.extname(filename);
    if (!Object.hasOwn(types, extension)) throw new Error('Unsupported file');
    const bytes = await readFile(filename);
    res.writeHead(200, { 'Content-Type': types[extension], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'" });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Relay demo: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
