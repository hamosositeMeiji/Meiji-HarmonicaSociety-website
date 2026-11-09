/* Persistent motion preferences for secondary pages. */
(function () {
  const bar = document.getElementById("hamoso-accessibility");
  const body = document.body;
  if (!bar || !body) return;

  const buttons = Array.from(bar.querySelectorAll("[data-hm-motion]"));
  if (!buttons.length) return;

  const valid = ["standard", "reduced", "light"];
  let mode = "";
  try {
    const saved = localStorage.getItem("hm-motion-mode");
    if (valid.includes(saved)) mode = saved;
  } catch (error) {}

  if (!mode) {
    mode = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "reduced"
      : "standard";
  }

  function apply() {
    body.classList.toggle("hm-motion-standard", mode === "standard");
    body.classList.toggle("hm-motion-reduced", mode === "reduced");
    body.classList.toggle("hm-lightweight", mode === "light");
    buttons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.hmMotion === mode));
    });
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.hmMotion;
      if (!valid.includes(next)) return;
      mode = next;
      try { localStorage.setItem("hm-motion-mode", mode); } catch (error) {}
      apply();
    });
  });

  apply();
})();
