export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': 'https://billing.projectsites.dev',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }

    const resp = await fetch(`https://projectsites-lago.fly.dev${url.pathname}${url.search}`, {
      method: request.method,
      headers: { Host: 'projectsites-lago.fly.dev' },
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    });

    const headers = new Headers(resp.headers);
    headers.set('Access-Control-Allow-Origin', 'https://billing.projectsites.dev');
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', '*');

    return new Response(resp.body, {
      status: resp.status,
      headers,
    });
  },
};
