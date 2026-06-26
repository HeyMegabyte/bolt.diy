import React from 'react'
import type { Metadata } from 'next'
import { getClient } from '@/lib/payload'
import '../styles.css'

export const revalidate = 600
export const metadata: Metadata = { title: 'Blog', description: 'Latest posts.' }

export default async function PostsIndex() {
  const payload = await getClient()
  const res = await payload.find({
    collection: 'posts',
    where: { _status: { equals: 'published' } },
    sort: '-publishedAt',
    limit: 50,
    depth: 1,
  })
  return (
    <main className="prose">
      <h1>Blog</h1>
      {res.docs.length === 0 ? (
        <p>No posts published yet.</p>
      ) : (
        <ul className="post-list">
          {res.docs.map((p) => {
            const post = p as { slug?: string; title?: string; excerpt?: string; publishedAt?: string }
            return (
              <li key={post.slug}>
                <a href={`/posts/${post.slug}`}>
                  <h2>{post.title}</h2>
                </a>
                {post.publishedAt ? (
                  <time dateTime={post.publishedAt}>
                    {new Date(post.publishedAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}
                  </time>
                ) : null}
                {post.excerpt ? <p>{post.excerpt}</p> : null}
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
