const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = __dirname;
let port = Number(process.env.PORT || 4180), attempts = 0;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filename = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!filename.startsWith(root + path.sep) || !(await fs.stat(filename)).isFile()) throw new Error('Not found');
    res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(await fs.readFile(filename));
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); }
});
server.on('error', error => {
  if (error.code === 'EADDRINUSE' && attempts++ < 10) { port++; server.listen(port, '127.0.0.1'); }
  else { console.error(`启动失败：${error.message}`); process.exitCode = 1; }
});
server.on('listening', () => console.log(`墨贴：http://127.0.0.1:${server.address().port}`));
server.listen(port, '127.0.0.1');
