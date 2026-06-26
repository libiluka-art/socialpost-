# SocialPost - Minimal full-stack social posting app

This repository contains a scaffolded Next.js + TypeScript app with Prisma (SQLite/Postgres-ready), NextAuth authentication, Tailwind CSS, and simple API endpoints for posts and likes.

Quick start (local):

1. Install dependencies
   npm install

2. Copy environment variables
   cp .env.example .env
   (edit .env to set values; SQLite default will create dev.db)

3. Generate Prisma client & run migrations
   npx prisma generate
   npx prisma migrate dev --name init

4. Run the app
   npm run dev

Auth: This project is configured to work with NextAuth. Add GITHUB_ID and GITHUB_SECRET for GitHub OAuth, or configure email provider SMTP vars.

Deploy: Vercel is recommended. Use a Postgres database for production and set DATABASE_URL accordingly.
