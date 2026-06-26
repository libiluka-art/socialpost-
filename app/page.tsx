import Header from '../components/Header'
import PostCard from '../components/PostCard'

export default async function Page() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/posts`, { cache: 'no-store' })
  const posts: any[] = await res.json()

  return (
    <div>
      <Header />
      <section className="mb-6 bg-white p-4 rounded shadow-sm">
        <h2 className="font-semibold mb-2">Create a post</h2>
        <p className="text-sm text-gray-500">Use the API endpoint POST /api/posts with authorId and content.</p>
      </section>

      <section>
        {posts.map((p) => (
          <PostCard key={p.id} post={p} />
        ))}
      </section>
    </div>
  )
}
