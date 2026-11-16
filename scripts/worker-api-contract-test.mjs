import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

// Run only against the checked-out Worker code. No network, real credentials or KV writes.
const workerPath = new URL("../admin/worker.js", import.meta.url);
const original = fs.readFileSync(workerPath, "utf8");
const marker = "export default { fetch: handle };";
assert.ok(original.includes(marker), "Worker export hook is missing");
const source = original.replace(marker, "globalThis.__worker = { fetch: handle };");

let kvWrites = 0;
const kv = {
  async get() { return null; },
  async put() { kvWrites++; throw new Error("Unexpected KV write in unauthenticated contract test"); },
  async delete() { kvWrites++; throw new Error("Unexpected KV deletion in unauthenticated contract test"); },
  async list() { throw new Error("Unexpected KV list in unauthenticated contract test"); }
};
const sandbox = {
  crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array,
  Map, Date, Math, JSON, URL, Request, Response, Headers, atob, btoa
};
vm.runInNewContext(source, sandbox, { filename: "admin/worker.js" });
const fetchWorker = sandbox.__worker.fetch;
const env = {
  ADMIN_PASSWORD: "local-test-password-only",
  SESSION_SECRET: "local-test-secret-not-used-in-production",
  LOGIN_LIMITS: kv
};
const origin = "https://hamosositemeiji.github.io";
const host = "https://worker-contract.invalid";

// These endpoints have historically been missing in the deployed Worker.
// Missing routes must fail with 404; existing protected routes must return 401.
const protectedRoutes = [
  ["GET", "/api/session"],
  ["POST", "/api/password/change"],
  ["GET", "/api/media/library"],
  ["POST", "/api/media/delete-unused"],
  ["GET", "/api/backup/export"],
  ["GET", "/api/backup/export-media"],
  ["POST", "/api/backup/restore-media"],
  ["POST", "/api/backup/restore-content"],
  ["POST", "/api/backup/restore-latest-snapshot"]
];

for (const [method, route] of protectedRoutes) {
  const request = new Request(host + route, {
    method,
    headers: { Origin: origin, ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
    ...(method === "POST" ? { body: "{}" } : {})
  });
  const response = await fetchWorker(request, env);
  assert.equal(response.status, 401, method + " " + route + " must exist and reject unauthenticated users");
  assert.equal(response.headers.get("Cache-Control"), "no-store", method + " " + route + " must not be cached");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin, method + " " + route + " CORS origin mismatch");
}
assert.equal(kvWrites, 0, "unauthenticated requests must not mutate KV");
console.log("Worker API contract passed: " + protectedRoutes.length + " authenticated routes reject anonymous requests; no network or KV mutations.");
