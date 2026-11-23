import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const REPORT_TITLE = "2026年度 定期演奏会を開催しました";
const OLD_TITLE = "演奏会のお知らせ";
const STATIC = [
  { newsTitle: REPORT_TITLE, newsDate: "2026.11.23", staticNews: true },
  { newsTitle: OLD_TITLE, newsDate: "2026.10.14", staticNews: true },
];

function extractLoader(file, name) {
  const html = fs.readFileSync(file, "utf8");
  const start = html.indexOf("(async function " + name + "(){");
  const end = html.indexOf("})();", start);
  assert.ok(start >= 0 && end > start, file + ": announcement loader missing");
  return html.slice(start, end + 5);
}

function node(tag, dataset = {}) {
  return {
    tag,
    dataset,
    children: [],
    style: {},
    attributes: {},
    textContent: "",
    setAttribute(name, value) { this.attributes[name] = value; },
    querySelectorAll(selector) {
      assert.equal(selector, "[data-static-news]");
      return this.children.filter(child => child.dataset.staticNews);
    },
    append(...items) {
      for (const item of items) {
        if (item.tag === "#fragment") this.children.push(...item.children);
        else this.children.push(item);
      }
    },
    replaceChildren(...items) {
      this.children = [];
      this.append(...items);
    },
  };
}

async function render(file, name, items, today = "2026-11-23T12:00:00Z", fail = false) {
  const host = node("section");
  host.children = STATIC.map(data => node("a", { ...data }));
  const document = {
    querySelector() { return host; },
    createElement(tag) { return node(tag); },
    createDocumentFragment() { return node("#fragment"); },
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [today])); }
  }
  const fetch = async () => {
    if (fail) throw new Error("API unavailable");
    return { ok: true, json: async () => ({ items }) };
  };
  const loader = extractLoader(file, name);
  await vm.runInNewContext(loader, { document, fetch, Date: FixedDate });
  return host.children;
}

for (const [file, name] of [
  ["index.html", "loadPublicAnnouncements"],
  ["news/index.html", "loadPublishedAnnouncements"],
]) {
  const empty = await render(file, name, []);
  assert.deepEqual(empty.map(item => item.dataset.newsTitle), [REPORT_TITLE, OLD_TITLE],
    file + ": static report must remain visible when API returns no items");

  const duplicate = await render(file, name, [
    { title: REPORT_TITLE, date: "2026.11.23", category: "活動報告", body: "CMS duplicate" },
  ]);
  assert.deepEqual(duplicate.map(item => item.dataset.newsTitle), [REPORT_TITLE, OLD_TITLE],
    file + ": matching CMS item must not hide or duplicate the static report");

  const newer = await render(file, name, [
    { title: "新しいお知らせ", date: "2026.12.01", category: "お知らせ", body: "本文" },
  ]);
  assert.equal(newer.length, 3, file + ": CMS and static cards should coexist");
  assert.equal(newer[0].tag, file === "index.html" ? "a" : "article",
    file + ": newest CMS item must be first");
  assert.deepEqual(newer.slice(1).map(item => item.dataset.newsTitle), [REPORT_TITLE, OLD_TITLE],
    file + ": static cards must follow in date order");

  const failed = await render(file, name, [], undefined, true);
  assert.deepEqual(failed.map(item => item.dataset.newsTitle), [REPORT_TITLE, OLD_TITLE],
    file + ": static cards must remain when API is unavailable");
}

const future = await render("index.html", "loadPublicAnnouncements", [], "2027-04-02T12:00:00Z");
assert.equal(future.length, 1, "future fiscal year should not show 2026 static cards on successful API load");
assert.match(future[0].textContent, /現在、今年度のお知らせはありません/);
console.log("News integration tests passed: API empty, duplicates, ordering, failure fallback, and fiscal year rollover.");
