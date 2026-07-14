export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Redirect root to /dashboard so Next.js client-side routing
    // starts from the correct basePath (avoids "Failed to lookup route: /")
    if (path === "/") {
      return Response.redirect("https://engage.projectsites.dev/dashboard", 307);
    }
    
    // Don't rewrite — serve paths as-is. Dittofeed's Next.js basePath
    // is /dashboard, so all routes live under /dashboard/...
    url.protocol = "http:";
    url.hostname = "projectsites-engage.fly.dev";
    
    return fetch(url.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
  },
};
