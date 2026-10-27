/**
 * HAMOSO Admin Auth API
 * Deploy as a Cloudflare Worker. Keep ADMIN_PASSWORD and SESSION_SECRET in Worker Secrets.
 * Bind a KV namespace named LOGIN_LIMITS before deployment.
 */
const SITE_ORIGIN = "https://hamosositemeiji.github.io";
const SESSION_SECONDS = 8 * 60 * 60;
const LIMIT_WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 5;

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
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type",
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
function cookieValue(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  const part = cookies.split(";").map(v => v.trim()).find(v => v.startsWith(name + "="));
  return part ? part.slice(name.length + 1) : "";
}
function sessionCookie(value, maxAge) {
  return `hamoso_admin_session=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None`;
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
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || !env.LOGIN_LIMITS) {
    return json({ error: "server_not_configured" }, 503, headers);
  }
  if (url.pathname === "/api/login" && request.method === "POST") {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const key = "login:" + ip;
    const record = await env.LOGIN_LIMITS.get(key, "json");
    const now = Math.floor(Date.now() / 1000);
    const attempts = record && record.resetAt > now ? record.count : 0;
    if (attempts >= MAX_ATTEMPTS) return json({ error: "too_many_attempts", retryAfter: record.resetAt - now }, 429, { ...headers, "Retry-After": String(record.resetAt - now) });
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid_request" }, 400, headers); }
    if (typeof body.password !== "string" || body.password.length > 1024 || body.password !== env.ADMIN_PASSWORD) {
      await env.LOGIN_LIMITS.put(key, JSON.stringify({ count: attempts + 1, resetAt: record && record.resetAt > now ? record.resetAt : now + LIMIT_WINDOW_SECONDS }), { expirationTtl: LIMIT_WINDOW_SECONDS });
      return json({ error: "invalid_credentials" }, 401, headers);
    }
    await env.LOGIN_LIMITS.delete(key);
    const payload = b64url(new TextEncoder().encode(JSON.stringify({ iss: "hamoso-admin", exp: now + SESSION_SECONDS })));
    const token = payload + "." + await sign(payload, env.SESSION_SECRET);
    return json({ ok: true, expiresIn: SESSION_SECONDS }, 200, { ...headers, "Set-Cookie": sessionCookie(token, SESSION_SECONDS) });
  }
  if (url.pathname === "/api/session" && request.method === "GET") {
    const ok = await validSession(cookieValue(request, "hamoso_admin_session"), env.SESSION_SECRET);
    return json({ authenticated: ok }, ok ? 200 : 401, headers);
  }
  if (url.pathname === "/api/logout" && request.method === "POST") {
    return json({ ok: true }, 200, { ...headers, "Set-Cookie": sessionCookie("", 0) });
  }
  return json({ error: "not_found" }, 404, headers);
}
export default { fetch: handle };
