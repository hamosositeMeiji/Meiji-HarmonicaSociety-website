function createPartPhotoEditor({container, statusElement, upload, onChange, setBusy}) {
  const parts = [
    ["harmonica", "ハーモニカ"], ["flute", "フルート"], ["clarinet", "クラリネット"],
    ["keyboard", "キーボード"], ["guitar", "ギター"], ["bass", "ベース"],
    ["percussion", "パーカッション"], ["other", "その他の楽器"]
  ];
  let supported = false;
  const editors = new Map();

  for (const [part, name] of parts) {
    const group = document.createElement("details");
    group.className = "part-photo-group";
    const title = document.createElement("summary");
    title.textContent = name;
    const fields = document.createElement("div");
    fields.className = "part-photo-fields";
    const slots = new Map();

    for (const [slot, label] of [["member", "メンバー写真"], ["instrument", "楽器写真"]]) {
      const field = document.createElement("div");
      field.className = "field";
      const input = document.createElement("input");
      input.id = "part-photo-" + part + "-" + slot;
      input.type = "file";
      input.accept = "image/jpeg,image/png,image/webp";
      const heading = document.createElement("label");
      heading.htmlFor = input.id;
      heading.textContent = label;
      const preview = document.createElement("img");
      preview.alt = name + "の" + label;
      preview.loading = "lazy";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn";
      remove.textContent = "登録を外す";
      remove.setAttribute("aria-label", name + "の" + label + "の登録を外す");
      const empty = document.createElement("small");
      empty.textContent = "未登録。公開ページでは既定の画像を表示します。";
      const editor = {
        url: "",
        render(url) {
          this.url = typeof url === "string" && /^https:\/\//i.test(url) ? url : "";
          preview.hidden = !this.url;
          remove.hidden = !this.url;
          empty.hidden = Boolean(this.url);
          if (this.url) preview.src = this.url;
          else preview.removeAttribute("src");
        }
      };
      editor.render("");
      slots.set(slot, editor);

      remove.addEventListener("click", () => {
        editor.render("");
        onChange();
        statusElement.textContent = name + "の" + label + "の登録を外しました。「変更を保存」を押してください。";
      });
      input.addEventListener("change", async () => {
        const file = input.files[0];
        if (!file) return;
        container.disabled = true;
        setBusy(true);
        statusElement.textContent = name + "の" + label + "をアップロード中…";
        try {
          const uploaded = await upload(file);
          editor.render(uploaded.url);
          onChange();
          statusElement.textContent = name + "の" + label + "を選びました。「変更を保存」を押してください。";
        } catch (error) {
          statusElement.textContent = "アップロード失敗：" + error.message;
        } finally {
          input.value = "";
          container.disabled = false;
          setBusy(false);
        }
      });
      field.append(heading, input, preview, remove, empty);
      fields.append(field);
    }
    editors.set(part, slots);
    group.append(title, fields);
    container.append(group);
  }

  return {
    fill(photos, enabled) {
      supported = enabled;
      for (const [part, slots] of editors) {
        for (const [slot, editor] of slots) editor.render(photos?.[part]?.[slot]);
      }
      statusElement.textContent = enabled ? "" : "パート写真を編集するには、Cloudflare Workerの更新が必要です。";
    },
    setLocked(locked) {
      container.disabled = locked || !supported;
    },
    collect() {
      if (!supported) return {};
      const partPhotos = {};
      for (const [part, slots] of editors) {
        const photos = Object.fromEntries([...slots]
          .filter(([, editor]) => editor.url)
          .map(([slot, editor]) => [slot, editor.url]));
        if (Object.keys(photos).length) partPhotos[part] = photos;
      }
      return {partPhotos};
    }
  };
}
