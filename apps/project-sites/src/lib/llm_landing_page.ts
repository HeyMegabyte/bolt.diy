/**
 * Landing page for `llm.projectsites.dev/` — the OpenAI-compatible LLM gateway.
 *
 * @remarks
 * The gateway exposes `/v1/*` (model discovery + chat completions) on this host,
 * but the bare root previously fell through to the site-serving catch-all and
 * returned a generic 404. This page gives a human who opens the host root a clear
 * "what is this + how do I use it" surface. Static, self-contained, brand-styled.
 */

const BASE_URL = 'https://llm.projectsites.dev/v1';

/** Full HTML document for the gateway landing page. */
export function llmLandingPage(): string {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LLM Gateway · ProjectSites</title>
<meta name="description" content="OpenAI-compatible LLM gateway — one base URL, every model, with routing, caching, and guardrails on Cloudflare's edge.">
<meta name="color-scheme" content="dark">
<link rel="canonical" href="https://llm.projectsites.dev/">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{min-height:100vh;background:#060610;color:#f4f4ff;font-family:'Space Grotesk',system-ui,sans-serif;line-height:1.6;
    display:flex;align-items:center;justify-content:center;padding:40px 20px;
    background-image:radial-gradient(60% 50% at 50% 0%,rgba(0,229,255,.10),transparent 70%)}
  .wrap{max-width:760px;width:100%}
  .eyebrow{font-family:'JetBrains Mono',monospace;font-size:.72rem;letter-spacing:.22em;text-transform:uppercase;color:#00e5ff;margin-bottom:14px}
  h1{font-size:clamp(2rem,6vw,3.2rem);font-weight:700;letter-spacing:-.03em;line-height:1.05;margin-bottom:14px;
    background:linear-gradient(135deg,#fff,rgba(0,229,255,.85));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
  .sub{color:#94a3b8;font-size:1.05rem;margin-bottom:32px;max-width:54ch}
  .card{background:linear-gradient(145deg,rgba(13,13,40,.55),rgba(8,8,32,.7));border:1px solid rgba(0,229,255,.12);
    border-radius:16px;padding:22px 22px 24px;margin-bottom:16px}
  .card h2{font-size:.78rem;font-family:'JetBrains Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:12px}
  .ep{display:flex;align-items:center;gap:10px;font-family:'JetBrains Mono',monospace;font-size:.82rem;padding:7px 0;color:#cbd5e1}
  .verb{font-weight:600;color:#00e5ff;min-width:42px}
  pre{background:#03070a;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:16px;overflow-x:auto;
    font-family:'JetBrains Mono',monospace;font-size:.78rem;color:#d7e3ec;line-height:1.55}
  .k{color:#00e5ff}.s{color:#7ee787}.c{color:#6b7785}
  a{color:#00e5ff;text-decoration:none}a:hover{text-decoration:underline}
  .foot{margin-top:26px;font-size:.82rem;color:#64748b}
  .base{font-family:'JetBrains Mono',monospace;color:#f4f4ff;background:rgba(0,229,255,.08);
    border:1px solid rgba(0,229,255,.18);border-radius:8px;padding:3px 9px;font-size:.82rem}
</style></head>
<body><main class="wrap">
  <p class="eyebrow">ProjectSites · Edge AI</p>
  <h1>LLM Gateway</h1>
  <p class="sub">One OpenAI-compatible base URL for every model — with routing, caching, and guardrails running on Cloudflare's edge. Point any OpenAI SDK at it.</p>

  <div class="card">
    <h2>Base URL</h2>
    <p class="ep"><span class="base">${BASE_URL}</span></p>
  </div>

  <div class="card">
    <h2>Endpoints</h2>
    <div class="ep"><span class="verb">GET</span><span>/v1/models</span><span class="c">— list available models</span></div>
    <div class="ep"><span class="verb">POST</span><span>/v1/chat/completions</span><span class="c">— chat (streaming supported)</span></div>
  </div>

  <div class="card">
    <h2>Quick start</h2>
    <pre><span class="c"># list models</span>
curl <span class="s">${BASE_URL}/models</span> \\
  -H <span class="s">"Authorization: Bearer &lt;YOUR_KEY&gt;"</span>

<span class="c"># chat completion</span>
curl <span class="s">${BASE_URL}/chat/completions</span> \\
  -H <span class="s">"Authorization: Bearer &lt;YOUR_KEY&gt;"</span> \\
  -H <span class="s">"Content-Type: application/json"</span> \\
  -d <span class="s">'{"model":"<span class="k">auto</span>","messages":[{"role":"user","content":"Hello"}]}'</span></pre>
  </div>

  <p class="foot">Manage keys, usage, and routing in the <a href="https://projectsites.dev/admin">dashboard</a>. · <a href="https://projectsites.dev">projectsites.dev</a></p>
</main></body></html>`;
}
