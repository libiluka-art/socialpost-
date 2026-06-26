import Link from 'next/link'

export default function Header() {
  return (
    <header className="flex items-center justify-between mb-6">
      <h1 className="text-2xl font-bold"><Link href="/">SocialPost</Link></h1>
      <nav className="space-x-4">
        <Link href="/">Feed</Link>
        <Link href="/profile">Profile</Link>
      </nav>
    </header>
  )
}
