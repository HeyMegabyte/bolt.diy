export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    url.protocol = "http:";
    url.hostname = "168.220.85.96";
    const resp = await fetch(url.toString(), {
      method: request.method,
      headers: request.headers,
      signal: AbortSignal.timeout(90000),
    });
    return resp;
  },
};
