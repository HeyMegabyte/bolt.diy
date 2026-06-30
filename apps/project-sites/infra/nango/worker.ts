export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    url.hostname = 'projectsites-nango.fly.dev';
    return fetch(url.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'follow',
    });
  },
};
