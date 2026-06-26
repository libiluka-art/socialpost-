import { Post } from '@prisma/client'

export default function PostCard({ post }: { post: Post & { author?: any } }) {
  return (
    <article className="bg-white p-4 rounded shadow-sm mb-4">
      <div className="text-sm text-gray-600 mb-2">{post.author?.name ?? 'Unknown'}</div>
      <p className="mb-2">{post.content}</p>
      {post.image && <img src={post.image} alt="post image" className="max-h-64 w-full object-cover rounded" />}
      <div className="text-xs text-gray-400 mt-2">{new Date(post.createdAt).toLocaleString()}</div>
    </article>
  )
}
