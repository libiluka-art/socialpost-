# Lukz Post — setup

Lukz Post is your own social-media scheduler (Instagram, Facebook Pages, YouTube, TikTok, LinkedIn).

**Web app:** this folder (static site on Netlify).
**Backend:** Supabase project `hyuqwbzdjgmsqcjrkgkk` — tables `pp_*`, storage bucket `pp-media`,
edge functions `pp-oauth` (connect accounts), `pp-publish` (runs every minute), `pp-analytics` (daily 06:15 Dubai + "Sync now").

## Sign in
Use your PIPA ONE login (libin@pipame.com + same password). Only that account can see Lukz Post data.

## Connect your channels (one-time, per platform)
Open the app → **Settings** → follow the setup guide for each platform (Meta ≈ 15 min, Google ≈ 10 min,
LinkedIn ≈ 10 min, TikTok needs their app review). Paste the keys, save, then **Accounts → Connect**.

The OAuth redirect URL to paste into every developer app:
`https://hyuqwbzdjgmsqcjrkgkk.supabase.co/functions/v1/pp-oauth?action=callback`

## Deploying an update
Drag this folder onto the Netlify site's Deploys page (Netlify Drop) — or connect the GitHub repo
`libiluka-art/socialpost-` to the site so every push deploys automatically.
