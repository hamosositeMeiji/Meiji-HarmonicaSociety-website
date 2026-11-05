/* Shared accessibility controls: text size and high-contrast mode. */
(function () {
  const root = document.documentElement;
  const body = document.body;
  const bar = document.getElementById("hamoso-accessibility");
  const contrast = document.getElementById("hm-contrast");
  const toggle = document.getElementById("hm-settings-toggle");

  if (!bar || !body) return;

  if (toggle) {
    toggle.addEventListener("click", () => {
      const opening = bar.hidden;
      bar.hidden = !opening;
      toggle.setAttribute("aria-expanded", String(opening));
      toggle.setAttribute("aria-label", opening ? "表示設定を閉じる" : "表示設定を開く");
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !bar.hidden) {
        bar.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "表示設定を開く");
        toggle.focus();
      }
    });
  }

  let size = "normal";
  let high = false;
  let motion = "";
  try {
    const savedSize = localStorage.getItem("hm-text-size");
    size = ["small", "normal", "large"].includes(savedSize) ? savedSize : "normal";
    high = localStorage.getItem("hm-high-contrast") === "true";
    const savedMotion = localStorage.getItem("hm-motion-mode");
    motion = ["standard", "reduced", "light"].includes(savedMotion) ? savedMotion : "";
  } catch (error) {}
  if (!motion) {
    motion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "reduced"
      : "standard";
  }

  const scales = { small: 0.85, normal: 1, large: 1.3 };
  const selector = "h1,h2,h3,h4,h5,h6,p,li,dt,dd,th,td,label,legend,figcaption,blockquote,summary,a,button,input,select,textarea,small,strong,em,b,i,span,div";
  const detailedTextElements = "h1,h2,h3,h4,h5,h6,p,li,dt,dd,th,td,label,legend,figcaption,blockquote,summary,a,button,input,select,textarea,small";
  const targets = Array.from(body.querySelectorAll(selector)).filter((element) =>
    !bar.contains(element) &&
    (element.children.length === 0 || element.matches(detailedTextElements))
  );

  const baseSizes = new WeakMap();
  targets.forEach((element) => {
    const value = parseFloat(getComputedStyle(element).fontSize);
    if (Number.isFinite(value)) baseSizes.set(element, value);
  });

  function applySettings() {
    const factor = scales[size] || 1;
    root.style.setProperty("--hm-font-scale", factor === 1 ? "100%" : (factor * 100) + "%");
    root.style.setProperty("--hm-font-scale-factor", String(factor));

    targets.forEach((element) => {
      const value = baseSizes.get(element);
      if (value) element.style.setProperty("font-size", (value * factor) + "px", "important");
    });

    body.classList.toggle("hamoso-high-contrast", high);
    bar.querySelectorAll("[data-hm-size]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.hmSize === size));
    });
    if (contrast) contrast.setAttribute("aria-pressed", String(high));

    body.classList.toggle("hm-motion-standard", motion === "standard");
    body.classList.toggle("hm-motion-reduced", motion === "reduced");
    body.classList.toggle("hm-lightweight", motion === "light");
    bar.querySelectorAll("[data-hm-motion]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.hmMotion === motion));
    });
  }

  bar.querySelectorAll("[data-hm-size]").forEach((button) => {
    button.addEventListener("click", () => {
      size = button.dataset.hmSize;
      try { localStorage.setItem("hm-text-size", size); } catch (error) {}
      applySettings();
    });
  });

  if (contrast) {
    contrast.addEventListener("click", () => {
      high = !high;
      try { localStorage.setItem("hm-high-contrast", String(high)); } catch (error) {}
      applySettings();
    });
  }

  bar.querySelectorAll("[data-hm-motion]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextMotion = button.dataset.hmMotion;
      if (!["standard", "reduced", "light"].includes(nextMotion)) return;
      motion = nextMotion;
      try { localStorage.setItem("hm-motion-mode", motion); } catch (error) {}
      applySettings();
    });
  });

  applySettings();
})();
