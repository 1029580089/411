import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/sample.json', ['sample.json', 'application/json; charset=utf-8']],
  ['/planner.mjs', ['planner.mjs', 'text/javascript; charset=utf-8']]
]);
export function createServer() {
  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, {'Allow': 'GET, HEAD'}).end(); return; }
    const path = request.url?.split('?')[0];
    const entry = files.get(path);
    if (!entry) { response.writeHead(404).end('Not found'); return; }
    try {
      const buffer = await readFile(resolve(root, entry[0]));
      response.writeHead(200, {'Content-Type': entry[1], 'Content-Length': buffer.length});
      response.end(request.method === 'HEAD' ? undefined : buffer);
    } catch { response.writeHead(500).end('Unable to read asset'); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1..65535');
  const server = createServer();
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Workshop Planner: http://127.0.0.1:${port}`));
}
