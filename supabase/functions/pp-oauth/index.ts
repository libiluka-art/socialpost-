// PipaPost — OAuth connect flow for Instagram/Facebook (Meta), YouTube (Google), TikTok, LinkedIn
import { admin, credentials, cors, json, userFromReq, gfetch, GRAPH, FN_URL, log } from "./_shared.ts";

const REDIRECT = `${FN_URL}/pp-oauth?action=callback`;

const SCOPES: Record<string, string> = {
  instagram: "instagram_basic,instagram_content_publish,instagram_manage_insights,pages_show_list,pages_read_engagement,business_management",
  facebook: "pages_show_list,pages_manage_posts,pages_read_engagement,read_insights,business_management",
  youtube: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly",
  tiktok: "user.info.basic,user.info.profile,user.info.stats,video.publish,video.upload,video.list",
  linkedin: "openid profile email w_member_social",
};

function authUrl(network: string, c: Record<string, string>, state: string): string {
  switch (network) {
    case "instagram":
    case "facebook":
      return `https://www.facebook.com/v21.0/dialog/oauth?client_id=${c.meta_app_id}&redirect_uri=${encodeURIComponent(REDIRECT)}&state=${state}&scope=${SCOPES[network]}&response_type=code`;
    case "youtube":
      return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${c.google_client_id}&redirect_uri=${encodeURIComponent(REDIRECT)}&state=${state}&scope=${encodeURIComponent(SCOPES.youtube)}&response_type=code&access_type=offline&prompt=consent&include_granted_scopes=true`;
    case "tiktok":
      return `https://www.tiktok.com/v2/auth/authorize/?client_key=${c.tiktok_client_key}&redirect_uri=${encodeURIComponent(REDIRECT)}&state=${state}&scope=${SCOPES.tiktok}&response_type=code`;
    case "linkedin":
      return `https://www.linkedin.com/oauth/v2/authorization?client_id=${c.linkedin_client_id}&redirect_uri=${encodeURIComponent(REDIRECT)}&state=${state}&scope=${encodeURIComponent(SCOPES.linkedin)}&response_type=code`;
  }
  throw new Error("unknown network");
}

async function connectMeta(owner: string, network: string, code: string, c: Record<string, string>) {
  const sb = admin();
  const t = await gfetch(`${GRAPH}/oauth/access_token?client_id=${c.meta_app_id}&client_secret=${c.meta_app_secret}&redirect_uri=${encodeURIComponent(REDIRECT)}&code=${code}`);
  const ll = await gfetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${c.meta_app_id}&client_secret=${c.meta_app_secret}&fb_exchange_token=${t.access_token}`);
  const userToken = ll.access_token; const expires = new Date(Date.now() + (ll.expires_in || 5184000) * 1000).toISOString();
  const pages = await gfetch(`${GRAPH}/me/accounts?fields=id,name,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url,followers_count}&limit=50&access_token=${userToken}`);
  let n = 0;
  for (const p of pages.data || []) {
    if (network === "facebook") {
      await sb.from("pp_accounts").upsert({ owner, network: "facebook", name: p.name, handle: p.name, avatar_url: p.picture?.data?.url, external_id: p.id, page_id: p.id, access_token: p.access_token, token_expires_at: expires, scopes: SCOPES.facebook, status: "connected", last_error: null }, { onConflict: "owner,network,external_id" });
      n++;
    } else if (p.instagram_business_account) {
      const ig = p.instagram_business_account;
      await sb.from("pp_accounts").upsert({ owner, network: "instagram", name: ig.name || ig.username, handle: ig.username, avatar_url: ig.profile_picture_url, external_id: ig.id, page_id: p.id, access_token: p.access_token, token_expires_at: expires, scopes: SCOPES.instagram, status: "connected", last_error: null, meta: { followers: ig.followers_count } }, { onConflict: "owner,network,external_id" });
      n++;
    }
  }
  if (!n) throw new Error(network === "instagram" ? "No Instagram professional account found on your Facebook pages. Make sure your Instagram is a Business/Creator account linked to a Facebook Page." : "No Facebook pages found");
  return n;
}

async function connectGoogle(owner: string, code: string, c: Record<string, string>) {
  const body = new URLSearchParams({ code, client_id: c.google_client_id, client_secret: c.google_client_secret, redirect_uri: REDIRECT, grant_type: "authorization_code" });
  const t = await gfetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  const ch = await gfetch("https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true", { headers: { Authorization: `Bearer ${t.access_token}` } });
  const item = ch.items?.[0]; if (!item) throw new Error("No YouTube channel on this Google account");
  await admin().from("pp_accounts").upsert({ owner, network: "youtube", name: item.snippet.title, handle: item.snippet.customUrl || item.snippet.title, avatar_url: item.snippet.thumbnails?.default?.url, external_id: item.id, access_token: t.access_token, refresh_token: t.refresh_token, token_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(), scopes: SCOPES.youtube, status: "connected", last_error: null, meta: { subscribers: Number(item.statistics?.subscriberCount || 0) } }, { onConflict: "owner,network,external_id" });
}

async function connectTikTok(owner: string, code: string, c: Record<string, string>) {
  const body = new URLSearchParams({ client_key: c.tiktok_client_key, client_secret: c.tiktok_client_secret, code, grant_type: "authorization_code", redirect_uri: REDIRECT });
  const t = await gfetch("https://open.tiktokapis.com/v2/oauth/token/", { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  if (t.error) throw new Error(t.error_description || t.error);
  const u = await gfetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url,username,follower_count", { headers: { Authorization: `Bearer ${t.access_token}` } });
  const user = u.data?.user || {};
  await admin().from("pp_accounts").upsert({ owner, network: "tiktok", name: user.display_name, handle: user.username || user.display_name, avatar_url: user.avatar_url, external_id: t.open_id, access_token: t.access_token, refresh_token: t.refresh_token, token_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(), scopes: SCOPES.tiktok, status: "connected", last_error: null, meta: { followers: user.follower_count } }, { onConflict: "owner,network,external_id" });
}

async function connectLinkedIn(owner: string, code: string, c: Record<string, string>) {
  const body = new URLSearchParams({ grant_type: "authorization_code", code, client_id: c.linkedin_client_id, client_secret: c.linkedin_client_secret, redirect_uri: REDIRECT });
  const t = await gfetch("https://www.linkedin.com/oauth/v2/accessToken", { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  const me = await gfetch("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${t.access_token}` } });
  await admin().from("pp_accounts").upsert({ owner, network: "linkedin", name: me.name, handle: me.email || me.name, avatar_url: me.picture, external_id: me.sub, access_token: t.access_token, refresh_token: t.refresh_token || null, token_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(), scopes: SCOPES.linkedin, status: "connected", last_error: null }, { onConflict: "owner,network,external_id" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url); const action = url.searchParams.get("action");
  const sb = admin();

  if (action === "start") {
    const owner = await userFromReq(req); if (!owner) return json({ error: "unauthorized" }, 401);
    const { network, redirect_to } = await req.json();
    const c = await credentials(owner);
    const need: Record<string, string[]> = { instagram: ["meta_app_id", "meta_app_secret"], facebook: ["meta_app_id", "meta_app_secret"], youtube: ["google_client_id", "google_client_secret"], tiktok: ["tiktok_client_key", "tiktok_client_secret"], linkedin: ["linkedin_client_id", "linkedin_client_secret"] };
    const missing = (need[network] || []).filter((k) => !c[k]);
    if (missing.length) return json({ error: `Add ${missing.join(", ")} in Settings first` }, 400);
    const state = crypto.randomUUID().replace(/-/g, "");
    await sb.from("pp_oauth_states").insert({ state, owner, network, redirect_to });
    return json({ url: authUrl(network, c, state), redirect_uri: REDIRECT });
  }

  if (action === "callback") {
    const state = url.searchParams.get("state") || ""; const code = url.searchParams.get("code");
    const { data: st } = await sb.from("pp_oauth_states").select("*").eq("state", state).maybeSingle();
    if (!st) return new Response("Invalid or expired state. Go back to PipaPost and try again.", { status: 400 });
    await sb.from("pp_oauth_states").delete().eq("state", state);
    const back = st.redirect_to || "/";
    const err = url.searchParams.get("error_description") || url.searchParams.get("error");
    if (err || !code) return Response.redirect(`${back}#/accounts?error=${encodeURIComponent(err || "denied")}`, 302);
    try {
      const c = await credentials(st.owner);
      if (st.network === "instagram" || st.network === "facebook") await connectMeta(st.owner, st.network, code, c);
      else if (st.network === "youtube") await connectGoogle(st.owner, code, c);
      else if (st.network === "tiktok") await connectTikTok(st.owner, code, c);
      else if (st.network === "linkedin") await connectLinkedIn(st.owner, code, c);
      await log(st.owner, `Connected ${st.network}`);
      return Response.redirect(`${back}#/accounts?connected=${st.network}`, 302);
    } catch (e) {
      await log(st.owner, `Connect ${st.network} failed`, { error: String(e) }, "error");
      return Response.redirect(`${back}#/accounts?error=${encodeURIComponent(String((e as Error).message || e))}`, 302);
    }
  }

  if (action === "redirect_uri") return json({ redirect_uri: REDIRECT });
  return json({ error: "unknown action" }, 400);
});
