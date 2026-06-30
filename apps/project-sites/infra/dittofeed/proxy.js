const http = require('http');
const DITTO_PORT = 3000, PROXY_PORT = 80;
let dittoReady = false, startTime = Date.now();

const S = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="color-scheme" content="dark"><meta http-equiv="refresh" content="5"><title>Engage</title><style>body{min-height:100vh;background:#060610;color:#f4f4ff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center}div{text-align:center}h1{font-size:2rem;margin-bottom:.5rem}p{color:#94a3b8}.spinner{width:40px;height:40px;margin:1rem auto;border:3px solid #1e1e3f;border-top-color:#00e5ff;border-radius:50%;animation:s .8s linear infinite}@keyframes s{to{transform:rotate(360deg)}}</style></head><body><div><h1>Engage</h1><p>Customer engagement is starting up…</p><div class="spinner"></div></div></body></html>`;

const server = http.createServer((req, res) => {
  // Health check: always return 200 regardless of Dittofeed state
  if (req.url === '/health' || req.url === '/ping') {
    res.writeHead(200, {'Content-Type':'text/plain'});
    res.end('ok');
    return;
  }
  if (dittoReady) {
    const opts = { hostname:'127.0.0.1', port:DITTO_PORT, path:req.url, method:req.method, headers:req.headers, timeout: 60000 };
    const proxy = http.request(opts, (pres) => { res.writeHead(pres.statusCode, pres.headers); pres.pipe(res); });
    proxy.on('timeout', () => { proxy.destroy(); res.writeHead(504); res.end('Upstream timeout'); });
    proxy.on('error', () => { res.writeHead(502); res.end('Unreachable'); });
    req.pipe(proxy);
  } else {
    res.writeHead(200, {'Content-Type':'text/html;charset=utf-8'});
    res.end(S);
  }
});
server.listen(PROXY_PORT, '0.0.0.0', () => console.log(`[proxy] :${PROXY_PORT}`));

setInterval(() => {
  if (dittoReady) return;
  const req = http.get(`http://127.0.0.1:${DITTO_PORT}/`, (res) => {
    if (res.statusCode < 500) { dittoReady = true; console.log(`[proxy] READY ${(Date.now()-startTime)/1000}s`); }
  });
  req.on('error', () => {});
  req.setTimeout(10000, () => req.destroy());
}, 3000);
