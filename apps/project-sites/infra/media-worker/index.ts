/**
 * projectsites-media — read-only public file server for the Listmonk media R2
 * bucket, bound to media.projectsites.dev.
 *
 * Listmonk uploads to the `projectsites-listmonk-media` R2 bucket via the S3 API
 * and references assets as `https://media.projectsites.dev/<key>` (newsletter
 * images, logos, attachments). This Worker serves those keys with long-lived
 * immutable caching + permissive CORS so they render in any email client.
 *
 * Read-only by design: only GET/HEAD; never writes. Uploads go through Listmonk's
 * S3 path, not this Worker.
 */
export interface Env {
  MEDIA: R2Bucket;
}

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    }

    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!key) return new Response('Not found', { status: 404 });

    const object = await env.MEDIA.get(key, {
      onlyIf: request.headers,
      range: request.headers,
    });
    if (object === null) return new Response('Not found', { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('cache-control', IMMUTABLE_CACHE);
    headers.set('access-control-allow-origin', '*');
    headers.set('x-content-type-options', 'nosniff');

    // `body` is absent on a 304 (onlyIf) or a HEAD; R2 sets the status via the body presence.
    const hasBody = 'body' in object && (object as R2ObjectBody).body !== undefined;
    if (!hasBody || request.method === 'HEAD') {
      const status = hasBody ? 200 : 304;
      return new Response(null, { status, headers });
    }
    return new Response((object as R2ObjectBody).body, { headers });
  },
};
