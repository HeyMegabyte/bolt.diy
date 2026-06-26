import React from 'react'
import { draftMode } from 'next/headers.js'
import type { Metadata } from 'next'
import { getClient } from '@/lib/payload'
import { RenderBlocks } from './components/RenderBlocks'
import './styles.css'

export const dynamic = 'force-dynamic'

const getHome = async () => {
  const { isEnabled: draft } = await draftMode()
  const payload = await getClient()
  const res = await payload.find({
    collection: 'pages',
    where: { slug: { equals: 'home' } },
    draft,
    limit: 1,
    overrideAccess: draft,
  })
  return res.docs[0]
}

export async function generateMetadata(): Promise<Metadata> {
  const page = await getHome()
  const meta = (page as { meta?: { title?: string; description?: string } })?.meta
  return {
    title: meta?.title || 'ProjectSites',
    description: meta?.description || 'AI-built websites, delivered.',
  }
}

export default async function HomePage() {
  const page = await getHome()
  if (!page) {
    return (
      <main className="prose">
        <h1>ProjectSites CMS</h1>
        <p>
          No <code>home</code> page published yet. Create a Page with slug <code>home</code> in the{' '}
          <a href="/admin">admin panel</a>.
        </p>
      </main>
    )
  }
  return (
    <main>
      <RenderBlocks blocks={(page as { layout?: never[] }).layout} />
    </main>
  )
}
