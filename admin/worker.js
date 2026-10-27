/**
 * HAMOSO Admin API
 * Secrets: ADMIN_PASSWORD, SESSION_SECRET
 * KV binding: LOGIN_LIMITS (rate-limit keys and content:announcements key)
 */
const SITE_ORIGIN = "https://hamosositemeiji.github.io";
const SESSION_SECONDS = 8 * 60 * 60;
const LIMIT_WINDOW_SECONDS = 15 *  60;
const MAX_ATTEMPTS = 5;
const CONTENT_KEY = "content:announcements";
const MEDIA_PREFIX = "media:";
const MAX_MEDIA_BYTES = 1500 * 1024;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders },
  });
}
function cors(origin) {
  if (origin !== SITE_ORIGIN) return {};
  return {
    "Access-Control-Allow-Origin": SITE_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}
function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function unb64url(s) {
  const raw = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
async function sign(payload, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}
async function validSession(token, secret) {
  if (!token || !secret) return false;
  const split = token.split(".");
  if (split.length !== 2) return false;
  const expected = await sign(split[0], secret);
  if (expected.length !== split[1].length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ split[1].charCodeAt(i);
  if (diff !== 0) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(unb64url(split[0])));
    return payload.exp > Math.floor(Date.now() / 1000) && payload.iss === "hamoso-admin";
  } catch { return false; }
}
function bearerToken(request) {
  const value = request.headers.get("Authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}
async function handle(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin") || "";
  const headers = cors(origin);
  if (request.method === "OPTIONS") {
    if (origin !== SITE_ORIGIN) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers });
  }
  if (origin && origin !== SITE_ORIGIN) return json({ error: "forbidden_origin" }, 403);
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || !env.LOGIN_LIMITS) return json({ error: "server_not_configured" }, 503, headers);

  if (url.pathname === "/api/login" && request.method === "POST") {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const key = "login:" + ip;
    const record = await env.LOGIN_LIMITS.get(key, "json");
    const now = Math.floor(Date.now() / 1000);
    const attempts = record && record.resetAt > now ? record.count : 0;
    if (attempts >= MAX_ATTEMPTS) {
      const wait = record.resetAt - now;
      return json({ error: "too_many_attempts", retryAfter: wait }, 429, { ...headers, "Retry-After": String(wait) });
    }
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid_request" }, 400, headers); }
    if (typeof body.password !== "string" || body.password.length > 1024 || body.password !== env.ADMIN_PASSWORD) {
      await env.LOGIN_LIMITS.put(key, JSON.stringify({
        count: attempts + 1,
        resetAt: record && record.resetAt > now ? record.resetAt : now + LIMIT_WINDOW_SECONDS,
      }), { expirationTtl: LIMIT_WINDOW_SECONDS });
      return json({ error: "invalid_credentials" }, 401, headers);
    }
    await env.LOGIN_LIMITS.delete(key);
    const payload = b64url(new TextEncoder().encode(JSON.stringify({ iss: "hamoso-admin", exp: now + SESSION_SECONDS })));
    const token = payload + "." + await sign(payload, env.SESSION_SECRET);
    return json({ ok: true, token, expiresIn: SESSION_SECONDS }, 200, headers);
  }

  if (url.pathname === "/api/session" && request.method === "GET") {
    const ok = await validSession(bearerToken(request), env.SESSION_SECRET);
    return json({ authenticated: ok }, ok ? 200 : 401, headers);
  }
  if (url.pathname === "/api/logout" && request.method === "POST") {
    return json({ ok: true }, 200, headers);
  }

  // Public media is served by an opaque ID; uploads require an authenticated admin session.
  if (url.pathname.startsWith("/media/") && request.method === "GET") {
    const id = url.pathname.slice("/media/".length);
    if (!/^[a-zA-Z0-9_-]{1,60}$/.test(id)) return json({ error: "not_found" }, 404, headers);
    const stored = await env.LOGIN_LIMITS.get(MEDIA_PREFIX + id, "json");
    if (!stored || typeof stored.data !== "string" || typeof stored.type !== "string") return json({ error: "not_found" }, 404, headers);
    const raw = atob(stored.data);
    const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
    return new Response(bytes, { status: 200, headers: { ...headers, "Content-Type": stored.type, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" } });
  }

  if (url.pathname === "/api/media" && request.method === "POST") {
    const authenticated = await validSession(bearerToken(request), env.SESSION_SECRET);
    if (!authenticated) return json({ error: "unauthorized" }, 401, headers);
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid_request" }, 400, headers); }
    const allowed = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    if (!allowed[body.type] || typeof body.data !== "string") return json({ error: "unsupported_image_type" }, 400, headers);
    const estimatedBytes = Math.floor(body.data.length * 3 / 4);
    if (estimatedBytes < 1 || estimatedBytes > MAX_MEDIA_BYTES || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)) return json({ error: "image_too_large_or_invalid" }, 413, headers);
    let bytes;
    try { bytes = Uint8Array.from(atob(body.data), c => c.charCodeAt(0)); } catch { return json({ error: "invalid_image_data" }, 400, headers); }
    if (bytes.length > MAX_MEDIA_BYTES) return json({ error: "image_too_large" }, 413, headers);
    const signatureOK = body.type === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : body.type === "image/png" ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      : bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    if (!signatureOK) return json({ error: "image_content_mismatch" }, 400, headers);
    const id = crypto.randomUUID().replace(/-/g, "");
    await env.LOGIN_LIMITS.put(MEDIA_PREFIX + id, JSON.stringify({ type: body.type, data: body.data }), { expirationTtl: 60 * 60 * 24 * 365 });
    return json({ ok: true, id, url: "https://hamoso-admin-auth.hamososaitoguanli.workers.dev/media/" + id }, 201, headers);
  }

  // All content routes require a valid bearer token.
  if (url.pathname === "/api/announcements" && (request.method === "GET" || request.method === "POST")) {
    const authenticated = await validSession(bearerToken(request), env.SESSION_SECRET);
    if (!authenticated) return json({ error: "unauthorized" }, 401, headers);
    if (request.method === "GET") {
      const items = await env.LOGIN_LIMITS.get(CONTENT_KEY, "json");
      return json({ items: Array.isArray(items) ? items : [] }, 200, headers);
    }
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid_request" }, 400, headers); }
    if (!Array.isArray(body.items) || body.items.length > 50) return json({ error: "invalid_items" }, 400, headers);
    const clean = [];
    for (const item of body.items) {
      if (!item || typeof item !== "object") return json({ error: "invalid_item" }, 400, headers);
      const title = typeof item.title === "string" ? item.title.trim() : "";
      const date = typeof item.date === "string" ? item.date.trim() : "";
      const category = typeof item.category === "string" ? item.category.trim() : "お知らせ";
      const bodyText = typeof item.body === "string" ? item.body.trim() : "";
      if (!title || title.length > 120 || date.length > 20 || category.length > 30 || bodyText.length > 3000) {
        return json({ error: "invalid_item_fields" }, 400, headers);
      }
      clean.push({
        id: typeof item.id === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(item.id) ? item.id : crypto.randomUUID(),
        title, date, category, body: bodyText,
        updatedAt: new Date().toISOString(),
      });
    }
    await env.LOGIN_LIMITS.put(CONTENT_KEY, JSON.stringify(clean));
    return json({ ok: true, items: clean }, 200, headers);
  }
  return json({ error: "not_found" }, 404, headers);
}
export default { fetch: handle };
