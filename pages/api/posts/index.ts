import { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../../lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const posts = await prisma.post.findMany({ include: { author: true, likes: true }, orderBy: { createdAt: 'desc' } })
    return res.json(posts)
  }

  if (req.method === 'POST') {
    const { content, image, authorId } = req.body
    if (!content || !authorId) return res.status(400).json({ error: 'content and authorId required' })
    const post = await prisma.post.create({ data: { content, image, authorId } })
    return res.status(201).json(post)
  }

  res.setHeader('Allow', ['GET', 'POST'])
  res.status(405).end(`Method ${req.method} Not Allowed`)
}
