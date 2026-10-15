// serve.mjs – tiny static web server for local testing (no dependencies).
// Usage: node serve.mjs dist 8080   then open http://localhost:8080
// Like GitHub Pages it sends NO special headers; sw.js adds cross-origin isolation itself.
import http from 'http'; import fs from 'fs'; import path from 'path';
const dir = path.resolve(process.argv[2] || 'dist'), port = +(process.argv[3] || 8080);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
http.createServer((req, res) => {
  let p = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(dir)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { if (process.env.LOG) console.log('404', req.url); res.writeHead(404); return res.end('not found'); }
  if (process.env.LOG) console.log(req.method, req.url);
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log(`Serving ${dir} on http://localhost:${port}`));
