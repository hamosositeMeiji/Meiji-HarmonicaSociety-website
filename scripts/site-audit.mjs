import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const origin = "https://hamosositemeiji.github.io";
const projectPath = "/Meiji-HarmonicaSociety-website/";
const sitemapXml = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
const sitemapTxt = fs.readFileSync(path.join(root, "sitemap.txt"), "utf8").trim().split(/\r?\n/);
assert.match(sitemapXml, /^<urlset\s+xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
const xmlUrls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1].trim());
assert.ok(xmlUrls.length > 0, "sitemap.xml must contain URLs");
assert.equal(new Set(xmlUrls).size, xmlUrls.length, "sitemap.xml contains duplicate URLs");
assert.deepEqual(xmlUrls, sitemapTxt, "sitemap.xml and sitemap.txt must contain the same URLs in the same order");

function attr(tag, name) {
  const match = tag.match(new RegExp(name + "=(?:\\x22([^\\x22]*)\\x22|\\x27([^\\x27]*)\\x27)", "i"));
  return match ? (match[1] ?? match[2]) : null;
}
function existsForUrl(url) {
  const parsed = new URL(url);
  assert.equal(parsed.origin, origin, "sitemap URL must use the published origin");
  assert.ok(parsed.pathname.startsWith(projectPath), "sitemap URL must stay inside the GitHub Pages project path");
  let relative = parsed.pathname.slice(projectPath.length);
  if (!relative || relative.endsWith("/")) relative += "index.html";
  const target = path.resolve(root, relative);
  assert.ok(target.startsWith(root + path.sep), "local URL must not escape repository root");
  assert.ok(fs.existsSync(target) && fs.statSync(target).isFile(), "sitemap target is missing: " + relative);
  return { parsed, relative, target };
}

for (const url of xmlUrls) {
  const { parsed, relative, target } = existsForUrl(url);
  const html = fs.readFileSync(target, "utf8");
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = html.match(/<meta\s+name=["']description["']\s+content=["'][^"']*["']\s*\/?\s*>/i);
  const canonical = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
  assert.ok(title && title[1].trim(), relative + ": missing title");
  assert.ok(description, relative + ": missing meta description");
  assert.ok(canonical && canonical[1] === url, relative + ": canonical must match sitemap URL");
  for (const marker of ['property="og:title"', 'property="og:description"', 'property="og:url"', 'property="og:image"', 'name="twitter:card"']) {
    assert.ok(html.includes(marker), relative + ": missing " + marker);
  }
  assert.ok(!/name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html), relative + ": noindex page must not be in sitemap");
  const ogImage = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
  assert.ok(ogImage, relative + ": missing Open Graph image URL");
  const ogImageUrl = new URL(ogImage[1], url);
  assert.equal(ogImageUrl.origin, origin, relative + ": OGP image must use the site origin");
  assert.ok(ogImageUrl.pathname.startsWith(projectPath), relative + ": OGP image must be inside the project site");
  const ogImagePath = path.resolve(root, decodeURIComponent(ogImageUrl.pathname.slice(projectPath.length)));
  assert.ok(fs.existsSync(ogImagePath), relative + ": OGP image file is missing");
  assert.ok(!/記事タイトルを入力|記事の概要を入力してください|ここに記事の本文を入力してください/.test(html), relative + ": unfinished article placeholder in sitemap");

  const ids = new Set();
  for (const match of html.matchAll(/\bid=["']([^"']+)["']/gi)) {
    assert.ok(!ids.has(match[1]), relative + ": duplicate id " + match[1]);
    ids.add(match[1]);
  }
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    assert.notEqual(attr(match[0], "alt"), null, relative + ": img missing alt attribute");
  }
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const tag = match[0];
    if ((attr(tag, "target") || "").toLowerCase() === "_blank") {
      const rel = (attr(tag, "rel") || "").toLowerCase().split(/\s+/);
      assert.ok(rel.includes("noopener") || rel.includes("noreferrer"), relative + ": target=_blank missing rel safety attribute");
    }
  }
  for (const match of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
    const ref = match[1].trim();
    if (!ref) continue;
    if (ref.startsWith("#")) { assert.ok(ids.has(decodeURIComponent(ref.slice(1))), relative + ": broken same-page anchor " + ref); continue; }
    if (/^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(ref)) continue;
    const resolved = new URL(ref, url);
    if (resolved.origin !== origin || !resolved.pathname.startsWith(projectPath)) continue;
    let local = resolved.pathname.slice(projectPath.length);
    if (!local || local.endsWith("/")) local += "index.html";
    const localPath = path.resolve(root, decodeURIComponent(local));
    assert.ok(localPath.startsWith(root + path.sep), relative + ": local reference escapes repository");
    assert.ok(fs.existsSync(localPath), relative + ": broken local reference " + ref);
    if (resolved.hash && resolved.pathname === parsed.pathname) {
      const id = decodeURIComponent(resolved.hash.slice(1));
      assert.ok(ids.has(id), relative + ": broken same-page anchor #" + id);
    }
  }

  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1] || "";
    if (/\bsrc\s*=/.test(attrs) || /application\/ld\+json/i.test(attrs)) continue;
    if (!match[2].trim()) continue;
    new vm.Script(match[2], { filename: relative + ":inline-script" });
  }
}

// Parse every repository JavaScript file, including the Worker as an ES-module-shaped source.
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".github") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith(".js")) {
      let source = fs.readFileSync(full, "utf8");
      if (full.endsWith(path.join("admin", "worker.js"))) source = source.replace("export default { fetch: handle };", "const workerModule = { fetch: handle };");
      new vm.Script(source, { filename: path.relative(root, full) });
    }
  }
}
walk(root);
// Admin pages are intentionally excluded from the public sitemap, but their inline scripts
// still need syntax checks because they are deployed with the GitHub Pages site.
const adminDir = path.join(root, "admin");
for (const entry of fs.readdirSync(adminDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
  const relative = path.join("admin", entry.name);
  const html = fs.readFileSync(path.join(adminDir, entry.name), "utf8");
  assert.match(html, /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i, relative + ": admin page must be noindex");
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1] || "";
    if (/\bsrc\s*=/.test(attrs) || /application\/ld\+json/i.test(attrs)) continue;
    if (!match[2].trim()) continue;
    new vm.Script(match[2], { filename: relative + ":inline-script" });
  }
}
console.log("Site quality checks passed: " + xmlUrls.length + " sitemap pages, local references, metadata, IDs, image alts, and JavaScript syntax.");
