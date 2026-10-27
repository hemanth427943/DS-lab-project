const detail = document.getElementById("detail");
const sectionNames = {
  aim: "Aim",
  theory: "Theory",
  syntax: "Syntax",
  procedure: "Procedure",
  output: "Output",
  result: "Result",
};
let experimentEditor;
let originalExperimentCode = "";
let experimentRunning = false;

function createLink(className, href, text) {
  const link = el("a", className, text);
  link.href = href;
  return link;
}

function createGithubButton(url) {
  const link = el("a", "btn btn--ghost detail-github");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.innerHTML = `${GITHUB_ICON}<span>GitHub</span>`;
  return link;
}

function createBreadcrumbs(experiment, sub) {
  const nav = el("nav", "experiment-breadcrumbs");
  nav.setAttribute("aria-label", "Breadcrumb");
  const parentUrl = `experiment.html?id=${encodeURIComponent(experiment.id)}`;
  const crumbs = [
    { label: "Home", href: "index.html" },
    { label: "Experiments", href: "experiments.html" },
  ];
  if (sub) crumbs.push({ label: experiment.title, href: parentUrl });
  crumbs.push({ label: sub ? sub.title : experiment.title, current: true });

  crumbs.forEach((crumb, index) => {
    if (index) nav.appendChild(el("span", "experiment-breadcrumbs__separator", "/"));
    if (crumb.current) {
      const current = el("span", "experiment-breadcrumbs__current", crumb.label);
      current.setAttribute("aria-current", "page");
      nav.appendChild(current);
    } else {
      nav.appendChild(createLink("", crumb.href, crumb.label));
    }
  });
  return nav;
}

function parseExperimentContent(content) {
  const sections = {};
  const notes = [];
  let currentSection = "";
  let inFence = false;
  let fenceLanguage = "";
  let fenceLines = [];
  let code = "";
  let language = "";
  const heading = /^\s*(?:#{1,3}\s*)?(Aim|Theory|Syntax|Procedure|Program|Source Code|Code Sample|Code|Output|Result)\s*:?\s*(.*?)\s*$/i;

  content.split(/\r?\n/).forEach((line) => {
    const fence = line.match(/^\s*```([^\s`]*)\s*$/);
    if (inFence) {
      if (fence) {
        const fencedCode = fenceLines.join("\n").trim();
        if (fencedCode && (!code || currentSection === "program")) {
          code = fencedCode;
          language = fenceLanguage;
        }
        inFence = false;
        fenceLines = [];
      } else {
        fenceLines.push(line);
      }
      return;
    }
    if (fence) {
      inFence = true;
      fenceLanguage = fence[1].toLowerCase();
      fenceLines = [];
      return;
    }

    const match = line.match(heading);
    if (match) {
      const label = match[1].toLowerCase().replace(/\s+/g, " ");
      currentSection = ["program", "source code", "code sample", "code"].includes(label)
        ? "program"
        : label;
      if (!sections[currentSection]) sections[currentSection] = [];
      if (match[2]) sections[currentSection].push(match[2]);
      return;
    }
    if (currentSection) {
      sections[currentSection].push(line);
    } else if (line.trim()) {
      notes.push(line);
    }
  });

  if (inFence && fenceLines.length) {
    code = fenceLines.join("\n").trim();
    language = fenceLanguage;
  }
  if (!code && sections.program) {
    code = sections.program.join("\n").trim();
  }

  return { sections, notes: notes.join("\n").trim(), code, language };
}

function inferLanguage(language, code) {
  const explicit = language.replace(/[^a-z]/g, "");
  if (explicit === "java") return "java";
  if (explicit === "c" || explicit === "h") return "c";
  if (explicit === "python" || explicit === "py") return "python";
  if (/\bpublic\s+class\b|\bstatic\s+void\s+main\b/.test(code)) return "java";
  if (/#include\s*<stdio\.h>|\bint\s+main\s*\(/.test(code)) return "c";
  return "python";
}

function createSubNav(experiment, activeLetter) {
  if (experiment.subExperiments.length === 0) return null;
  const section = el("section", "detail-info-card detail-subexperiments");
  section.appendChild(el("h2", "", "Sub-experiments"));
  const row = el("div", "detail__actions");
  experiment.subExperiments.forEach((sub) => {
    const href = `experiment.html?id=${encodeURIComponent(experiment.id)}&sub=${encodeURIComponent(sub.letter)}`;
    const active = sub.letter === activeLetter;
    const link = createLink(`sub-btn${active ? " sub-btn--active" : ""}`, href, `Exp ${sub.letter}`);
    link.title = sub.title;
    if (active) link.setAttribute("aria-current", "page");
    row.appendChild(link);
  });
  section.appendChild(row);
  return section;
}

async function attachVideo(container, key) {
  if (!key) return;
  try {
    const blob = await getVideo(key);
    if (!blob) return;
    const card = el("section", "detail-info-card");
    card.appendChild(el("h2", "", "Experiment video"));
    const video = el("video", "detail__video");
    video.controls = true;
    video.preload = "metadata";
    video.src = URL.createObjectURL(blob);
    card.appendChild(video);
    container.appendChild(card);
  } catch (error) {
    console.error("Could not load experiment video:", error);
    const errorCard = el("p", "detail__empty-note", "The saved video could not be loaded.");
    container.appendChild(errorCard);
  }
}

function appendContentCard(container, title, content) {
  if (!content || !content.trim()) return;
  const card = el("section", "detail-info-card");
  card.appendChild(el("h2", "", title));
  const body = el("div", "detail__d2", "");
  renderFormattedContent(body, content.trim());
  card.appendChild(body);
  container.appendChild(card);
}

function updateExperimentRunButton() {
  const button = document.getElementById("experimentRunButton");
  if (!button) return;
  button.disabled = experimentRunning || !experimentEditor || !experimentEditor.getValue().trim();
}

function setExperimentStatus(message, state = "") {
  const status = document.getElementById("experimentRunStatus");
  status.className = `run-status${state ? ` is-${state}` : ""}`;
  document.getElementById("experimentRunStatusText").textContent = message;
}

function initializeExperimentEditor(initialCode, initialLanguage) {
  const textarea = document.getElementById("experimentCodeEditor");
  if (!window.CodeMirror) {
    textarea.value = initialCode;
    textarea.addEventListener("input", updateExperimentRunButton);
    experimentEditor = {
      getValue: () => textarea.value,
      setValue: (value) => { textarea.value = value; updateExperimentRunButton(); },
      setOption: () => {},
      refresh: () => {},
    };
  } else {
    experimentEditor = window.CodeMirror.fromTextArea(textarea, {
      lineNumbers: true,
      mode: initialLanguage === "java" ? "text/x-java" : initialLanguage === "c" ? "text/x-csrc" : "python",
      theme: "material-darker",
      indentUnit: 4,
      tabSize: 4,
      lineWrapping: false,
      autofocus: false,
    });
    experimentEditor.on("change", updateExperimentRunButton);
  }
  updateExperimentRunButton();
}

function updateExperimentLanguage() {
  const language = document.getElementById("experimentLanguage").value;
  const mode = language === "java" ? "text/x-java" : language === "c" ? "text/x-csrc" : "python";
  if (experimentEditor) experimentEditor.setOption("mode", mode);
  const filename = language === "java" ? "Main.java" : language === "c" ? "main.c" : "main.py";
  document.getElementById("experimentEditorFilename").textContent = filename;
}

function formatExecutionResult(result) {
  const sections = [];
  if (result.compileOutput) sections.push(`Compiler output:\n${result.compileOutput.trimEnd()}`);
  if (result.compileError) sections.push(`Compilation error:\n${result.compileError.trimEnd()}`);
  if (result.stdout) sections.push(`Output:\n${result.stdout.trimEnd()}`);
  if (result.stderr) sections.push(`Runtime error:\n${result.stderr.trimEnd()}`);
  return sections.join("\n\n")
    || (result.ok ? "Program completed with no output." : "Execution failed without diagnostic output.");
}

function renderExecutionPlots(container, plots) {
  container.replaceChildren();
  (Array.isArray(plots) ? plots : []).forEach((plot, index) => {
    if (typeof plot !== "string") return;
    const image = el("img", "execution-plot");
    image.src = `data:image/png;base64,${plot}`;
    image.alt = `Generated plot ${index + 1}`;
    container.appendChild(image);
  });
  container.hidden = container.childElementCount === 0;
}

async function runExperimentCode() {
  if (experimentRunning || !experimentEditor || !experimentEditor.getValue().trim()) return;
  const output = document.getElementById("experimentOutput");
  const plots = document.getElementById("experimentPlots");
  const language = document.getElementById("experimentLanguage").value;
  const input = document.getElementById("experimentProgramInput").value;
  experimentRunning = true;
  updateExperimentRunButton();
  document.getElementById("experimentResetButton").disabled = true;
  document.getElementById("experimentClearOutput").disabled = true;
  document.getElementById("experimentLanguage").disabled = true;
  output.textContent = "Running code in the isolated sandbox…";
  output.classList.remove("is-error");
  renderExecutionPlots(plots, []);
  document.getElementById("experimentEditorWorkspace").setAttribute("aria-busy", "true");
  setExperimentStatus("Running…", "running");

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 28000);
  try {
    const response = await fetch("/api/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, code: experimentEditor.getValue(), stdin: input }),
      signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Compiler request failed (${response.status}).`);
    output.textContent = formatExecutionResult(result);
    renderExecutionPlots(plots, result.plots);
    output.classList.toggle("is-error", !result.ok);
    if (result.ok) setExperimentStatus("Execution completed successfully", "success");
    else if (result.status === "compile-error") setExperimentStatus("Compilation failed", "error");
    else setExperimentStatus(result.detail || "Execution failed", "error");
  } catch (error) {
    const message = error.name === "AbortError"
      ? "Execution timed out. Please try a smaller program."
      : error.message || "The compiler request failed. Please try again.";
    output.textContent = message;
    output.classList.add("is-error");
    setExperimentStatus("Unable to run code", "error");
  } finally {
    window.clearTimeout(timeout);
    experimentRunning = false;
    document.getElementById("experimentResetButton").disabled = false;
    document.getElementById("experimentClearOutput").disabled = false;
    document.getElementById("experimentLanguage").disabled = false;
    document.getElementById("experimentEditorWorkspace").removeAttribute("aria-busy");
    updateExperimentRunButton();
  }
}

function createEditorPanel(code, language) {
  originalExperimentCode = code;
  const panel = el("section", "experiment-editor-panel");
  panel.setAttribute("aria-labelledby", "experimentEditorTitle");
  const heading = el("div", "experiment-editor-heading");
  const headingText = el("div", "");
  headingText.append(el("p", "experiment-editor-eyebrow", "Interactive code sample"),
    el("h2", "", "Code Editor"));
  headingText.lastElementChild.id = "experimentEditorTitle";
  const languageSelect = el("select", "experiment-language");
  languageSelect.id = "experimentLanguage";
  languageSelect.setAttribute("aria-label", "Programming language");
  [["python", "Python"], ["java", "Java"], ["c", "C"]].forEach(([value, label]) => {
    const option = el("option", "", label);
    option.value = value;
    languageSelect.appendChild(option);
  });
  languageSelect.value = language;
  heading.append(headingText, languageSelect);

  const workspace = el("div", "experiment-editor-workspace");
  workspace.id = "experimentEditorWorkspace";
  const editorHeading = el("div", "panel-heading");
  editorHeading.append(
    el("span", "", "Program source"),
    el("span", "editor-filename", "main.py"),
  );
  editorHeading.lastElementChild.id = "experimentEditorFilename";
  const textarea = el("textarea", "");
  textarea.id = "experimentCodeEditor";
  textarea.setAttribute("aria-label", "Editable experiment program");
  textarea.spellcheck = false;
  textarea.value = code;
  if (!code) textarea.placeholder = "No program is saved for this experiment.";
  const actions = el("div", "experiment-editor-actions");
  const run = el("button", "compiler-button compiler-button--primary", "▶ Run Code");
  run.type = "button";
  run.id = "experimentRunButton";
  run.setAttribute("aria-label", "Run edited experiment code");
  const reset = el("button", "compiler-button compiler-button--secondary", "Reset");
  reset.type = "button";
  reset.id = "experimentResetButton";
  actions.append(run, reset);

  const inputLabel = el("label", "stdin-field");
  inputLabel.htmlFor = "experimentProgramInput";
  inputLabel.appendChild(el("span", "", "Program input (optional)"));
  const input = el("textarea", "");
  input.id = "experimentProgramInput";
  input.rows = 3;
  input.maxLength = 8192;
  input.placeholder = "Input passed to stdin";
  inputLabel.appendChild(input);
  workspace.append(editorHeading, textarea, inputLabel, actions);

  const outputPanel = el("section", "experiment-output-panel");
  outputPanel.setAttribute("aria-labelledby", "experimentOutputTitle");
  const outputHeading = el("div", "panel-heading");
  outputHeading.append(el("span", "", "Output"), el("button", "clear-output", "Clear Output"));
  outputHeading.firstElementChild.id = "experimentOutputTitle";
  outputHeading.lastElementChild.type = "button";
  outputHeading.lastElementChild.id = "experimentClearOutput";
  const status = el("div", "run-status");
  status.id = "experimentRunStatus";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.append(el("span", "run-status__indicator", ""), el("span", "", code ? "Ready to run the saved program" : "No saved program"));
  status.lastElementChild.id = "experimentRunStatusText";
  const output = el("pre", "console-output", code ? "Run the program to see output here." : "This experiment has no saved program.");
  output.id = "experimentOutput";
  output.setAttribute("aria-live", "polite");
  const plots = el("div", "execution-plots");
  plots.id = "experimentPlots";
  plots.hidden = true;
  outputPanel.append(outputHeading, status, output, plots);
  panel.append(heading, workspace, outputPanel);

  languageSelect.addEventListener("change", updateExperimentLanguage);
  run.addEventListener("click", runExperimentCode);
  reset.addEventListener("click", () => {
    experimentEditor.setValue(originalExperimentCode);
    document.getElementById("experimentOutput").textContent = originalExperimentCode
      ? "Run the program to see output here."
      : "This experiment has no saved program.";
    document.getElementById("experimentOutput").classList.remove("is-error");
    renderExecutionPlots(document.getElementById("experimentPlots"), []);
    setExperimentStatus(originalExperimentCode ? "Program reset to saved content" : "No saved program");
  });
  outputHeading.lastElementChild.addEventListener("click", () => {
    output.textContent = "";
    output.classList.remove("is-error");
    renderExecutionPlots(document.getElementById("experimentPlots"), []);
    setExperimentStatus("Output cleared");
  });
  return panel;
}

function renderPage({ experiment, sub, source }) {
  const isSub = Boolean(sub);
  const codeData = parseExperimentContent(source.d2Content || "");
  const language = inferLanguage(codeData.language, codeData.code);
  const wrapper = el("section", "experiment-detail");
  wrapper.appendChild(createBreadcrumbs(experiment, sub));

  const header = el("header", "experiment-detail__header");
  const headingContent = el("div", "");
  headingContent.append(
    el("p", "info-card__eyebrow", `Experiment ${experiment.number}${isSub ? sub.letter : ""}`),
    el("h1", "", source.title),
  );
  const headingActions = el("div", "experiment-detail__actions");
  headingActions.appendChild(createLink("btn btn--ghost", isSub
    ? `experiment.html?id=${encodeURIComponent(experiment.id)}`
    : "experiments.html", isSub ? "← Back to Experiment" : "← Back to Experiments"));
  if (source.githubUrl) headingActions.appendChild(createGithubButton(source.githubUrl));
  header.append(headingContent, headingActions);
  wrapper.appendChild(header);

  const layout = el("div", "experiment-workspace");
  const information = el("div", "experiment-information");
  information.setAttribute("aria-label", "Experiment information");
  appendContentCard(information, "Overview", source.shortDescription || "");

  const contentOrder = ["aim", "theory", "syntax", "procedure", "output", "result"];
  let hasStructuredContent = false;
  contentOrder.forEach((key) => {
    const sectionText = (codeData.sections[key] || []).join("\n").trim();
    if (sectionText) {
      appendContentCard(information, sectionNames[key], sectionText);
      hasStructuredContent = true;
    }
  });
  if (codeData.notes) {
    appendContentCard(information, "Experiment Notes", codeData.notes);
    hasStructuredContent = true;
  }
  if (!hasStructuredContent && source.d2Content) {
    appendContentCard(information, source.d2Heading || "Experiment Details", source.d2Content);
  }
  const subNav = createSubNav(experiment, sub ? sub.letter : null);
  if (subNav) information.appendChild(subNav);
  layout.append(information, createEditorPanel(codeData.code, language));
  wrapper.appendChild(layout);
  detail.replaceChildren(wrapper);
  initializeExperimentEditor(codeData.code, language);
  updateExperimentLanguage();
  document.title = `${source.title} – DS Lab`;
  if (source.video) attachVideo(information, source.video);
}

async function showDetails() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (!id) {
    showNotFound();
    return;
  }

  try {
    let experiment;
    if (/^[a-f\d]{24}$/i.test(id)) {
      experiment = normalizeExperiment(await apiRequest(`/experiments/${encodeURIComponent(id)}`));
    } else {
      const experiments = (await apiRequest("/experiments")).map(normalizeExperiment);
      experiment = experiments.find((item) => item.id === id || item.number === id);
    }
    if (!experiment) {
      showNotFound();
      return;
    }

    const subParam = params.get("sub");
    const sub = subParam && experiment.subExperiments.find((item) =>
      item.letter === subParam || item.id === subParam);
    if (subParam && !sub) {
      showNotFound();
      return;
    }
    renderPage({ experiment, sub, source: sub || experiment });
  } catch (error) {
    if (error.message === "Experiment not found") {
      showNotFound();
      return;
    }
    detail.replaceChildren(el("h1", "", "Could not load experiment"),
      el("p", "detail__empty-note", error.message));
  }
}

function showNotFound() {
  detail.replaceChildren(
    createLink("btn btn--ghost", "experiments.html", "← Back to Experiments"),
    el("h1", "", "Experiment not found"),
    el("p", "detail__empty-note", "It may have been deleted, or it was saved in a different browser."),
  );
}

showDetails();
