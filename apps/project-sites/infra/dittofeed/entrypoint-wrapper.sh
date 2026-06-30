#!/usr/bin/env bash
set -eu

echo "[wrapper] Binding health-check server on :3000"

# Start a minimal Node.js HTTP server on port 3000 immediately.
# This satisfies the CF Container health check while Dittofeed boots.
# When Dittofeed becomes ready on :3001, it proxies traffic there.
node -e '
const http = require("http");
const { spawn } = require("child_process");

const PROXY_PORT = 3000;
const DITTO_PORT = 3001;
const BOOT_TIMEOUT_MS = 180_000; // 3 min max

let dittoReady = false;
let dittoProcess = null;

const server = http.createServer((req, res) => {
  if (dittoReady) {
    // Proxy to Dittofeed
    const opts = {
      hostname: "127.0.0.1",
      port: DITTO_PORT,
      path: req.url,
      method: req.method,
      headers: req.headers,
    };
    const proxy = http.request(opts, (pres) => {
      res.writeHead(pres.statusCode, pres.headers);
      pres.pipe(res);
    });
    proxy.on("error", () => {
      res.writeHead(502);
      res.end("Dittofeed unreachable");
    });
    req.pipe(proxy);
  } else {
    // Starting up page
    res.writeHead(200, { "Content-Type": "text/html;charset=utf-8" });
    res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="color-scheme" content="dark"><meta http-equiv="refresh" content="5"><title>Engage · ProjectSites</title>
<style>body{min-height:100vh;background:#060610;color:#f4f4ff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center}div{text-align:center}h1{font-size:2rem;margin-bottom:.5rem}p{color:#94a3b8}.spinner{width:40px;height:40px;margin:1rem auto;border:3px solid #1e1e3f;border-top-color:#00e5ff;border-radius:50%;animation:s .8s linear infinite}@keyframes s{to{transform:rotate(360deg)}}</style></head><body><div><h1>Engage</h1><p>Customer engagement is starting up…</p><div class="spinner"></div></div></body></html>`);
  }
});

server.listen(PROXY_PORT, "0.0.0.0", () => {
  console.log("[wrapper] Health server listening on :" + PROXY_PORT);
});

// Launch Dittofeed on port 3001
console.log("[wrapper] Launching Dittofeed on :" + DITTO_PORT);
const env = Object.assign({}, process.env, { PORT: String(DITTO_PORT) });
dittoProcess = spawn("node", [
  "--max-old-space-size=824",
  "./packages/lite/dist/scripts/startLite.js",
  "--workspace-name=" + (process.env.WORKSPACE_NAME || "ProjectSites"),
], { env, stdio: "inherit", cwd: "/service" });

dittoProcess.on("exit", (code) => {
  console.error("[wrapper] Dittofeed exited with code " + code);
  if (!dittoReady) process.exit(1);
});

// Poll for Dittofeed readiness
const start = Date.now();
const interval = setInterval(() => {
  const req = http.get("http://127.0.0.1:" + DITTO_PORT + "/", (res) => {
    if (res.statusCode < 500) {
      dittoReady = true;
      clearInterval(interval);
      console.log("[wrapper] Dittofeed ready after " + (Date.now() - start) + "ms");
    }
  });
  req.on("error", () => {});
  req.setTimeout(2000, () => req.destroy());
  if (Date.now() - start > BOOT_TIMEOUT_MS) {
    clearInterval(interval);
    console.error("[wrapper] Dittofeed boot timeout — exiting");
    process.exit(1);
  }
}, 3000);
'
