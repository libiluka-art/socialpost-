import { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../../lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { postId } = req.query
  if (typeof postId !== 'string') return res.status(400).end()

  // Toggle like: expects userId in body (simplified - in production, get from session)
  if (req.method === 'POST') {
    const { userId } = req.body
    if (!userId) return res.status(400).json({ error: 'userId required' })
    const existing = await prisma.like.findUnique({ where: { userId_postId: { userId, postId } as any } })
    if (existing) {
      await prisma.like.delete({ where: { id: existing.id } })
      return res.json({ liked: false })
    } else {
      await prisma.like.create({ data: { userId, postId } })
      return res.json({ liked: true })
    }
  }

  if (req.method === 'GET') {
    const count = await prisma.like.count({ where: { postId } })
    return res.json({ count })
  }

  res.setHeader('Allow', ['GET', 'POST'])
  res.status(405).end(`Method ${req.method} Not Allowed`)
}
