// PipaPost — publishes due posts to Instagram, Facebook, YouTube, TikTok and LinkedIn.
// Runs every minute from pg_cron (x-cron-secret) and on demand from the app ("Publish now", user JWT).
import { admin, credentials, cors, json, userFromReq, cronOk, gfetch, GRAPH, log, sleep, freshGoogleToken, freshTikTokToken, freshMetaToken, freshIgToken, igBase, headSize } from "./_shared.ts";

type Media = { url: string; type: string; path?: string; name?: string };
type Target = { account_id: string; type: string }; // type: post | reel | story | short | video
type Result = { status: string; url?: string; external_id?: string; error?: string; container_id?: string; publish_id?: string; attempts?: number; updated_at?: string };

const firstLine = (s: string) => (s || "").split("\n").find((l) => l.trim()) || "New post";
const hashtags = (s: string) => (s.match(/#[\p{L}\p{N}_]+/gu) || []).map((h) => h.slice(1));

// ---------------------------------------------------------------- Instagram
async function publishInstagram(acc: any, post: any, t: Target, prev: Result, creds: any): Promise<Result> {
  const token = await freshIgToken(acc, creds); const G = igBase(acc);
  const ig = acc.external_id; const media: Media[] = post.media || [];
  const caption = post.text || "";
  let container = prev.container_id;
  if (!container) {
    if (!media.length) throw new Error("Instagram needs an image or video");
    const p: Record<string, string> = { access_token: token };
    if (t.type === "story") {
      const m = media[0];
      if (m.type === "video") { p.media_type = "STORIES"; p.video_url = m.url; } else { p.media_type = "STORIES"; p.image_url = m.url; }
    } else if (t.type === "reel" || (media.length === 1 && media[0].type === "video")) {
      p.media_type = "REELS"; p.video_url = media[0].url; p.caption = caption; p.share_to_feed = "true";
    } else if (media.length > 1) {
      const children: string[] = [];
      for (const m of media.slice(0, 10)) {
        const cp: Record<string, string> = { access_token: token, is_carousel_item: "true" };
        if (m.type === "video") { cp.media_type = "VIDEO"; cp.video_url = m.url; } else cp.image_url = m.url;
        const c = await gfetch(`${G}/${ig}/media`, { method: "POST", body: new URLSearchParams(cp) });
        children.push(c.id);
      }
      for (const id of children) await waitContainer(id, token, 60, G);
      p.media_type = "CAROUSEL"; p.children = children.join(","); p.caption = caption;
    } else { p.image_url = media[0].url; p.caption = caption; }
    const c = await gfetch(`${G}/${ig}/media`, { method: "POST", body: new URLSearchParams(p) });
    container = c.id;
  }
  const ready = await waitContainer(container!, token, 100, G);
  if (!ready) return { status: "processing", container_id: container, attempts: (prev.attempts || 0) + 1 };
  const pub = await gfetch(`${G}/${ig}/media_publish`, { method: "POST", body: new URLSearchParams({ creation_id: container!, access_token: token }) });
  let permalink = "";
  try { const info = await gfetch(`${G}/${pub.id}?fields=permalink&access_token=${token}`); permalink = info.permalink; } catch { /* stories have no permalink */ }
  if (post.first_comment && t.type !== "story") {
    try { await gfetch(`${G}/${pub.id}/comments`, { method: "POST", body: new URLSearchParams({ message: post.first_comment, access_token: token }) }); } catch (e) { await log(post.owner, "First comment failed", { e: String(e) }, "warn", post.id, acc.id); }
  }
  return { status: "published", external_id: pub.id, url: permalink || `https://www.instagram.com/${acc.handle}/` };
}

async function waitContainer(id: string, token: string, maxSeconds: number, G = GRAPH): Promise<boolean> {
  const until = Date.now() + maxSeconds * 1000;
  while (Date.now() < until) {
    const s = await gfetch(`${G}/${id}?fields=status_code,status&access_token=${token}`);
    if (s.status_code === "FINISHED") return true;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram could not process the media: ${s.status || s.status_code}`);
    await sleep(5000);
  }
  return false;
}

// ---------------------------------------------------------------- Facebook page
async function publishFacebook(acc: any, post: any, t: Target, prev: Result, creds: any): Promise<Result> {
  const token = await freshMetaToken(acc, creds); const page = acc.page_id; const media: Media[] = post.media || [];
  const text = post.text || "";
  if (t.type === "reel" && media[0]?.type === "video") {
    let vid = prev.container_id;
    if (!vid) {
      const s = await gfetch(`${GRAPH}/${page}/video_reels`, { method: "POST", body: new URLSearchParams({ upload_phase: "start", access_token: token }) });
      vid = s.video_id;
      const up = await fetch(`https://rupload.facebook.com/video-reels/v21.0/${vid}`, { method: "POST", headers: { Authorization: `OAuth ${token}`, file_url: media[0].url } });
      if (!up.ok) throw new Error(`Reel upload failed: ${await up.text()}`);
      await gfetch(`${GRAPH}/${page}/video_reels`, { method: "POST", body: new URLSearchParams({ upload_phase: "finish", video_id: vid!, video_state: "PUBLISHED", description: text, access_token: token }) });
    }
    const st = await gfetch(`${GRAPH}/${vid}?fields=status&access_token=${token}`);
    const vs = st.status?.video_status;
    if (vs && vs !== "ready" && vs !== "published") return { status: "processing", container_id: vid, attempts: (prev.attempts || 0) + 1 };
    return { status: "published", external_id: vid, url: `https://www.facebook.com/reel/${vid}` };
  }
  if (t.type === "story") {
    const m = media[0]; if (!m) throw new Error("Story needs media");
    if (m.type === "video") {
      const s = await gfetch(`${GRAPH}/${page}/video_stories`, { method: "POST", body: new URLSearchParams({ upload_phase: "start", access_token: token }) });
      const up = await fetch(`https://rupload.facebook.com/video-stories/v21.0/${s.video_id}`, { method: "POST", headers: { Authorization: `OAuth ${token}`, file_url: m.url } });
      if (!up.ok) throw new Error(`Story upload failed: ${await up.text()}`);
      const f = await gfetch(`${GRAPH}/${page}/video_stories`, { method: "POST", body: new URLSearchParams({ upload_phase: "finish", video_id: s.video_id, access_token: token }) });
      return { status: "published", external_id: f.post_id || s.video_id, url: `https://www.facebook.com/${page}` };
    }
    const ph = await gfetch(`${GRAPH}/${page}/photos`, { method: "POST", body: new URLSearchParams({ url: m.url, published: "false", access_token: token }) });
    const st = await gfetch(`${GRAPH}/${page}/photo_stories`, { method: "POST", body: new URLSearchParams({ photo_id: ph.id, access_token: token }) });
    return { status: "published", external_id: st.post_id, url: `https://www.facebook.com/${page}` };
  }
  if (media[0]?.type === "video") {
    const v = await gfetch(`${GRAPH}/${page}/videos`, { method: "POST", body: new URLSearchParams({ file_url: media[0].url, description: text, title: post.title || firstLine(text), access_token: token }) });
    return { status: "published", external_id: v.id, url: `https://www.facebook.com/${page}/videos/${v.id}` };
  }
  if (media.length) {
    const ids: string[] = [];
    for (const m of media.slice(0, 10)) { const ph = await gfetch(`${GRAPH}/${page}/photos`, { method: "POST", body: new URLSearchParams({ url: m.url, published: "false", access_token: token }) }); ids.push(ph.id); }
    const p = new URLSearchParams({ message: text, access_token: token }); ids.forEach((id, i) => p.set(`attached_media[${i}]`, JSON.stringify({ media_fbid: id })));
    const r = await gfetch(`${GRAPH}/${page}/feed`, { method: "POST", body: p });
    return { status: "published", external_id: r.id, url: `https://www.facebook.com/${r.id}` };
  }
  const r = await gfetch(`${GRAPH}/${page}/feed`, { method: "POST", body: new URLSearchParams({ message: text, access_token: token }) });
  return { status: "published", external_id: r.id, url: `https://www.facebook.com/${r.id}` };
}

// ---------------------------------------------------------------- YouTube
async function publishYouTube(acc: any, post: any, t: Target, _prev: Result, creds: any): Promise<Result> {
  const token = await freshGoogleToken(acc, creds);
  const video = (post.media || []).find((m: Media) => m.type === "video"); if (!video) throw new Error("YouTube needs a video");
  const title = (post.title || firstLine(post.text)).slice(0, 100);
  const meta = { snippet: { title, description: post.text || "", tags: hashtags(post.text).slice(0, 30), categoryId: post.yt_category || "22" }, status: { privacyStatus: post.yt_privacy || "public", selfDeclaredMadeForKids: false } };
  const { size, type } = await headSize(video.url);
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Upload-Content-Type": type || "video/mp4", ...(size ? { "X-Upload-Content-Length": String(size) } : {}) }, body: JSON.stringify(meta) });
  if (!init.ok) throw new Error(`YouTube init failed: ${await init.text()}`);
  const loc = init.headers.get("location")!;
  const src = await fetch(video.url); if (!src.ok || !src.body) throw new Error("Could not read video file");
  const up = await fetch(loc, { method: "PUT", headers: { "Content-Type": type || "video/mp4", ...(size ? { "Content-Length": String(size) } : {}) }, body: src.body });
  const txt = await up.text(); if (!up.ok) throw new Error(`YouTube upload failed: ${txt.slice(0, 300)}`);
  const v = JSON.parse(txt);
  return { status: "published", external_id: v.id, url: `https://youtube.com/${t.type === "short" ? "shorts" : "watch?v="}${v.id}` };
}

// ---------------------------------------------------------------- TikTok
async function publishTikTok(acc: any, post: any, _t: Target, prev: Result, creds: any): Promise<Result> {
  const token = await freshTikTokToken(acc, creds);
  if (prev.publish_id) {
    const st = await gfetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ publish_id: prev.publish_id }) });
    const s = st.data?.status;
    if (s === "PUBLISH_COMPLETE") return { status: "published", external_id: st.data?.publicaly_available_post_id?.[0] || prev.publish_id, url: `https://www.tiktok.com/@${acc.handle}` };
    if (s === "FAILED") throw new Error(`TikTok: ${st.data?.fail_reason || "publish failed"}`);
    return { status: "processing", publish_id: prev.publish_id, attempts: (prev.attempts || 0) + 1 };
  }
  const video = (post.media || []).find((m: Media) => m.type === "video"); if (!video) throw new Error("TikTok needs a video");
  const { size } = await headSize(video.url); if (!size) throw new Error("Could not read video size");
  const init = await gfetch("https://open.tiktokapis.com/v2/post/publish/video/init/", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ post_info: { title: (post.text || "").slice(0, 2200), privacy_level: post.tt_privacy || "PUBLIC_TO_EVERYONE", disable_comment: false, disable_duet: false, disable_stitch: false }, source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 } }) });
  if (init.error?.code && init.error.code !== "ok") throw new Error(`TikTok: ${init.error.message || init.error.code}`);
  const src = await fetch(video.url);
  const up = await fetch(init.data.upload_url, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(size), "Content-Range": `bytes 0-${size - 1}/${size}` }, body: src.body });
  if (!up.ok && up.status !== 201) throw new Error(`TikTok upload failed: ${await up.text()}`);
  return { status: "processing", publish_id: init.data.publish_id, attempts: 1 };
}

// ---------------------------------------------------------------- LinkedIn
async function publishLinkedIn(acc: any, post: any, _t: Target, _prev: Result, _creds: any): Promise<Result> {
  const token = acc.access_token; const author = `urn:li:person:${acc.external_id}`;
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Restli-Protocol-Version": "2.0.0" };
  const media: Media[] = post.media || []; const assets: any[] = [];
  let category = "NONE";
  for (const m of media.slice(0, 9)) {
    const recipe = m.type === "video" ? "urn:li:digitalmediaRecipe:feedshare-video" : "urn:li:digitalmediaRecipe:feedshare-image";
    category = m.type === "video" ? "VIDEO" : "IMAGE";
    const reg = await gfetch("https://api.linkedin.com/v2/assets?action=registerUpload", { method: "POST", headers: H, body: JSON.stringify({ registerUploadRequest: { recipes: [recipe], owner: author, serviceRelationships: [{ relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" }] } }) });
    const uploadUrl = reg.value.uploadMechanism["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"].uploadUrl;
    const src = await fetch(m.url); const buf = await src.arrayBuffer();
    const up = await fetch(uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: buf });
    if (!up.ok && up.status !== 201) throw new Error(`LinkedIn upload failed: ${up.status}`);
    assets.push({ status: "READY", media: reg.value.asset, title: { text: post.title || "" } });
    if (m.type === "video") break;
  }
  const body = { author, lifecycleState: "PUBLISHED", specificContent: { "com.linkedin.ugc.ShareContent": { shareCommentary: { text: post.text || "" }, shareMediaCategory: category, ...(assets.length ? { media: assets } : {}) } }, visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" } };
  const r = await fetch("https://api.linkedin.com/v2/ugcPosts", { method: "POST", headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`LinkedIn post failed: ${await r.text()}`);
  const id = r.headers.get("x-restli-id") || "";
  return { status: "published", external_id: id, url: id ? `https://www.linkedin.com/feed/update/${id}` : "https://www.linkedin.com/feed/" };
}

const PUBLISHERS: Record<string, (acc: any, post: any, t: Target, prev: Result, creds: any) => Promise<Result>> = {
  instagram: publishInstagram, facebook: publishFacebook, youtube: publishYouTube, tiktok: publishTikTok, linkedin: publishLinkedIn,
};

async function processPost(post: any) {
  const sb = admin(); const creds = await credentials(post.owner);
  const results: Record<string, Result> = { ...(post.results || {}) };
  const targets: Target[] = post.targets || [];
  for (const t of targets) {
    const prev = results[t.account_id] || { status: "pending" };
    if (prev.status === "published") continue;
    if (prev.status === "failed" && (prev.attempts || 0) >= 3) continue;
    const { data: acc } = await sb.from("pp_accounts").select("*").eq("id", t.account_id).maybeSingle();
    if (!acc) { results[t.account_id] = { status: "failed", error: "Account no longer connected", attempts: 3 }; continue; }
    try {
      const r = await PUBLISHERS[acc.network](acc, post, t, prev, creds);
      results[t.account_id] = { ...r, updated_at: new Date().toISOString() };
      await log(post.owner, `${acc.network}: ${r.status}`, r, r.status === "published" ? "info" : "warn", post.id, acc.id);
    } catch (e) {
      const msg = String((e as Error).message || e);
      results[t.account_id] = { ...prev, status: "failed", error: msg, attempts: (prev.attempts || 0) + 1, updated_at: new Date().toISOString() };
      await log(post.owner, `${acc.network}: failed — ${msg}`, { error: msg }, "error", post.id, acc.id);
      if (/token|expired|OAuth|permission/i.test(msg)) await sb.from("pp_accounts").update({ last_error: msg }).eq("id", acc.id);
    }
    await sb.from("pp_posts").update({ results }).eq("id", post.id);
  }
  const vals = targets.map((t) => results[t.account_id]?.status || "pending");
  let status = "publishing";
  if (vals.every((v) => v === "published")) status = "published";
  else if (vals.every((v) => v === "published" || (v === "failed" && (results[targets[vals.indexOf(v)]?.account_id]?.attempts || 0) >= 3))) status = vals.some((v) => v === "published") ? "partial" : "failed";
  else if (vals.some((v) => v === "processing")) status = "publishing";
  else if (vals.some((v) => v === "failed")) status = "publishing"; // will retry on the next run
  const patch: any = { results, status };
  if (status === "published" || status === "partial") patch.published_at = new Date().toISOString();
  if (status === "failed") patch.error = Object.values(results).map((r) => r.error).filter(Boolean).join(" | ");
  await sb.from("pp_posts").update(patch).eq("id", post.id);
  return { id: post.id, status, results };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = admin();
  const isCron = await cronOk(req);
  const user = isCron ? null : await userFromReq(req);
  if (!isCron && !user) return json({ error: "unauthorized" }, 401);
  let body: any = {}; try { body = await req.json(); } catch { /* no body */ }

  if (user && body.post_id) {
    // Publish now (from the app): mark due and process immediately
    const { data: post } = await sb.from("pp_posts").select("*").eq("id", body.post_id).eq("owner", user).maybeSingle();
    if (!post) return json({ error: "post not found" }, 404);
    await sb.from("pp_posts").update({ status: "publishing", scheduled_at: post.scheduled_at || new Date().toISOString(), error: null }).eq("id", post.id);
    const out = await processPost({ ...post, status: "publishing" });
    return json(out);
  }

  // Cron: due scheduled posts, plus posts still processing (retry/poll), oldest first
  const now = new Date().toISOString();
  const { data: due } = await sb.from("pp_posts").select("*").in("status", ["scheduled", "publishing"]).lte("scheduled_at", now).order("scheduled_at").limit(4);
  const out: any[] = [];
  for (const post of due || []) {
    // skip posts whose last attempt was < 1 min ago (polling cadence)
    const last = Math.max(0, ...Object.values(post.results || {}).map((r: any) => r.updated_at ? new Date(r.updated_at).getTime() : 0));
    if (post.status === "publishing" && Date.now() - last < 50_000) continue;
    if (post.status === "scheduled") await sb.from("pp_posts").update({ status: "publishing" }).eq("id", post.id);
    out.push(await processPost(post));
  }
  return json({ processed: out.length, out });
});
