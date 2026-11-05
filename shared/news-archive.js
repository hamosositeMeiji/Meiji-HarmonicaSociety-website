/* Shared year-archive renderer. The archive year is set on <body data-archive-year="YYYY">. */
(async function () {
  const host = document.getElementById("news-list");
  if (!host || !document.body) return;

  const targetYear = Number(document.body.dataset.archiveYear);

  function fiscalYear(date) {
    const match = String(date || "").match(/^(\d{4})[.\/-年](\d{1,2})/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    return month >= 4 ? year : year - 1;
  }

  // Admin dates are free text, so compare numeric date parts rather than strings.
  // This keeps dates such as 2026.9.1 in the correct position relative to 2026.11.21.
  function dateSortValue(date) {
    const match = String(date || "").trim().match(/^(\d{4})\s*[.\/-年]\s*(\d{1,2})(?:\s*[.\/-月]\s*(\d{1,2})\s*日?)?/);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = match[3] ? Number(match[3]) : 0;

    if (month < 1 || month > 12 || (day !== 0 && (day < 1 || day > 31))) {
      return null;
    }

    return year * 10000 + month * 100 + day;
  }

  if (!Number.isInteger(targetYear)) return;

  try {
    const response = await fetch("https://hamoso-admin-auth.hamososaitoguanli.workers.dev/api/public/announcements");
    if (!response.ok) throw new Error("API response not OK");

    const data = await response.json();
    const items = (Array.isArray(data.items) ? data.items : [])
      .filter((item) => fiscalYear(item.date) === targetYear)
      .sort((a, b) => {
        const dateA = dateSortValue(a.date);
        const dateB = dateSortValue(b.date);

        if (dateA === null && dateB === null) {
          return String(b.date || "").localeCompare(String(a.date || ""));
        }
        if (dateA === null) return 1;
        if (dateB === null) return -1;
        return dateB - dateA;
      });

    host.replaceChildren();

    if (!items.length) {
      const note = document.createElement("p");
      note.className = "empty-note";
      note.textContent = "この年度に公開中のお知らせはありません。";
      host.appendChild(note);
      return;
    }

    items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "news-card";

      const meta = document.createElement("div");
      meta.className = "meta";

      const date = document.createElement("span");
      date.textContent = item.date || "日付未設定";

      const category = document.createElement("span");
      category.className = "category";
      category.textContent = item.category || "お知らせ";

      meta.append(date, category);

      const title = document.createElement("h3");
      title.textContent = item.title || "タイトル未設定";

      const body = document.createElement("p");
      body.textContent = item.body || "";

      card.append(meta, title, body);
      host.appendChild(card);
    });
  } catch (error) {
    host.replaceChildren();
    const note = document.createElement("p");
    note.className = "empty-note";
    note.textContent = "お知らせを取得できませんでした。時間をおいて再度ご確認ください。";
    host.appendChild(note);
  }
})();
