const root = document.querySelector("[data-architecture-explorer]");
if (root) {
  const layers = [...root.querySelectorAll("[data-layer]")];
  const personas = [...document.querySelectorAll("[data-persona]")];
  const detail = document.querySelector("[data-layer-detail]");
  function chooseLayer(id, push = true) {
    const selected = layers.find((layer) => layer.dataset.layer === id) || layers[0];
    layers.forEach((layer) => { const active = layer === selected; layer.classList.toggle("is-active", active); layer.querySelector(".layer-heading").setAttribute("aria-pressed", String(active)); layer.querySelector(".layer-systems").hidden = !active; layer.querySelector(".layer-heading b").textContent = active ? "−" : "+"; });
    detail.textContent = `${selected.dataset.name}: ${selected.dataset.description}`;
    document.querySelector("[data-current-layer]").textContent = `${selected.dataset.number} / 06`;
    if (push) history.replaceState(null, "", `#${selected.dataset.layer}`);
  }
  function choosePersona(persona) {
    personas.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.persona === persona)));
    document.querySelectorAll("[data-system-personas]").forEach((system) => { system.hidden = persona !== "all" && !system.dataset.systemPersonas.split(" ").includes(persona); });
    layers.forEach((layer) => layer.classList.toggle("is-muted", ![...layer.querySelectorAll("[data-system-personas]")].some((system) => !system.hidden)));
  }
  layers.forEach((layer) => layer.querySelector(".layer-heading").addEventListener("click", () => chooseLayer(layer.dataset.layer)));
  personas.forEach((button) => button.addEventListener("click", () => choosePersona(button.dataset.persona)));
  chooseLayer(location.hash.slice(1), false); choosePersona("all");
}
