import { draftMode } from 'next/headers.js'

/**
 * Enable Next draft mode then redirect to the target path so editors see unpublished
 * content. The whole CMS host sits behind Cloudflare Access, so reaching this route
 * already proves staff identity — no extra preview token needed.
 *
 * @remarks Uses a plain `Response` redirect (not `next/navigation`'s `redirect`) so the
 * route handler doesn't pull the client app-router context into the server build.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const path = url.searchParams.get('path') || '/'
  const safePath = path.startsWith('/') ? path : `/${path}`
  ;(await draftMode()).enable()
  return Response.redirect(new URL(safePath, url.origin), 307)
}
