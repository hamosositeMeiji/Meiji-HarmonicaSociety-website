import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const workerPath = new URL("../admin/worker.js", import.meta.url);
const workerSource = fs.readFileSync(workerPath, "utf8").replace(
  "export default { fetch: handle };",
  "globalThis.__worker = { fetch: handle };"
);
assert.notEqual(workerSource, fs.readFileSync(workerPath, "utf8"), "Worker export hook must be found");

const store = new Map();
const kv = {
  async get(key, type) {
    const value = store.get(key);
    if (value === undefined) return null;
    return type === "json" ? JSON.parse(value) : value;
  },
  async put(key, value) { store.set(key, value); },
  async delete(key) { store.delete(key); },
  async list({ prefix = "", limit = 1000, cursor } = {}) {
    const all = [...store.keys()].filter(key => key.startsWith(prefix)).sort();
    const offset = cursor ? Number(cursor) : 0;
    const keys = all.slice(offset, offset + limit).map(name => ({ name }));
    const next = offset + keys.length;
    const list_complete = next >= all.length;
    return { keys, list_complete, cursor: list_complete ? undefined : String(next) };
  }
};

const sandbox = {
  crypto: webcrypto,
  TextEncoder,
  TextDecoder,
  Uint8Array,
  Map,
  Date,
  Math,
  JSON,
  URL,
  Request,
  Response,
  Headers,
  atob,
  btoa,
  console
};
vm.runInNewContext(workerSource, sandbox, { filename: "admin/worker.js" });
const fetchWorker = sandbox.__worker.fetch;
const env = {
  ADMIN_PASSWORD: "initial-test-password",
  SESSION_SECRET: "test-session-secret-with-enough-entropy",
  LOGIN_LIMITS: kv
};
const base = "https://hamoso-admin-auth.hamososaitoguanli.workers.dev";
const usedA = "media-used-a";
const usedB = "media-used-b";
const unused = "media-unused";

store.set("media:" + usedA, JSON.stringify({ type: "image/jpeg", data: "AQID" }));
store.set("media:" + usedB, JSON.stringify({ type: "image/png", data: "BAUG" }));
store.set("media:" + unused, JSON.stringify({ type: "image/webp", data: "BwgJ" }));
store.set("content:site-content", JSON.stringify({
  activities: { photos: [base + "/media/" + usedA] },
  gallery: { cover: base + "/media/" + usedB }
}));
store.set("content:announcements", JSON.stringify([
  { title: "演奏会のお知らせ", image: base + "/media/" + usedB }
]));

async function call(path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetchWorker(new Request(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }), env);
  let data = {};
  try { data = await response.json(); } catch {}
  return { status: response.status, data };
}

const denied = await call("/api/media/library");
assert.equal(denied.status, 401, "media library must require authentication");

const login = await call("/api/login", { method: "POST", body: { password: env.ADMIN_PASSWORD } });
assert.equal(login.status, 200, "test admin login must succeed");
const token = login.data.token;
assert.ok(token, "login must return a session token");

const listing = await call("/api/media/library", { token });
assert.equal(listing.status, 200, "authenticated media listing must succeed");
assert.equal(listing.data.items.length, 3, "all stored media entries must be listed");
const itemA = listing.data.items.find(item => item.id === usedA);
const itemB = listing.data.items.find(item => item.id === usedB);
const itemUnused = listing.data.items.find(item => item.id === unused);
assert.equal(itemA.usageCount, 1, "activity photo reference must be detected");
assert.equal(itemB.usageCount, 2, "nested site and announcement references must be detected");
assert.equal(itemUnused.usageCount, 0, "unused media must have no detected references");
assert.equal(itemUnused.sizeBytes, 3, "base64 payload size must be reported accurately");

const blockedA = await call("/api/media/delete-unused", { method: "POST", token, body: { id: usedA } });
assert.equal(blockedA.status, 409, "referenced media must not be deleted");
assert.equal(store.has("media:" + usedA), true, "referenced media must remain stored");
const blockedB = await call("/api/media/delete-unused", { method: "POST", token, body: { id: usedB } });
assert.equal(blockedB.status, 409, "media referenced by announcements must not be deleted");
assert.equal(store.has("media:" + usedB), true, "announcement media must remain stored");

const legacyBlocked = await call("/api/media/" + usedB, { method: "DELETE", token });
assert.equal(legacyBlocked.status, 409, "legacy delete route must refuse unknown nested references");
assert.ok(legacyBlocked.data.references.some(label => label.includes("gallery / cover")));
assert.equal(store.has("media:" + usedB), true, "legacy delete must preserve media with unknown references");
const announcementsAfterBlockedDelete = JSON.parse(store.get("content:announcements"));
assert.equal(announcementsAfterBlockedDelete[0].image, base + "/media/" + usedB, "preflight rejection must not partially detach known references");

const legacyDeleteA = await call("/api/media/" + usedA, { method: "DELETE", token });
assert.equal(legacyDeleteA.status, 200, "legacy delete may remove media when all known references can be detached");
assert.equal(store.has("media:" + usedA), false);
const siteContentAfterLegacyDelete = JSON.parse(store.get("content:site-content"));
assert.equal(siteContentAfterLegacyDelete.activities.photos.length, 0, "known activity references must be detached");

const deleted = await call("/api/media/delete-unused", { method: "POST", token, body: { id: unused } });
assert.equal(deleted.status, 200, "unused media may be deleted");
assert.equal(store.has("media:" + unused), false, "unused media must be removed from storage");

const invalid = await call("/api/media/delete-unused", { method: "POST", token, body: { id: "../content:site-content" } });
assert.equal(invalid.status, 400, "invalid media IDs must be rejected");

console.log("Media library tests passed: authentication, listing, nested references, accurate size, protected deletion, legacy deletion preflight, and unused deletion.");
