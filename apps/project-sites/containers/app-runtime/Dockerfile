# AppRuntime base image — "coming soon" placeholder for catalog apps that
# haven't yet been wired into their own per-image DO subclass.
#
# Cloudflare Containers binds the image at `wrangler.toml` config time, so
# until CFC ships dynamic-image-at-start every catalog entry needs either
# (a) this base image surfacing a friendly "coming soon" page or (b) its
# own AppRuntimeContainer subclass + dedicated `[[containers]]` block.
#
# This base image serves a tiny static HTML page on the port the catalog
# entry declares (default 3000) — handles every health-check the worker
# proxy might issue while we ramp up the per-app subclasses.
FROM node:22-alpine

WORKDIR /app

RUN echo '#!/bin/sh' > /app/server.sh && \
    echo 'exec node -e "const http=require(\"http\");const port=process.env.PORT||3000;http.createServer((q,r)=>{r.writeHead(200,{\"content-type\":\"text/html\"});r.end(\"<!doctype html><meta charset=utf-8><title>Coming soon · ProjectSites Apps</title><style>body{background:#0a0a0f;color:#e0e0e0;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:2rem;text-align:center}h1{background:linear-gradient(135deg,#00ffc8,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent}</style><h1>Coming soon</h1><p>This catalog app is provisioned but its container image is not yet wired into the AppRuntime base. Open the admin to inspect or destroy this instance.\");}).listen(port);"' >> /app/server.sh && \
    chmod +x /app/server.sh

EXPOSE 3000
CMD ["/app/server.sh"]
