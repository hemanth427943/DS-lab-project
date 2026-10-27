const homeCollections = [
  { key: "modules", path: "/modules" },
  { key: "experiments", path: "/experiments" },
  { key: "tools", path: "/tools" },
  { key: "resources", path: "/resources" },
];

function setHomeCount(key, value) {
  document.querySelectorAll(`[data-home-count="${key}"]`).forEach((node) => {
    node.textContent = node.classList.contains("home-link-card__count")
      ? `${value} available`
      : String(value);
  });
}

function showHomeLoadError(key, message) {
  document.querySelectorAll(`[data-home-count="${key}"]`).forEach((node) => {
    node.textContent = node.classList.contains("home-link-card__count") ? "Count unavailable" : "—";
  });
  console.error(`Could not load ${key} for the home page:`, message);
}

function renderRecentCards(container, items, type) {
  if (!items.length) {
    container.replaceChildren(el("p", "home-recent__status", `No ${type} are available yet.`));
    return;
  }

  const recent = items.slice().sort((a, b) => {
    const aDate = Date.parse(a.createdAt || a.updatedAt || "");
    const bDate = Date.parse(b.createdAt || b.updatedAt || "");
    return Number.isNaN(aDate) || Number.isNaN(bDate) ? 0 : bDate - aDate;
  }).slice(0, 3);

  container.replaceChildren(...recent.map((item) => {
    const card = el("article", "content-card home-recent-card");
    card.append(el("p", "home-recent-card__eyebrow", type === "experiment"
      ? `Experiment ${item.number}`
      : "Data science tool"));
    const title = el("h3", "", item.title);
    const description = el("p", "home-recent-card__description",
      type === "experiment" ? item.shortDescription : item.description);
    const link = el("a", "home-recent-card__link", type === "experiment" ? "Read experiment →" : "Explore tool →");
    link.href = type === "experiment"
      ? `experiment.html?id=${encodeURIComponent(item.id || item._id)}`
      : "tools.html";
    card.append(title, description, link);
    return card;
  }));
}

async function loadHomeCollections() {
  const results = await Promise.allSettled(homeCollections.map(async ({ key, path }) => {
    const items = await apiRequest(path);
    if (!Array.isArray(items)) throw new Error(`The ${key} response was not a list.`);
    return { key, items };
  }));
  const collections = new Map();
  results.forEach((result, index) => {
    const key = homeCollections[index].key;
    if (result.status === "rejected") {
      showHomeLoadError(key, result.reason);
      return;
    }
    setHomeCount(key, result.value.items.length);
    collections.set(key, result.value.items);
  });

  const experiments = document.getElementById("recentExperiments");
  if (collections.has("experiments") && collections.get("experiments").length) {
    renderRecentCards(experiments, collections.get("experiments"), "experiment");
  }
  const tools = document.getElementById("recentTools");
  if (collections.has("tools") && collections.get("tools").length) {
    renderRecentCards(tools, collections.get("tools"), "tool");
  }
}

loadHomeCollections();
