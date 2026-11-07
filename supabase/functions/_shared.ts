// Shared helpers for PipaPost edge functions
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
export const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
export const FN_URL = `${SUPABASE_URL}/functions/v1`;
export const GRAPH = "https://graph.facebook.com/v21.0";
export const IG = "https://graph.instagram.com/v21.0";
/** Graph base for an Instagram account: Instagram-Login accounts use graph.instagram.com, page-linked ones graph.facebook.com */
export const igBase = (acc: any) => (acc.meta?.login === "instagram" ? IG : GRAPH);

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
export const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...cors, ...extra } });

export const admin = (): SupabaseClient => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/** Returns the user id from a bearer JWT, or null. */
export async function userFromReq(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const sb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data } = await sb.auth.getUser();
  return data.user?.id ?? null;
}

export async function cronOk(req: Request): Promise<boolean> {
  const sec = req.headers.get("x-cron-secret");
  if (!sec) return false;
  const { data } = await admin().from("pp_settings").select("value").eq("key", "cron_secret").maybeSingle();
  return !!data && data.value?.v === sec;
}

export async function credentials(owner: string): Promise<Record<string, string>> {
  const { data } = await admin().from("pp_settings").select("value").eq("key", "credentials").eq("owner", owner).maybeSingle();
  return (data?.value as Record<string, string>) || {};
}

export async function log(owner: string | null, message: string, detail: unknown = null, level = "info", post_id: string | null = null, account_id: string | null = null) {
  try { await admin().from("pp_logs").insert({ owner, message, detail, level, post_id, account_id }); } catch (_) { /* ignore */ }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function gfetch(url: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(url, init);
  const txt = await r.text();
  let body: any; try { body = JSON.parse(txt); } catch { body = { raw: txt }; }
  if (!r.ok) throw new Error(body?.error?.message || body?.error_description || body?.error?.error_user_msg || body?.message || `${r.status} ${txt.slice(0, 300)}`);
  return body;
}

/** Ensure Google access token is fresh; updates the account row when refreshed. */
export async function freshGoogleToken(acc: any, creds: Record<string, string>): Promise<string> {
  const exp = acc.token_expires_at ? new Date(acc.token_expires_at).getTime() : 0;
  if (exp - Date.now() > 120_000) return acc.access_token;
  if (!acc.refresh_token) throw new Error("YouTube token expired and no refresh token; reconnect the channel");
  const body = new URLSearchParams({ client_id: creds.google_client_id, client_secret: creds.google_client_secret, refresh_token: acc.refresh_token, grant_type: "refresh_token" });
  const t = await gfetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  await admin().from("pp_accounts").update({ access_token: t.access_token, token_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString() }).eq("id", acc.id);
  return t.access_token;
}

export async function freshTikTokToken(acc: any, creds: Record<string, string>): Promise<string> {
  const exp = acc.token_expires_at ? new Date(acc.token_expires_at).getTime() : 0;
  if (exp - Date.now() > 120_000) return acc.access_token;
  const body = new URLSearchParams({ client_key: creds.tiktok_client_key, client_secret: creds.tiktok_client_secret, grant_type: "refresh_token", refresh_token: acc.refresh_token });
  const t = await gfetch("https://open.tiktokapis.com/v2/oauth/token/", { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  await admin().from("pp_accounts").update({ access_token: t.access_token, refresh_token: t.refresh_token || acc.refresh_token, token_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString() }).eq("id", acc.id);
  return t.access_token;
}

/** Extend a Meta long-lived token when it is within 10 days of expiry. */
export async function freshMetaToken(acc: any, creds: Record<string, string>): Promise<string> {
  const exp = acc.token_expires_at ? new Date(acc.token_expires_at).getTime() : 0;
  if (!exp || exp - Date.now() > 10 * 86400_000) return acc.access_token;
  try {
    const t = await gfetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${creds.meta_app_id}&client_secret=${creds.meta_app_secret}&fb_exchange_token=${acc.access_token}`);
    await admin().from("pp_accounts").update({ access_token: t.access_token, token_expires_at: new Date(Date.now() + (t.expires_in || 5184000) * 1000).toISOString() }).eq("id", acc.id);
    return t.access_token;
  } catch { return acc.access_token; }
}

/** Instagram-Login long-lived tokens last 60 days; refresh when within 10 days of expiry. */
export async function freshIgToken(acc: any, creds: Record<string, string>): Promise<string> {
  if (acc.meta?.login !== "instagram") return freshMetaToken(acc, creds);
  const exp = acc.token_expires_at ? new Date(acc.token_expires_at).getTime() : 0;
  if (!exp || exp - Date.now() > 10 * 86400_000) return acc.access_token;
  try {
    const t = await gfetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${acc.access_token}`);
    await admin().from("pp_accounts").update({ access_token: t.access_token, token_expires_at: new Date(Date.now() + (t.expires_in || 5184000) * 1000).toISOString() }).eq("id", acc.id);
    return t.access_token;
  } catch { return acc.access_token; }
}

export async function headSize(url: string): Promise<{ size: number; type: string }> {
  const r = await fetch(url, { method: "HEAD" });
  return { size: Number(r.headers.get("content-length") || 0), type: r.headers.get("content-type") || "" };
}
