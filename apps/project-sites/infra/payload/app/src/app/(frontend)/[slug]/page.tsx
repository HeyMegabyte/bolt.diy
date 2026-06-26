import React from 'react'
import { draftMode } from 'next/headers.js'
import { notFound } from 'next/navigation.js'
import type { Metadata } from 'next'
import { getClient } from '@/lib/payload'
import { RenderBlocks } from '../components/RenderBlocks'
import '../styles.css'

export const revalidate = 3600

type Params = { params: Promise<{ slug: string }> }

const getPage = async (slug: string) => {
  const { isEnabled: draft } = await draftMode()
  const payload = await getClient()
  const res = await payload.find({
    collection: 'pages',
    where: { slug: { equals: slug } },
    draft,
    limit: 1,
    overrideAccess: draft,
  })
  return res.docs[0]
}

export async function generateStaticParams() {
  const payload = await getClient()
  const res = await payload.find({ collection: 'pages', limit: 200, select: { slug: true } })
  return res.docs
    .map((d) => (d as { slug?: string }).slug)
    .filter((s): s is string => Boolean(s) && s !== 'home')
    .map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const page = await getPage(slug)
  const meta = (page as { meta?: { title?: string; description?: string } })?.meta
  return { title: meta?.title || (page as { title?: string })?.title, description: meta?.description }
}

export default async function Page({ params }: Params) {
  const { slug } = await params
  const page = await getPage(slug)
  if (!page) notFound()
  return (
    <main>
      <RenderBlocks blocks={(page as { layout?: never[] }).layout} />
    </main>
  )
}
