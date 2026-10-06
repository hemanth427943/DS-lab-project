const detail = document.getElementById("detail");

function createLink(className, href, text) {
  const link = el("a", className, text);
  link.href = href;
  return link;
}

function createGithubButton(url) {
  const link = el("a", "btn btn--primary btn--gh");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.innerHTML = `${GITHUB_ICON}<span>GitHub</span>`;
  return link;
}

// Only the sub-experiment buttons that exist; the current one is highlighted
function createSubNav(experiment, activeLetter) {
  if (experiment.subExperiments.length === 0) return null;
  const nav = el("div", "detail__section");
  nav.appendChild(el("p", "detail__label", "Sub-experiments"));
  const row = el("div", "detail__actions");
  experiment.subExperiments.forEach((sub) => {
    const href = `experiment.html?id=${encodeURIComponent(experiment.id)}&sub=${encodeURIComponent(sub.letter)}`;
    const active = sub.letter === activeLetter;
    // Visible text is "Exp A"; the internal letter (A, B, C...) is unchanged
    const chip = createLink("sub-btn" + (active ? " sub-btn--active" : ""), href, `Exp ${sub.letter}`);
    chip.title = sub.title;
    if (active) chip.setAttribute("aria-current", "page");
    row.appendChild(chip);
  });
  nav.appendChild(row);
  return nav;
}

// The video section is only added when a saved video can actually be read
async function attachVideo(slot, key) {
  if (!key) return;
  try {
    const blob = await getVideo(key);
    if (!blob) return;
    const video = el("video", "detail__video");
    video.controls = true;
    video.preload = "metadata";
    video.src = URL.createObjectURL(blob);
    const section = el("div", "detail__section");
    section.appendChild(video);
    slot.replaceWith(section);
  } catch (error) {
    console.error("Could not load experiment video:", error);
    slot.textContent = "The saved video could not be loaded.";
  }
}

// Display-only: shows "## Heading" lines as styled headings (without the ## marks)
// and ``` fenced blocks as code blocks. Uses textContent, so nothing is executed.
function formatD2(box, text) {
  let code = null;
  let para = [];
  const flush = () => {
    if (para.length) box.appendChild(el("p", "d2-p", para.join("\n")));
    para = [];
  };
  text.split(/\r?\n/).forEach((line) => {
    if (/^\s*```/.test(line)) {
      if (code) { box.appendChild(code.pre); code = null; }
      else { flush(); code = { pre: el("pre", "d2-code"), lines: [] }; code.pre.appendChild(el("code", "")); }
      return;
    }
    if (code) {
      code.lines.push(line);
      code.pre.firstChild.textContent = code.lines.join("\n");
      return;
    }
    const m = line.match(/^\s*(#{1,6})\s*(.+?)\s*#*\s*$/);
    if (m) {
      flush();
      box.appendChild(el(m[1].length >= 3 ? "h3" : "h2", m[1].length >= 3 ? "d2-sub" : "d2-main", m[2]));
    } else if (line.trim() === "") {
      flush();
    } else {
      para.push(line);
    }
  });
  if (code) box.appendChild(code.pre);
  flush();
}

// One layout for both main experiments and sub-experiments
function renderPage({ label, title, video, githubUrl, d2Heading, d2Content, nav }) {
  const sidebar = el("aside", "detail__left");
  const header = el("div", "detail__head");
  header.append(el("p", "detail__label", label), el("h1", "", title));
  sidebar.appendChild(header);

  const videoSlot = el("div"); // replaced by the player, or removed, once the video loads
  sidebar.appendChild(videoSlot);
  if (nav) sidebar.appendChild(nav);
  if (githubUrl) {
    const section = el("div", "detail__section");
    section.appendChild(createGithubButton(githubUrl));
    sidebar.appendChild(section);
  }

  const panel = el("section", "detail__panel");
  panel.appendChild(el("h2", "detail__d2-heading", d2Heading || "Long Description"));
  const d2Box = el("div", d2Content ? "detail__d2" : "detail__d2 detail__d2--empty",
    d2Content ? "" : "No detailed description has been added yet.");
  if (d2Content) formatD2(d2Box, d2Content); // display only: the saved text is never changed
  panel.appendChild(d2Box);

  const layout = el("div", "detail__layout");
  layout.append(sidebar, panel);
  detail.innerHTML = "";
  detail.appendChild(layout);
  document.title = `${title} – DS Lab`;
  if (video) attachVideo(videoSlot, video);
  else videoSlot.remove();
}

async function showDetails() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (!id) {
    showNotFound();
    return;
  }

  let experiment;
  try {
    if (/^[a-f\d]{24}$/i.test(id)) {
      experiment = normalizeExperiment(await apiRequest(`/experiments/${encodeURIComponent(id)}`));
    } else {
      const experiments = (await apiRequest("/experiments")).map(normalizeExperiment);
      experiment = experiments.find((item) => item.id === id || item.number === id);
    }
  } catch (error) {
    if (error.message === "Experiment not found") {
      showNotFound();
      return;
    }
    detail.innerHTML = "";
    detail.append(el("h1", "", "Could not load experiment"),
      el("p", "detail__empty-note", error.message));
    return;
  }

  if (!experiment) {
    showNotFound();
    return;
  }
  const subParam = params.get("sub");
  const sub = subParam && experiment.subExperiments.find((item) => item.letter === subParam || item.id === subParam);
  const source = sub || experiment;
  renderPage({
    label: sub ? `Experiment ${sub.id}` : `Experiment ${experiment.number}`,
    title: source.title,
    video: source.video,
    githubUrl: source.githubUrl,
    d2Heading: source.d2Heading,
    d2Content: source.d2Content,
    nav: createSubNav(experiment, sub ? sub.letter : null),
  });
}

function showNotFound() {
  detail.innerHTML = "";
  detail.append(el("h1", "", "Experiment not found"),
    el("p", "detail__empty-note", "It may have been deleted, or it was saved in a different browser."));
}

showDetails();