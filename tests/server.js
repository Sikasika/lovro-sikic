// Minimal static server for the tests (no dependencies).
// Usage: node tests/server.js [root=repo root] [port=3000] [--cache]
// --cache adds "Cache-Control: max-age=600" like GitHub Pages (used by the update test).
const http = require('http');
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const root = path.resolve(args.find((a) => !a.startsWith('--') && isNaN(+a)) || path.join(__dirname, '..'));
const port = +(args.find((a) => /^\d+$/.test(a)) || 3000);
const cache = args.includes('--cache');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (p.endsWith('/')) file = path.join(file, 'index.html');
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) { res.writeHead(301, { Location: `${p}/` }); return res.end(); }
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', ...(cache ? { 'Cache-Control': 'max-age=600' } : { 'Cache-Control': 'no-store' }) });
    fs.createReadStream(file).pipe(res);
  });
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}${cache ? ' (max-age=600)' : ''}`));
