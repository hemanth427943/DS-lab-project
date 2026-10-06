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