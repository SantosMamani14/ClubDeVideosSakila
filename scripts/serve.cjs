const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 8765);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const server = http.createServer((request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const segments = relative.split(/[\\/]/);
    const file = path.resolve(root, relative);
    if (segments.some(part => part.startsWith('.') || ['node_modules', 'tests', 'scripts'].includes(part)) || !file.startsWith(root + path.sep)) {
      response.writeHead(403).end('Acceso no permitido.');
      return;
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end('Archivo no encontrado.');
      return;
    }
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (request.method === 'HEAD') response.end();
    else fs.createReadStream(file).pipe(response);
  } catch {
    response.writeHead(400).end('Solicitud no válida.');
  }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `El puerto ${port} ya está en uso. Cambia PORT o utiliza el servidor que ya está abierto.` : error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`Sakila: http://127.0.0.1:${port}`));
