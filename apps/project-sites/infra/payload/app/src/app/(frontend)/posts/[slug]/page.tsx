import React from 'react'
import { draftMode } from 'next/headers.js'
import { notFound } from 'next/navigation.js'
import type { Metadata } from 'next'
import { RichText } from '@payloadcms/richtext-lexical/react'
import { getClient } from '@/lib/payload'
import '../../styles.css'

export const revalidate = 600

type Params = { params: Promise<{ slug: string }> }

const getPost = async (slug: string) => {
  const { isEnabled: draft } = await draftMode()
  const payload = await getClient()
  const res = await payload.find({
    collection: 'posts',
    where: { slug: { equals: slug } },
    draft,
    limit: 1,
    depth: 2,
    overrideAccess: draft,
  })
  return res.docs[0]
}

export async function generateStaticParams() {
  const payload = await getClient()
  const res = await payload.find({
    collection: 'posts',
    where: { _status: { equals: 'published' } },
    limit: 500,
    select: { slug: true },
  })
  return res.docs.map((d) => ({ slug: String((d as { slug?: string }).slug) }))
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const post = await getPost(slug)
  const meta = (post as { meta?: { title?: string; description?: string } })?.meta
  return {
    title: meta?.title || (post as { title?: string })?.title,
    description: meta?.description || (post as { excerpt?: string })?.excerpt,
  }
}

export default async function PostPage({ params }: Params) {
  const { slug } = await params
  const post = (await getPost(slug)) as {
    title?: string
    publishedAt?: string
    readingTime?: number
    author?: { name?: string }
    content?: unknown
  }
  if (!post) notFound()
  return (
    <main className="prose">
      <article>
        <h1>{post.title}</h1>
        <p className="post-meta">
          {post.author?.name ? <span>{post.author.name}</span> : null}
          {post.publishedAt ? (
            <time dateTime={post.publishedAt}>
              {new Date(post.publishedAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}
            </time>
          ) : null}
          {post.readingTime ? <span>{post.readingTime} min read</span> : null}
        </p>
        {post.content ? <RichText data={post.content as never} /> : null}
      </article>
    </main>
  )
}
