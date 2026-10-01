import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from './server.mjs';

test('HTTP serves only public assets, with security headers and safe methods', async () => {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/', '/app.mjs', '/planner.mjs', '/style.css', '/sample.json']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
      assert.ok((await response.text()).length > 0);
    }
    for (const path of ['/package.json', '/.git/config', '/%2e%2e/package.json', '/src/planner.mjs']) assert.equal((await fetch(base + path)).status, 404);
    assert.equal((await fetch(base, {method: 'POST', body: 'data'})).status, 405);
    const head = await fetch(base, {method: 'HEAD'}); assert.equal(head.status, 200); assert.equal(await head.text(), '');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
