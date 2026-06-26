import { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../../lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query
  if (typeof id !== 'string') return res.status(400).end()

  if (req.method === 'PUT') {
    const { content } = req.body
    const post = await prisma.post.update({ where: { id }, data: { content } })
    return res.json(post)
  }

  if (req.method === 'DELETE') {
    await prisma.post.delete({ where: { id } })
    return res.status(204).end()
  }

  res.setHeader('Allow', ['PUT', 'DELETE'])
  res.status(405).end(`Method ${req.method} Not Allowed`)
}
