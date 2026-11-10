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
const SESSION_PREFIX = "session:";
const MAX_MEDIA_BYTES = 1500 * 1024;
const MAX_ANNOUNCEMENTS = 2000;
const MAX_ANNOUNCEMENTS_JSON_BYTES = 10 * 1024 * 1024;
const SITE_CONTENT_REVISION_KEY = "revision:site-content";
const ANNOUNCEMENTS_REVISION_KEY = "revision:announcements";
async function snapshotBeforeWrite(env, label, key) {
  const current = await env.LOGIN_LIMITS.get(key);
  if (current === null) return;
  const prefix = "backup:" + label + ":";
  const createdAt = new Date().toISOString();
  const backupKey = prefix + createdAt.replace(/[:.]/g, "-");
  await env.LOGIN_LIMITS.put(backupKey, JSON.stringify({ createdAt, value: current }), { expirationTtl: 60 * 60 * 24 * 90 });
  const listed = await env.LOGIN_LIMITS.list({ prefix, limit: 100 });
  const newest = listed.keys.sort((a, b) => b.name.localeCompare(a.name));
  for (const item of newest.slice(20)) await env.LOGIN_LIMITS.delete(item.name);
}
async function checkRevision(env, key, expected) {
  const current = (await env.LOGIN_LIMITS.get(key)) || "0";
  return { current, matches: typeof expected === "string" && expected === current };
}

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
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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
async function validSession(token, secret, env) {
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
    if (!(payload.exp > Math.floor(Date.now() / 1000) && payload.iss === "hamoso-admin" && typeof payload.sid === "string" && /^[a-f0-9-]{36}$/i.test(payload.sid))) return false;
    return (await env.LOGIN_LIMITS.get(SESSION_PREFIX + payload.sid)) === "active";
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
    const sid = crypto.randomUUID();
    const payload = b64url(new TextEncoder().encode(JSON.stringify({ iss: "hamoso-admin", exp: now + SESSION_SECONDS, sid })));
    await env.LOGIN_LIMITS.put(SESSION_PREFIX + sid, "active", { expirationTtl: SESSION_SECONDS });
    const token = payload + "." + await sign(payload, env.SESSION_SECRET);
    return json({ ok: true, token, expiresIn: SESSION_SECONDS }, 200, headers);
  }

  if (url.pathname === "/api/session" && request.method === "GET") {
    const ok = await validSession(bearerToken(request), env.SESSION_SECRET, env);
    return json({ authenticated: ok }, ok ? 200 : 401, headers);
  }
  if (url.pathname === "/api/logout" && request.method === "POST") {
    const token = bearerToken(request);
    if (!await validSession(token, env.SESSION_SECRET, env)) return json({ error: "unauthorized" }, 401, headers);
    try {
      const payloadPart = token.split(".")[0];
      const payload = JSON.parse(new TextDecoder().decode(unb64url(payloadPart)));
      await env.LOGIN_LIMITS.delete(SESSION_PREFIX + payload.sid);
    } catch {
      return json({ error: "invalid_session" }, 401, headers);
    }
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

  // Authenticated deletion also detaches the image from managed content records.
  if (url.pathname.startsWith("/api/media/") && request.method === "DELETE") {
    const authenticated = await validSession(bearerToken(request), env.SESSION_SECRET, env);
    if (!authenticated) return json({ error: "unauthorized" }, 401, headers);
    const id = url.pathname.slice("/api/media/".length);
    if (!/^[a-zA-Z0-9_-]{1,60}$/.test(id)) return json({ error: "not_found" }, 404, headers);
    const mediaKey = MEDIA_PREFIX + id;
    const stored = await env.LOGIN_LIMITS.get(mediaKey);
    if (!stored) return json({ error: "not_found" }, 404, headers);
    const imageUrl = "https://hamoso-admin-auth.hamososaitoguanli.workers.dev/media/" + id;
    let siteContentDetached = 0, announcementsDetached = 0;
    const siteContentKey = "content:site-content";
    const siteContent = await env.LOGIN_LIMITS.get(siteContentKey, "json");
    if (siteContent && typeof siteContent === "object" && !Array.isArray(siteContent) &&
        siteContent.activities && Array.isArray(siteContent.activities.photos)) {
      const before = siteContent.activities.photos.length;
      siteContent.activities.photos = siteContent.activities.photos.filter(value => value !== imageUrl);
      siteContentDetached = before - siteContent.activities.photos.length;
      if (siteContentDetached) await env.LOGIN_LIMITS.put(siteContentKey, JSON.stringify(siteContent));
    }
    const announcements = await env.LOGIN_LIMITS.get(CONTENT_KEY, "json");
    if (Array.isArray(announcements)) {
      let changed = false;
      for (const item of announcements) {
        if (item && item.imageUrl === imageUrl) {
          item.imageUrl = "";
          announcementsDetached++;
          changed = true;
        }
      }
      if (changed) await env.LOGIN_LIMITS.put(CONTENT_KEY, JSON.stringify(announcements));
    }
    await env.LOGIN_LIMITS.delete(mediaKey);
    return json({ ok: true, detached: { siteContent: siteContentDetached, announcements: announcementsDetached } }, 200, headers);
  }

  // One-time, authenticated migration for media objects created with the former 365-day TTL.
  if (url.pathname === "/api/media/extend-retention" && request.method === "POST") {
    const authenticated = await validSession(bearerToken(request), env.SESSION_SECRET, env);
    if (!authenticated) return json({ error: "unauthorized" }, 401, headers);
    let body = {};
    try { body = await request.json(); } catch {}
    const options = { prefix: MEDIA_PREFIX, limit: 100 };
    if (typeof body.cursor === "string" && body.cursor) options.cursor = body.cursor;
    const listed = await env.LOGIN_LIMITS.list(options);
    let extended = 0;
    for (const key of listed.keys) {
      const value = await env.LOGIN_LIMITS.get(key.name);
      if (value !== null) {
        await env.LOGIN_LIMITS.put(key.name, value);
        extended++;
      }
    }
    return json({ ok: true, extended, cursor: listed.list_complete ? null : listed.cursor, complete: listed.list_complete === true }, 200, headers);
  }

  if (url.pathname === "/api/media" && request.method === "POST") {
    const authenticated = await validSession(bearerToken(request), env.SESSION_SECRET, env);
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
    await env.LOGIN_LIMITS.put(MEDIA_PREFIX + id, JSON.stringify({ type: body.type, data: body.data }));
    return json({ ok: true, id, url: "https://hamoso-admin-auth.hamososaitoguanli.workers.dev/media/" + id }, 201, headers);
  }

  // Site content editor: private read/write endpoints for activity, media, recruitment and schedule.
  if (url.pathname === "/api/site-content" && (request.method === "GET" || request.method === "POST")) {
    const authenticated = await validSession(bearerToken(request), env.SESSION_SECRET, env);
    if (!authenticated) return json({ error: "unauthorized" }, 401, headers);
    const siteContentKey = "content:site-content";
    if (request.method === "GET") {
      const content = await env.LOGIN_LIMITS.get(siteContentKey, "json");
      const revision = (await env.LOGIN_LIMITS.get(SITE_CONTENT_REVISION_KEY)) || "0";
      return json({ content: content && typeof content === "object" ? content : {}, revision }, 200, headers);
    }
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid_request" }, 400, headers); }
    const content = body && body.content;
    if (!content || typeof content !== "object" || Array.isArray(content)) return json({ error: "invalid_content" }, 400, headers);
    const revisionState = await checkRevision(env, SITE_CONTENT_REVISION_KEY, body.expectedRevision);
    if (!revisionState.matches) return json({ error: "revision_conflict", revision: revisionState.current }, 409, headers);
    const serialized = JSON.stringify(content);
    if (serialized.length > 30000) return json({ error: "content_too_large" }, 413, headers);
    const safeUrl = value => typeof value === "string" && value.length <= 500 && (!value || /^https:\/\//i.test(value));
    const listOfUrls = value => Array.isArray(value) && value.length <= 30 && value.every(safeUrl);
    const listOfVideos = value => Array.isArray(value) && value.length <= 30 && value.every(item => {
      if (typeof item !== "string" || item.length > 623) return false;
      const separator = item.indexOf("|");
      const title = separator >= 0 ? item.slice(0, separator).trim() : "";
      const url = separator >= 0 ? item.slice(separator + 1).trim() : item.trim();
      return title.length <= 120 && safeUrl(url);
    });
    const a = content.activities || {}, m = content.media || {}, social = m.social || {}, r = content.recruit || {};
    const contacts = content.contacts || {};
    const schedule = content.schedule || {};
    const validScheduleRows = (rows, fields) => Array.isArray(rows) && rows.length <= 12 && rows.every(row =>
      row && typeof row === "object" && !Array.isArray(row) &&
      fields.every(([key, max]) => typeof (row[key] || "") === "string" && (row[key] || "").length <= max)
    );
    const validSchedule = content.schedule === undefined || (
      schedule && typeof schedule === "object" && !Array.isArray(schedule) &&
      typeof (schedule.location || "") === "string" && (schedule.location || "").length <= 300 &&
      typeof (schedule.notice || "") === "string" && (schedule.notice || "").length <= 500 &&
      validScheduleRows(schedule.regular || [], [["day", 80], ["time", 80], ["label", 300]]) &&
      validScheduleRows(schedule.yearly || [], [["when", 80], ["title", 200]])
    );
    const people = contacts.people === undefined ? [] : contacts.people;
    if (contacts.peopleConfigured !== undefined && typeof contacts.peopleConfigured !== "boolean") {
      return json({ error: "invalid_people_configuration" }, 400, headers);
    }
    const validPerson = person => person && typeof person === "object" && !Array.isArray(person) &&
      typeof (person.role || "") === "string" && (person.role || "").length <= 80 &&
      typeof (person.name || "") === "string" && (person.name || "").length <= 120 &&
      typeof (person.email || "") === "string" && (person.email || "").length <= 254 &&
      (!(person.email || "") || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email));
    if (!Array.isArray(people) || people.length > 3 || !people.every(validPerson)) return json({ error: "invalid_contact_people" }, 400, headers);
    const siteAdmins = contacts.siteAdmins === undefined ? [] : contacts.siteAdmins;
    if (!Array.isArray(siteAdmins) || siteAdmins.length > 3 || !siteAdmins.every(validPerson)) return json({ error: "invalid_site_admins" }, 400, headers);
    if (typeof a.title !== "string" || a.title.length > 120 || typeof a.text !== "string" || a.text.length > 5000 ||
        !listOfUrls(a.photos || []) || typeof m.videoTitle !== "string" || m.videoTitle.length > 120 ||
        !listOfVideos(m.videos || []) || !safeUrl(social.instagram || "") || !safeUrl(social.x || "") ||
        !safeUrl(social.youtube || "") || !listOfUrls(social.other || []) ||
        typeof r.title !== "string" || r.title.length > 120 || typeof r.text !== "string" || r.text.length > 5000 ||
        typeof (r.visitInfo || "") !== "string" || (r.visitInfo || "").length > 3000 ||
        !safeUrl(r.contactUrl || "") || !validSchedule) return json({ error: "invalid_content_fields" }, 400, headers);
    await snapshotBeforeWrite(env, "site-content", siteContentKey);
    const nextRevision = String(Number(revisionState.current) + 1);
    await env.LOGIN_LIMITS.put(siteContentKey, serialized);
    await env.LOGIN_LIMITS.put(SITE_CONTENT_REVISION_KEY, nextRevision);
    return json({ ok: true, revision: nextRevision }, 200, headers);
  }

  // Public site-content endpoint. Return only the explicitly supported public fields.
  // Unknown or future internal properties must never be exposed automatically.
  if (url.pathname === "/api/public/site-content" && request.method === "GET") {
    const stored = await env.LOGIN_LIMITS.get("content:site-content", "json");
    const source = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    const stringField = (object, key, max) =>
      object && typeof object[key] === "string" ? object[key].slice(0, max) : "";
    const safePublicUrl = value =>
      typeof value === "string" && value.length <= 500 && /^https:\/\//i.test(value) ? value : "";
    const publicPeople = value => Array.isArray(value) ? value.slice(0, 3)
      .filter(person => person && typeof person === "object" && !Array.isArray(person))
      .map(person => ({
        role: stringField(person, "role", 80),
        name: stringField(person, "name", 120),
        email: stringField(person, "email", 254),
      })) : [];
    const publicRows = (value, fields) => Array.isArray(value) ? value.slice(0, 12)
      .filter(item => item && typeof item === "object" && !Array.isArray(item))
      .map(item => Object.fromEntries(fields.map(([key, max]) => [key, stringField(item, key, max)]))) : [];
    const media = source.media && typeof source.media === "object" && !Array.isArray(source.media) ? source.media : {};
    const social = media.social && typeof media.social === "object" && !Array.isArray(media.social) ? media.social : {};
    const publicContent = {};
    const activities = source.activities && typeof source.activities === "object" && !Array.isArray(source.activities) ? source.activities : null;
    if (activities) {
      publicContent.activities = {
        title: stringField(activities, "title", 120),
        text: stringField(activities, "text", 5000),
      };
      if (Array.isArray(activities.photos)) {
        publicContent.activities.photos = activities.photos.filter(safePublicUrl).slice(0, 30);
      }
    }
    if (stored && source.media && typeof source.media === "object" && !Array.isArray(source.media)) {
      const publicMedia = { videoTitle: stringField(media, "videoTitle", 120) };
      if (Array.isArray(media.videos)) {
        publicMedia.videos = media.videos.filter(item => typeof item === "string" && item.length <= 623).slice(0, 30);
      }
      if (social && Object.keys(social).length) {
        publicMedia.social = {
          instagram: safePublicUrl(social.instagram),
          x: safePublicUrl(social.x),
          youtube: safePublicUrl(social.youtube),
        };
        if (Array.isArray(social.other)) {
          publicMedia.social.other = social.other.filter(safePublicUrl).slice(0, 30);
        }
      }
      publicContent.media = publicMedia;
    }
    const recruit = source.recruit && typeof source.recruit === "object" && !Array.isArray(source.recruit) ? source.recruit : null;
    if (recruit) {
      publicContent.recruit = {
        title: stringField(recruit, "title", 120),
        text: stringField(recruit, "text", 5000),
        visitInfo: stringField(recruit, "visitInfo", 3000),
        contactUrl: safePublicUrl(recruit.contactUrl),
      };
    }
    const scheduleSource = source.schedule && typeof source.schedule === "object" && !Array.isArray(source.schedule) ? source.schedule : null;
    if (scheduleSource) {
      publicContent.schedule = {};
      if (typeof scheduleSource.location === "string") {
        publicContent.schedule.location = scheduleSource.location.slice(0, 300);
      }
      if (typeof scheduleSource.notice === "string") {
        publicContent.schedule.notice = scheduleSource.notice.slice(0, 500);
      }
      if (Array.isArray(scheduleSource.regular)) {
        publicContent.schedule.regular = publicRows(scheduleSource.regular, [["day", 80], ["time", 80], ["label", 300]]);
      }
      if (Array.isArray(scheduleSource.yearly)) {
        publicContent.schedule.yearly = publicRows(scheduleSource.yearly, [["when", 80], ["title", 200]]);
      }
    }
    const contactsSource = source.contacts && typeof source.contacts === "object" && !Array.isArray(source.contacts) ? source.contacts : null;
    if (contactsSource) {
      publicContent.contacts = {};
      if (typeof contactsSource.peopleConfigured === "boolean") {
        publicContent.contacts.peopleConfigured = contactsSource.peopleConfigured;
      }
      if (Array.isArray(contactsSource.people)) {
        publicContent.contacts.people = publicPeople(contactsSource.people);
      }
      if (Array.isArray(contactsSource.siteAdmins)) {
        publicContent.contacts.siteAdmins = publicPeople(contactsSource.siteAdmins);
      }
    }
    return json({ content: publicContent }, 200, { ...headers, "Access-Control-Allow-Origin": SITE_ORIGIN, "Cache-Control": "public, max-age=60" });
  }
  // Public endpoint exposes only explicitly published announcements and safe display fields.
  if (url.pathname === "/api/public/announcements" && request.method === "GET") {
    const stored = await env.LOGIN_LIMITS.get(CONTENT_KEY, "json");
    const dateSortValue = value => {
      const match = String(value || "").trim().match(/^(\d{4})\s*(?:年|[-./])\s*(\d{1,2})(?:\s*(?:月|[-./])\s*(\d{1,2})\s*日?)?/);
      if (!match) return null;
      const year = Number(match[1]), month = Number(match[2]), day = match[3] ? Number(match[3]) : 0;
      if (month < 1 || month > 12 || (day !== 0 && (day < 1 || day > 31))) return null;
      return year * 10000 + month * 100 + day;
    };
    const items = (Array.isArray(stored) ? stored : [])
      .filter(item => item && item.published === true)
      .sort((a, b) => {
        const dateA = dateSortValue(a.date), dateB = dateSortValue(b.date);
        if (dateA === null && dateB === null) return String(b.date || "").localeCompare(String(a.date || ""));
        if (dateA === null) return 1;
        if (dateB === null) return -1;
        return dateB - dateA;
      })
      .slice(0, MAX_ANNOUNCEMENTS)
      .map(item => ({
        id: item.id, title: item.title, date: item.date, category: item.category, body: item.body, imageUrl: item.imageUrl || ""
      }));
    return json({ items }, 200, { ...headers, "Access-Control-Allow-Origin": SITE_ORIGIN, "Cache-Control": "public, max-age=60" });
  }

  // Full backup export: content first, then paginated media records.
  if (url.pathname === "/api/backup/export" && request.method === "GET") {
    const authenticated = await validSession(bearerToken(request), env.SESSION_SECRET, env);
    if (!authenticated) return json({ error: "unauthorized" }, 401, headers);
    const siteContent = await env.LOGIN_LIMITS.get("content:site-content", "json");
    const announcements = await env.LOGIN_LIMITS.get(CONTENT_KEY, "json");
    return json({
      format: "hamoso-kv-backup", version: 1, createdAt: new Date().toISOString(),
      siteContent: siteContent && typeof siteContent === "object" && !Array.isArray(siteContent) ? siteContent : {},
      announcements: Array.isArray(announcements) ? announcements : [],
      revisions: {
        siteContent: (await env.LOGIN_LIMITS.get(SITE_CONTENT_REVISION_KEY)) || "0",
        announcements: (await env.LOGIN_LIMITS.get(ANNOUNCEMENTS_REVISION_KEY)) || "0",
      },
    }, 200, headers);
  }
  if (url.pathname === "/api/backup/export-media" && request.method === "GET") {
    const authenticated = await validSession(bearerToken(request), env.SESSION_SECRET, env);
    if (!authenticated) return json({ error: "unauthorized" }, 401, headers);
    const options = { prefix: MEDIA_PREFIX, limit: 5 };
    const cursor = url.searchParams.get("cursor");
    if (cursor) options.cursor = cursor;
    const listed = await env.LOGIN_LIMITS.list(options);
    const items = [];
    for (const key of listed.keys) {
      const stored = await env.LOGIN_LIMITS.get(key.name, "json");
      if (stored && typeof stored.type === "string" && typeof stored.data === "string") {
        items.push({ id: key.name.slice(MEDIA_PREFIX.length), type: stored.type, data: stored.data });
      }
    }
    return json({ items, cursor: listed.list_complete ? null : listed.cursor, complete: listed.list_complete === true }, 200, headers);
  }
  if (url.pathname === "/api/backup/restore-media" && request.method === "POST") {
    const authenticated = await validSession(bearerToken(request), env.SESSION_SECRET, env);
    if (!authenticated) return json({ error: "unauthorized" }, 401, headers);
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid_request" }, 400, headers); }
    if (!Array.isArray(body.items) || body.items.length > 5) return json({ error: "invalid_backup_media_batch" }, 400, headers);
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    for (const item of body.items) {
      if (!item || !/^[a-zA-Z0-9_-]{1,60}$/.test(item.id) || !allowedTypes.includes(item.type) ||
          typeof item.data !== "string" || item.data.length > 2100000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) {
        return json({ error: "invalid_backup_media_item" }, 400, headers);
      }
      let bytes;
      try { bytes = Uint8Array.from(atob(item.data), c => c.charCodeAt(0)); } catch { return json({ error: "invalid_backup_media_data" }, 400, headers); }
      if (!bytes.length || bytes.length > MAX_MEDIA_BYTES) return json({ error: "invalid_backup_media_size" }, 400, headers);
      const ok = item.type === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : item.type === "image/png" ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
        : bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
      if (!ok) return json({ error: "backup_media_type_mismatch" }, 400, headers);
    }
    for (const item of body.items) await env.LOGIN_LIMITS.put(MEDIA_PREFIX + item.id, JSON.stringify({ type: item.type, data: item.data }));
    return json({ ok: true, restored: body.items.length }, 200, headers);
  }
  if (url.pathname === "/api/backup/restore-latest-snapshot" && request.method === "POST") {
    const authenticated = await validSession(bearerToken(request), env.SESSION_SECRET, env);
    if (!authenticated) return json({ error: "unauthorized" }, 401, headers);
    const siteList = await env.LOGIN_LIMITS.list({ prefix: "backup:site-content:", limit: 100 });
    const announcementList = await env.LOGIN_LIMITS.list({ prefix: "backup:announcements:", limit: 100 });
    const latest = list => list.keys.sort((a, b) => b.name.localeCompare(a.name))[0];
    const siteKey = latest(siteList), announcementKey = latest(announcementList);
    if (!siteKey || !announcementKey) return json({ error: "snapshot_not_found" }, 404, headers);
    const siteSnapshot = await env.LOGIN_LIMITS.get(siteKey.name, "json");
    const announcementSnapshot = await env.LOGIN_LIMITS.get(announcementKey.name, "json");
    if (!siteSnapshot || typeof siteSnapshot.value !== "string" || !announcementSnapshot || typeof announcementSnapshot.value !== "string") {
      return json({ error: "snapshot_invalid" }, 500, headers);
    }
    const siteRevision = (await env.LOGIN_LIMITS.get(SITE_CONTENT_REVISION_KEY)) || "0";
    const announcementRevision = (await env.LOGIN_LIMITS.get(ANNOUNCEMENTS_REVISION_KEY)) || "0";
    const nextSiteRevision = String(Number(siteRevision) + 1);
    const nextAnnouncementRevision = String(Number(announcementRevision) + 1);
    await env.LOGIN_LIMITS.put("content:site-content", siteSnapshot.value);
    await env.LOGIN_LIMITS.put(CONTENT_KEY, announcementSnapshot.value);
    await env.LOGIN_LIMITS.put(SITE_CONTENT_REVISION_KEY, nextSiteRevision);
    await env.LOGIN_LIMITS.put(ANNOUNCEMENTS_REVISION_KEY, nextAnnouncementRevision);
    return json({ ok: true, restoredSiteSnapshot: siteSnapshot.createdAt, restoredAnnouncementsSnapshot: announcementSnapshot.createdAt }, 200, headers);
  }
  if (url.pathname === "/api/backup/restore-content" && request.method === "POST") {
    const authenticated = await validSession(bearerToken(request), env.SESSION_SECRET, env);
    if (!authenticated) return json({ error: "unauthorized" }, 401, headers);
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid_request" }, 400, headers); }
    const siteContent = body.siteContent;
    const announcements = body.announcements;
    if (!siteContent || typeof siteContent !== "object" || Array.isArray(siteContent) ||
        JSON.stringify(siteContent).length > 30000 || !Array.isArray(announcements) || announcements.length > MAX_ANNOUNCEMENTS) {
      return json({ error: "invalid_backup_content" }, 400, headers);
    }
    const isRecord = value => value && typeof value === "object" && !Array.isArray(value);
    const optionalString = (object, key, max) => object[key] === undefined || (typeof object[key] === "string" && object[key].length <= max);
    const optionalHttps = value => value === undefined || (typeof value === "string" && value.length <= 500 && (!value || /^https:\/\//i.test(value)));
    const a = siteContent.activities, m = siteContent.media, r = siteContent.recruit, schedule = siteContent.schedule, contacts = siteContent.contacts;
    const social = isRecord(m) && isRecord(m.social) ? m.social : {};
    const validPeople = value => value === undefined || (Array.isArray(value) && value.length <= 3 && value.every(person =>
      isRecord(person) && optionalString(person, "role", 80) && optionalString(person, "name", 120) &&
      optionalString(person, "email", 254) && (person.email === undefined || !person.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email))));
    const validRows = (value, fields) => value === undefined || (Array.isArray(value) && value.length <= 12 &&
      value.every(row => isRecord(row) && fields.every(([key, max]) => optionalString(row, key, max))));
    const validSiteContent =
      (a === undefined || (isRecord(a) && optionalString(a, "title", 120) && optionalString(a, "text", 5000) &&
        (a.photos === undefined || (Array.isArray(a.photos) && a.photos.length <= 30 && a.photos.every(optionalHttps))))) &&
      (m === undefined || (isRecord(m) && optionalString(m, "videoTitle", 120) &&
        (m.videos === undefined || (Array.isArray(m.videos) && m.videos.length <= 30 && m.videos.every(value => typeof value === "string" && value.length <= 623))) &&
        (m.social === undefined || (isRecord(m.social) && optionalHttps(social.instagram) && optionalHttps(social.x) &&
          optionalHttps(social.youtube) && (social.other === undefined || (Array.isArray(social.other) && social.other.length <= 30 && social.other.every(optionalHttps))))))) &&
      (r === undefined || (isRecord(r) && optionalString(r, "title", 120) && optionalString(r, "text", 5000) &&
        optionalString(r, "visitInfo", 3000) && optionalHttps(r.contactUrl))) &&
      (schedule === undefined || (isRecord(schedule) && optionalString(schedule, "location", 300) &&
        optionalString(schedule, "notice", 500) && validRows(schedule.regular, [["day",80],["time",80],["label",300]]) &&
        validRows(schedule.yearly, [["when",80],["title",200]]))) &&
      (contacts === undefined || (isRecord(contacts) && (contacts.peopleConfigured === undefined || typeof contacts.peopleConfigured === "boolean") &&
        validPeople(contacts.people) && validPeople(contacts.siteAdmins)));
    if (!validSiteContent) return json({ error: "invalid_backup_site_content" }, 400, headers);
    if (JSON.stringify(announcements).length > MAX_ANNOUNCEMENTS_JSON_BYTES) return json({ error: "invalid_backup_announcements_size" }, 413, headers);
    if (!announcements.every(item => isRecord(item) && typeof item.title === "string" && item.title.length > 0 && item.title.length <= 120 &&
      typeof item.date === "string" && item.date.length <= 20 && typeof item.category === "string" && item.category.length <= 30 &&
      typeof item.body === "string" && item.body.length <= 3000 && typeof item.imageUrl === "string" && item.imageUrl.length <= 200 &&
      (item.id === undefined || typeof item.id === "string") && (item.published === undefined || typeof item.published === "boolean") &&
      (!item.imageUrl || /^https:\/\/hamoso-admin-auth\.hamososaitoguanli\.workers\.dev\/media\/[a-zA-Z0-9_-]{1,60}$/.test(item.imageUrl)))) {
      return json({ error: "invalid_backup_announcements" }, 400, headers);
    }
    await snapshotBeforeWrite(env, "site-content", "content:site-content");
    await snapshotBeforeWrite(env, "announcements", CONTENT_KEY);
    const siteRevision = (await env.LOGIN_LIMITS.get(SITE_CONTENT_REVISION_KEY)) || "0";
    const announcementsRevision = (await env.LOGIN_LIMITS.get(ANNOUNCEMENTS_REVISION_KEY)) || "0";
    const nextSiteRevision = String(Number(siteRevision) + 1);
    const nextAnnouncementsRevision = String(Number(announcementsRevision) + 1);
    await env.LOGIN_LIMITS.put("content:site-content", JSON.stringify(siteContent));
    await env.LOGIN_LIMITS.put(CONTENT_KEY, JSON.stringify(announcements));
    await env.LOGIN_LIMITS.put(SITE_CONTENT_REVISION_KEY, nextSiteRevision);
    await env.LOGIN_LIMITS.put(ANNOUNCEMENTS_REVISION_KEY, nextAnnouncementsRevision);
    return json({ ok: true, restoredAnnouncements: announcements.length, revision: { siteContent: nextSiteRevision, announcements: nextAnnouncementsRevision } }, 200, headers);
  }

  // All content routes require a valid bearer token.
  if (url.pathname === "/api/announcements" && (request.method === "GET" || request.method === "POST")) {
    const authenticated = await validSession(bearerToken(request), env.SESSION_SECRET, env);
    if (!authenticated) return json({ error: "unauthorized" }, 401, headers);
    if (request.method === "GET") {
      const items = await env.LOGIN_LIMITS.get(CONTENT_KEY, "json");
      const revision = (await env.LOGIN_LIMITS.get(ANNOUNCEMENTS_REVISION_KEY)) || "0";
      return json({ items: Array.isArray(items) ? items : [], revision }, 200, headers);
    }
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid_request" }, 400, headers); }
    if (!Array.isArray(body.items) || body.items.length > MAX_ANNOUNCEMENTS) return json({ error: "invalid_items" }, 400, headers);
    const revisionState = await checkRevision(env, ANNOUNCEMENTS_REVISION_KEY, body.expectedRevision);
    if (!revisionState.matches) return json({ error: "revision_conflict", revision: revisionState.current }, 409, headers);
    const clean = [];
    for (const item of body.items) {
      if (!item || typeof item !== "object") return json({ error: "invalid_item" }, 400, headers);
      const title = typeof item.title === "string" ? item.title.trim() : "";
      const date = typeof item.date === "string" ? item.date.trim() : "";
      const category = typeof item.category === "string" ? item.category.trim() : "お知らせ";
      const bodyText = typeof item.body === "string" ? item.body.trim() : "";
      const imageUrl = typeof item.imageUrl === "string" ? item.imageUrl.trim() : "";
      const published = item.published === true;
      const allowedImageUrl = !imageUrl || /^https:\/\/hamoso-admin-auth\.hamososaitoguanli\.workers\.dev\/media\/[a-zA-Z0-9_-]{1,60}$/.test(imageUrl);
      if (!title || title.length > 120 || date.length > 20 || category.length > 30 || bodyText.length > 3000 || imageUrl.length > 200 || !allowedImageUrl) {
        return json({ error: "invalid_item_fields" }, 400, headers);
      }
      clean.push({
        id: typeof item.id === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(item.id) ? item.id : crypto.randomUUID(),
        title, date, category, body: bodyText, imageUrl, published,
        updatedAt: new Date().toISOString(),
      });
    }
    if (JSON.stringify(clean).length > MAX_ANNOUNCEMENTS_JSON_BYTES) return json({ error: "announcements_too_large" }, 413, headers);
    await snapshotBeforeWrite(env, "announcements", CONTENT_KEY);
    const nextRevision = String(Number(revisionState.current) + 1);
    await env.LOGIN_LIMITS.put(CONTENT_KEY, JSON.stringify(clean));
    await env.LOGIN_LIMITS.put(ANNOUNCEMENTS_REVISION_KEY, nextRevision);
    return json({ ok: true, items: clean, revision: nextRevision }, 200, headers);
  }
  return json({ error: "not_found" }, 404, headers);
}
export default { fetch: handle };
