// Shared by index.html and experiment.html

// Address of the backend. "/api" works when this site is opened through the Node server
// (http://localhost:3000). Only change it if the HTML files are served from somewhere else,
// e.g. "http://localhost:3000/api" for VS Code Live Server (and set CORS_ORIGIN in .env).
const API_BASE = "/api";

const EXPERIMENTS_KEY = "dsLabExperiments";
const VIDEO_DB = "dsLabVideos";
const VIDEO_STORE = "videos";

const GITHUB_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function normalizeCodeLanguage(language) {
  const name = language.trim().toLowerCase().split(/\s+/)[0];
  const aliases = {
    "c++": "cpp",
    "c#": "cs",
    csharp: "cs",
    htm: "html",
    js: "javascript",
    node: "javascript",
    py: "python",
    plaintext: "plaintext",
    py3: "python",
    sh: "bash",
    shell: "bash",
    ts: "typescript",
  };
  return aliases[name] || name;
}

function createCodeBlock(source, languageHint = "") {
  const block = el("div", "code-block");
  const header = el("div", "code-header");
  const languageLabel = el("span", "code-language", "CODE");
  const actions = el("div", "code-header__actions");
  const copyStatus = el("span", "code-copy-status");
  copyStatus.setAttribute("role", "status");
  copyStatus.setAttribute("aria-live", "polite");
  const copyButton = el("button", "copy-code-btn", "Copy");
  copyButton.type = "button";
  copyButton.setAttribute("aria-label", "Copy code");
  actions.append(copyStatus, copyButton);
  header.append(languageLabel, actions);

  const content = el("div", "code-content");
  const code = el("code", "");
  code.textContent = source;
  const requestedLanguage = normalizeCodeLanguage(languageHint);
  let detectedLanguage = requestedLanguage;
  if (window.hljs && source.trim()) {
    const supportedLanguage = requestedLanguage && window.hljs.getLanguage(requestedLanguage);
    const highlighted = supportedLanguage
      ? window.hljs.highlight(source, { language: requestedLanguage, ignoreIllegals: true })
      : window.hljs.highlightAuto(source);
    code.innerHTML = highlighted.value;
    code.classList.add("hljs");
    detectedLanguage = highlighted.language || requestedLanguage;
    if (detectedLanguage) code.classList.add(`language-${detectedLanguage}`);
    code.dataset.highlighted = "yes";
  } else if (requestedLanguage) {
    detectedLanguage = requestedLanguage;
    code.classList.add(`language-${requestedLanguage}`);
  }
  if (detectedLanguage) languageLabel.textContent = detectedLanguage.toUpperCase();

  const lineNumbers = el("ol", "line-numbers");
  lineNumbers.setAttribute("aria-hidden", "true");
  const lineCount = source.split("\n").length;
  for (let line = 0; line < lineCount; line += 1) {
    lineNumbers.appendChild(el("li", "", String(line + 1)));
  }

  const pre = el("pre", "code-pre");
  pre.tabIndex = 0;
  pre.appendChild(code);
  content.append(lineNumbers, pre);
  block.append(header, content);
  return block;
}

function isLikelyProgram(source) {
  const lines = source.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return false;
  const codeLine = /[;{}]|=>|:=|\b(?:import|from|def|class|return|print|select|insert|create|function|const|let|var|public|static|void|int|float|if|for|while)\b|\b[\w$.]+\s*\([^)]*\)\s*;?$/i;
  const matchingLines = lines.filter((line) => codeLine.test(line)).length;
  return matchingLines >= Math.max(1, Math.ceil(lines.length * 0.4));
}

function renderFormattedContent(container, text) {
  let code = null;
  let paragraph = [];
  let list = null;
  let section = "";
  let programLines = [];
  const flushParagraph = () => {
    if (paragraph.length) container.appendChild(el("p", "d2-p", paragraph.join("\n")));
    paragraph = [];
  };
  const flushProgram = () => {
    if (!programLines.length) return;
    let start = 0;
    let end = programLines.length;
    while (start < end && !programLines[start].trim()) start += 1;
    while (end > start && !programLines[end - 1].trim()) end -= 1;
    const source = programLines.slice(start, end).join("\n");
    if (source && isLikelyProgram(source)) container.appendChild(createCodeBlock(source));
    else if (source) container.appendChild(el("p", "d2-p", source));
    programLines = [];
  };
  const flushList = () => {
    if (list) container.appendChild(list.element);
    list = null;
  };
  const flushText = () => {
    flushParagraph();
    flushList();
  };

  text.split(/\r?\n/).forEach((line) => {
    if (/^\s*```/.test(line)) {
      if (code) {
        container.appendChild(createCodeBlock(code.lines.join("\n"), code.language));
        code = null;
      } else {
        flushProgram();
        flushText();
        code = { language: line.replace(/^\s*```/, "").trim(), lines: [] };
      }
      return;
    }
    if (code) {
      code.lines.push(line);
      return;
    }

    const heading = line.match(/^\s*(#{1,6})\s*(.+?)\s*#*\s*$/);
    const namedSection = line.match(/^\s*(Aim|Program|Source Code|Code|Output|Result|Description)\s*:?\s*$/i);
    const listItem = line.match(/^\s*(?:([-*+])\s+|(\d+)\.\s+)(.+)$/);
    if (heading || namedSection) {
      flushProgram();
      flushText();
      const title = heading ? heading[2] : namedSection[1];
      const isMain = !heading || heading[1].length < 3;
      container.appendChild(el(isMain ? "h2" : "h3", isMain ? "d2-main" : "d2-sub", title));
      section = /^(program|source code|code)$/i.test(title.trim()) ? "program" : "";
    } else if (section === "program") {
      programLines.push(line);
    } else if (listItem) {
      flushParagraph();
      const isOrdered = Boolean(listItem[2]);
      const type = isOrdered ? "ol" : "ul";
      if (!list || list.type !== type) {
        flushList();
        list = { type, element: el(type, "d2-list") };
      }
      list.element.appendChild(el("li", "", listItem[3]));
    } else if (line.trim() === "") {
      flushText();
    } else {
      flushList();
      paragraph.push(line);
    }
  });
  flushProgram();
  if (code) container.appendChild(createCodeBlock(code.lines.join("\n"), code.language));
  flushText();
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest(".copy-code-btn");
  if (!button) return;

  const block = button.closest(".code-block");
  const code = block && block.querySelector(".code-content code");
  const status = block && block.querySelector(".code-copy-status");
  if (!code || !status) return;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(code.textContent);
    } else {
      const temporaryInput = el("textarea", "");
      temporaryInput.value = code.textContent;
      temporaryInput.setAttribute("readonly", "");
      temporaryInput.style.position = "fixed";
      temporaryInput.style.opacity = "0";
      document.body.appendChild(temporaryInput);
      let copied;
      try {
        temporaryInput.select();
        copied = document.execCommand("copy");
      } finally {
        temporaryInput.remove();
      }
      if (!copied) throw new Error("Clipboard access was denied.");
    }
    status.textContent = "Code copied!";
  } catch (error) {
    status.textContent = "Copy failed";
    console.error("Could not copy code:", error);
  }
});

async function apiRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...(options.body && !(options.body instanceof Blob) ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    throw new Error("Cannot reach the server. Is it running?");
  }
  const contentType = response.headers.get("content-type") || "";
  const result = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    throw new Error(result?.error || `Request failed with status ${response.status}.`);
  }
  return result;
}

// ---------- Stored data (older saves get sensible defaults) ----------
function normalizeSubExperiment(sub, parentNumber) {
  return {
    ...sub,
    id: sub.id || sub._id || `${parentNumber}${sub.letter}`,
    letter: sub.letter || "",
    title: sub.title || "",
    shortDescription: sub.shortDescription ?? sub.description ?? "",
    d2Heading: sub.d2Heading || "",
    d2Content: sub.d2Content || "",
    cover: sub.cover || "",
    video: sub.video || "",
    githubUrl: sub.githubUrl || "",
    completed: sub.completed !== false,
  };
}

function normalizeExperiment(item) {
  const number = String(item.number ?? "");
  return {
    ...item,
    id: String(item.id || item._id || ""),
    number,
    title: item.title || "",
    shortDescription: item.shortDescription ?? item.description ?? "",
    d2Heading: item.d2Heading || "",
    d2Content: item.d2Content ?? item.longDescription ?? item.d2 ?? "",
    cover: item.cover ?? item.coverImage ?? "",
    video: item.video || "",
    githubUrl: item.githubUrl ?? item.githubLink ?? "",
    subExperiments: Array.isArray(item.subExperiments)
      ? item.subExperiments.map((sub) => normalizeSubExperiment(sub, number))
      : [],
  };
}

function readStoredExperiments() {
  try {
    const saved = JSON.parse(localStorage.getItem(EXPERIMENTS_KEY));
    return Array.isArray(saved) ? saved.map(normalizeExperiment) : [];
  } catch (error) {
    return [];
  }
}

function getVideoKeys(experiment) {
  return [experiment.video, ...experiment.subExperiments.map((sub) => sub.video)].filter(Boolean);
}

// IndexedDB remains a fallback for videos saved by older frontend versions.
function openVideoDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VIDEO_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(VIDEO_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function videoRequest(mode, action) {
  const db = await openVideoDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(VIDEO_STORE, mode);
    const request = action(transaction.objectStore(VIDEO_STORE));
    transaction.oncomplete = () => { db.close(); resolve(request.result); };
    transaction.onerror = transaction.onabort = () => { db.close(); reject(transaction.error); };
  });
}

async function saveVideo(file) {
  const result = await apiRequest("/videos", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "X-Video-Type": file.type || "application/octet-stream" },
    body: file,
  });
  return result.id;
}

async function getVideo(key) {
  try {
    const response = await fetch(`${API_BASE}/videos/${encodeURIComponent(key)}`);
    if (response.ok) return await response.blob();
    if (response.status !== 404) throw new Error(`Could not load video (status ${response.status}).`);
  } catch (error) {
    const stored = await videoRequest("readonly", (store) => store.get(key)).catch(() => null);
    if (stored) return stored;
    throw error;
  }
  return videoRequest("readonly", (store) => store.get(key));
}

async function deleteVideo(key) {
  try {
    await apiRequest(`/videos/${encodeURIComponent(key)}`, { method: "DELETE" });
  } catch (error) {
    const stored = await videoRequest("readonly", (store) => store.get(key));
    if (!stored) throw error;
  }
  await videoRequest("readwrite", (store) => store.delete(key));
}