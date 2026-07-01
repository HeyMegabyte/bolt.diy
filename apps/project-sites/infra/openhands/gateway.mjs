/**
 * Thin origin gateway — validates X-ProjectSites-Origin-Secret header
 * and proxies to OpenHands Agent Canvas on :8000.
 */

import http from 'node:http';
import net from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';

const PORT = parseInt(process.env.PORT || '8080', 10);
const TARGET = process.env.OPENHANDS_TARGET || 'http://127.0.0.1:8000';
const EXPECTED_SECRET = process.env.OPENHANDS_ORIGIN_SECRET || '';

const targetUrl = new URL(TARGET);
const transport = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest;

const server = http.createServer((req, res) => {
  // Health check — respond directly
  if (req.url === '/health' || req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', gateway: true }));
    return;
  }

  // Validate origin secret on all other paths
  const provided = (req.headers['x-projectsites-origin-secret'] || '').trim();
  if (!EXPECTED_SECRET || provided !== EXPECTED_SECRET) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Direct origin access forbidden' }));
    return;
  }

  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port,
    path: req.url,
    method: req.method,
    headers: { ...req.headers },
  };
  delete options.headers['x-projectsites-origin-secret'];
  delete options.headers['host'];
  delete options.headers['connection'];
  options.headers['host'] = targetUrl.host;

  const proxyReq = transport(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('Gateway proxy error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad gateway' }));
    }
  });

  req.pipe(proxyReq);
});

// WebSocket upgrade — validate secret, then pipe through
server.on('upgrade', (req, socket, head) => {
  // Validate origin secret for WebSocket too
  const provided = (req.headers['x-projectsites-origin-secret'] || '').trim();
  if (!EXPECTED_SECRET || provided !== EXPECTED_SECRET) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  const targetSocket = net.connect(
    parseInt(targetUrl.port, 10) || 8000,
    targetUrl.hostname,
    () => {
      const filteredHeaders = Object.entries(req.headers)
        .filter(([k]) => !['host', 'x-projectsites-origin-secret', 'connection'].includes(k.toLowerCase()))
        .map(([k, v]) => `${k}: ${v}`)
        .join('\r\n');

      targetSocket.write(
        `${req.method} ${req.url} HTTP/1.1\r\nHost: ${targetUrl.host}\r\n${filteredHeaders}\r\n\r\n`,
      );
      targetSocket.pipe(socket);
      socket.pipe(targetSocket);
    },
  );
  targetSocket.on('error', () => {
    socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    socket.destroy();
  });
});

server.listen(PORT, () => {
  console.log(`Gateway listening on :${PORT} → ${TARGET}`);
});
