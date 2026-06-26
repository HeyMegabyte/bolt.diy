import { draftMode } from 'next/headers.js'
import { redirect } from 'next/navigation.js'

/**
 * Enable Next draft mode then redirect to the target path so editors see unpublished
 * content. The whole CMS host sits behind Cloudflare Access, so reaching this route
 * already proves staff identity — no extra preview token needed.
 */
export async function GET(req: Request) {
  const path = new URL(req.url).searchParams.get('path') || '/'
  const safePath = path.startsWith('/') ? path : `/${path}`
  ;(await draftMode()).enable()
  redirect(safePath)
}
