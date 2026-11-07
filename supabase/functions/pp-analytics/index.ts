// PipaPost — pulls account + post analytics (daily cron, or on demand from the app)
import { admin, credentials, cors, json, userFromReq, cronOk, gfetch, GRAPH, log, freshGoogleToken, freshTikTokToken, freshMetaToken } from "./_shared.ts";

const today = () => new Date().toISOString().slice(0, 10);

async function accountStats(acc: any, creds: any): Promise<any> {
  const n = acc.network;
  if (n === "instagram") {
    const tk = await freshMetaToken(acc, creds);
    const u = await gfetch(`${GRAPH}/${acc.external_id}?fields=followers_count,follows_count,media_count&access_token=${tk}`);
    let ins: any = {};
    try {
      const i = await gfetch(`${GRAPH}/${acc.external_id}/insights?metric=reach,profile_views,accounts_engaged&period=day&metric_type=total_value&access_token=${tk}`);
      for (const m of i.data || []) ins[m.name] = m.total_value?.value ?? m.values?.[0]?.value;
    } catch (_) { /* insights need enough followers */ }
    return { followers: u.followers_count, following: u.follows_count, posts: u.media_count, reach: ins.reach, profile_views: ins.profile_views, engagement: ins.accounts_engaged, raw: { u, ins } };
  }
  if (n === "facebook") {
    const tk = await freshMetaToken(acc, creds);
    const p = await gfetch(`${GRAPH}/${acc.page_id}?fields=followers_count,fan_count&access_token=${tk}`);
    let ins: any = {};
    try { const i = await gfetch(`${GRAPH}/${acc.page_id}/insights?metric=page_impressions,page_post_engagements,page_views_total&period=day&access_token=${tk}`); for (const m of i.data || []) ins[m.name] = m.values?.at(-1)?.value; } catch (_) {}
    return { followers: p.followers_count ?? p.fan_count, impressions: ins.page_impressions, engagement: ins.page_post_engagements, profile_views: ins.page_views_total, raw: { p, ins } };
  }
  if (n === "youtube") {
    const tk = await freshGoogleToken(acc, creds);
    const c = await gfetch("https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true", { headers: { Authorization: `Bearer ${tk}` } });
    const s = c.items?.[0]?.statistics || {};
    return { followers: Number(s.subscriberCount || 0), posts: Number(s.videoCount || 0), views: Number(s.viewCount || 0), raw: s };
  }
  if (n === "tiktok") {
    const tk = await freshTikTokToken(acc, creds);
    const u = await gfetch("https://open.tiktokapis.com/v2/user/info/?fields=follower_count,following_count,likes_count,video_count", { headers: { Authorization: `Bearer ${tk}` } });
    const s = u.data?.user || {};
    return { followers: s.follower_count, following: s.following_count, posts: s.video_count, engagement: s.likes_count, raw: s };
  }
  return null; // linkedin personal profiles expose no stats API
}

async function postStats(acc: any, res: any, creds: any): Promise<any> {
  const n = acc.network; const id = res.external_id; if (!id) return null;
  if (n === "instagram") {
    const tk = await freshMetaToken(acc, creds);
    const m = await gfetch(`${GRAPH}/${id}?fields=like_count,comments_count,media_type,media_product_type&access_token=${tk}`);
    let ins: any = {};
    try {
      const metric = m.media_product_type === "REELS" ? "plays,reach,saved,shares,total_interactions" : "impressions,reach,saved,shares";
      const i = await gfetch(`${GRAPH}/${id}/insights?metric=${metric}&access_token=${tk}`);
      for (const x of i.data || []) ins[x.name] = x.values?.[0]?.value;
    } catch (_) {}
    return { likes: m.like_count, comments: m.comments_count, saves: ins.saved, shares: ins.shares, views: ins.plays, reach: ins.reach, impressions: ins.impressions, raw: { m, ins } };
  }
  if (n === "facebook") {
    const tk = await freshMetaToken(acc, creds);
    const p = await gfetch(`${GRAPH}/${id}?fields=likes.summary(true),comments.summary(true),shares&access_token=${tk}`);
    return { likes: p.likes?.summary?.total_count, comments: p.comments?.summary?.total_count, shares: p.shares?.count, raw: p };
  }
  if (n === "youtube") {
    const tk = await freshGoogleToken(acc, creds);
    const v = await gfetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${id}`, { headers: { Authorization: `Bearer ${tk}` } });
    const s = v.items?.[0]?.statistics || {};
    return { likes: Number(s.likeCount || 0), comments: Number(s.commentCount || 0), views: Number(s.viewCount || 0), raw: s };
  }
  if (n === "tiktok") {
    const tk = await freshTikTokToken(acc, creds);
    const q = await gfetch("https://open.tiktokapis.com/v2/video/query/?fields=id,like_count,comment_count,share_count,view_count", { method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" }, body: JSON.stringify({ filters: { video_ids: [id] } }) });
    const s = q.data?.videos?.[0] || {};
    return { likes: s.like_count, comments: s.comment_count, shares: s.share_count, views: s.view_count, raw: s };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = admin();
  const isCron = await cronOk(req); const user = isCron ? null : await userFromReq(req);
  if (!isCron && !user) return json({ error: "unauthorized" }, 401);

  let q = sb.from("pp_accounts").select("*").eq("status", "connected");
  if (user) q = q.eq("owner", user);
  const { data: accounts } = await q;
  const summary: any[] = [];
  for (const acc of accounts || []) {
    const creds = await credentials(acc.owner);
    try {
      const s = await accountStats(acc, creds);
      if (s) { const { raw, ...rest } = s; await sb.from("pp_account_stats").upsert({ owner: acc.owner, account_id: acc.id, day: today(), ...rest, raw, fetched_at: new Date().toISOString() }, { onConflict: "account_id,day" }); }
      if (s?.followers != null) await sb.from("pp_accounts").update({ meta: { ...(acc.meta || {}), followers: s.followers } }).eq("id", acc.id);
      summary.push({ account: acc.handle, ok: true });
    } catch (e) { summary.push({ account: acc.handle, error: String((e as Error).message || e) }); await log(acc.owner, `Analytics ${acc.network} failed`, { e: String(e) }, "warn", null, acc.id); }
  }
  // Post metrics for posts published in the last 60 days
  const since = new Date(Date.now() - 60 * 86400_000).toISOString();
  let pq = sb.from("pp_posts").select("id,owner,results,targets").in("status", ["published", "partial"]).gte("published_at", since).limit(200);
  if (user) pq = pq.eq("owner", user);
  const { data: posts } = await pq;
  let n = 0;
  for (const p of posts || []) {
    const creds = await credentials(p.owner);
    for (const [accId, res] of Object.entries<any>(p.results || {})) {
      if (res.status !== "published") continue;
      const acc = (accounts || []).find((a) => a.id === accId); if (!acc) continue;
      try {
        const s = await postStats(acc, res, creds);
        if (s) { const { raw, ...rest } = s; await sb.from("pp_post_stats").upsert({ owner: p.owner, post_id: p.id, account_id: accId, external_id: res.external_id, ...rest, raw, fetched_at: new Date().toISOString() }, { onConflict: "post_id,account_id" }); n++; }
      } catch (_) { /* skip */ }
    }
  }
  return json({ accounts: summary, posts_updated: n });
});
