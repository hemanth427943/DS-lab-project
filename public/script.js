const PROFILE_KEY = "dsLabProfile";
const MAX_IMAGE_WIDTH = 800;
const MAX_PHOTO_WIDTH = 300;
const FORM_ERROR_FIELDS = ["number", "name", "description", "cover", "github", "subs"];

let experiments = [];
let editingId = null;                    // id of the experiment being edited, or null when adding
let deletingId = null;                   // id of the experiment waiting for delete confirmation
let mainCover = "";                      // main cover currently chosen in the form
const mainVideo = { file: null, key: "" }; // newly chosen file, or key of the saved video
let refreshMainVideo = () => {};

// ---------- DOM references ----------
const list = document.getElementById("experimentList");
const emptyState = document.getElementById("emptyState");
const progressValue = document.getElementById("progressValue");
const searchInput = document.getElementById("searchInput");
const experimentModal = document.getElementById("experimentModal");
const form = document.getElementById("experimentForm");
const modalTitle = document.getElementById("modalTitle");
const submitBtn = document.getElementById("submitBtn");
const numberInput = document.getElementById("numberInput");
const nameInput = document.getElementById("nameInput");
const shortInput = document.getElementById("shortInput");
const d2HeadingInput = document.getElementById("d2HeadingInput");
const d2ContentInput = document.getElementById("d2ContentInput");
const githubInput = document.getElementById("githubInput");
const coverInput = document.getElementById("coverInput");
const coverPreview = document.getElementById("coverPreview");
const uploadHint = document.getElementById("uploadHint");
const subList = document.getElementById("subList");
const previewModal = document.getElementById("previewModal");
const toast = document.getElementById("toast");

// ---------- Helpers ----------
let toastTimer;
function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle("toast--error", isError);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 3500);
}

function showModal(modal) {
  modal.hidden = false;
  document.body.style.overflow = "hidden";
}

function hideModal(modal) {
  modal.hidden = true;
  if (!document.querySelector(".modal:not([hidden])")) document.body.style.overflow = "";
}

function setError(field, message, scope = form) {
  const output = scope.querySelector(`[data-error="${field}"]`);
  output.textContent = message;
  output.closest(".field").classList.toggle("invalid", Boolean(message));
}

function isValidGithubUrl(value) {
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean);
    return (
      url.protocol === "https:" &&
      (url.hostname === "github.com" || url.hostname === "www.github.com") &&
      segments.length >= 2
    );
  } catch (error) {
    return false;
  }
}

// Resize and compress images before storing their data URLs in MongoDB.
function readCoverImage(file, maxWidth = MAX_IMAGE_WIDTH) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file is not a valid image."));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------- Experiment actions ----------
async function loadExperiments() {
  const saved = readStoredExperiments();
  let remote = await apiRequest("/experiments");
  const migrationPending = localStorage.getItem("dsLabMigrationPending") === "true";
  if (saved.length > 0 && (remote.length === 0 || migrationPending)) {
    localStorage.setItem("dsLabMigrationPending", "true");
    const migrated = new Set(remote.map((item) => `${item.number}\u0000${item.title}`));
    for (const item of saved) {
      const migrationKey = `${item.number}\u0000${item.title}`;
      if (!migrated.has(migrationKey)) {
        await apiRequest("/experiments", {
          method: "POST",
          body: JSON.stringify(item),
        });
        migrated.add(migrationKey);
      }
    }
    localStorage.removeItem(EXPERIMENTS_KEY);
    localStorage.removeItem("dsLabMigrationPending");
    remote = await apiRequest("/experiments");
  }
  experiments = remote.map(normalizeExperiment);
}

async function addExperiment(data) {
  const saved = normalizeExperiment(await apiRequest("/experiments", {
    method: "POST",
    body: JSON.stringify(data),
  }));
  experiments.push(saved);
  showToast("Experiment added.");
  return true;
}

async function editExperiment(id, data) {
  const index = experiments.findIndex((item) => item.id === id);
  if (index === -1) return false;
  experiments[index] = normalizeExperiment(await apiRequest(`/experiments/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(data),
  }));
  showToast("Experiment updated.");
  return true;
}

// Deleting is two steps: the card menu opens the confirmation dialog,
// and only the dialog's Delete button calls deleteExperiment().
async function deleteExperiment(id) {
  const removed = experiments.find((item) => item.id === id);
  try {
    await apiRequest(`/experiments/${encodeURIComponent(id)}`, { method: "DELETE" });
    experiments = experiments.filter((item) => item.id !== id);
    if (removed) {
      await Promise.all(getVideoKeys(removed).map((key) => deleteVideo(key).catch((error) => {
        console.error("Could not delete an experiment video:", error);
      })));
    }
    renderExperiments();
    showToast("Experiment deleted.");
  } catch (error) {
    showToast(`Could not delete experiment: ${error.message}`, true);
  }
}

// ---------- Delete confirmation dialog ----------
const deleteModal = (() => {
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.id = "deleteModal";
  modal.hidden = true;
  modal.setAttribute("role", "alertdialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "deleteModalTitle");
  modal.setAttribute("aria-describedby", "deleteModalText");
  modal.innerHTML = `
    <div class="modal__backdrop" data-delete-cancel></div>
    <div class="modal__panel confirm">
      <h2 id="deleteModalTitle">Delete experiment</h2>
      <p class="confirm__text" id="deleteModalText">Are you sure you want to delete this experiment?</p>
      <p class="confirm__name" data-delete-name></p>
      <div class="modal__actions">
        <button type="button" class="btn btn--ghost" data-delete-cancel>Cancel</button>
        <button type="button" class="btn btn--danger" data-delete-confirm>Delete</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  return modal;
})();

const deleteConfirmBtn = deleteModal.querySelector("[data-delete-confirm]");

function requestDeleteExperiment(id) {
  const item = experiments.find((entry) => entry.id === id);
  if (!item) return;
  deletingId = id;
  deleteModal.querySelector("[data-delete-name]").textContent = `Experiment ${item.number}: ${item.title}`;
  deleteConfirmBtn.disabled = false;
  showModal(deleteModal);
  deleteModal.querySelector("[data-delete-cancel].btn").focus();
}

function closeDeleteModal() {
  deletingId = null;
  hideModal(deleteModal);
}

deleteModal.querySelectorAll("[data-delete-cancel]").forEach((node) => {
  node.addEventListener("click", closeDeleteModal);
});

deleteConfirmBtn.addEventListener("click", async () => {
  const id = deletingId; // only the experiment the dialog was opened for
  if (!id) return;
  deleteConfirmBtn.disabled = true;
  await deleteExperiment(id);
  closeDeleteModal();
});

// ---------- Progress & search ----------
// Progress = completed sub-experiments / all sub-experiments.
function getProgress() {
  const subs = experiments.flatMap((item) => item.subExperiments);
  if (subs.length === 0) return 0;
  return Math.round((subs.filter((sub) => sub.completed).length / subs.length) * 100);
}

function searchExperiments() {
  const query = searchInput.value.trim().toLowerCase();
  if (!query) return experiments;
  return experiments.filter((item) => {
    const searchable = [
      item.number, `experiment ${item.number}`, item.title, item.shortDescription,
      item.d2Heading, item.d2Content,
      ...item.subExperiments.flatMap((sub) => [sub.id, sub.title, sub.shortDescription]),
    ];
    return searchable.some((text) => String(text).toLowerCase().includes(query));
  });
}

// ---------- Rendering ----------
function detailsUrl(item, sub) {
  const base = `experiment.html?id=${encodeURIComponent(item.id)}`;
  return sub ? `${base}&sub=${encodeURIComponent(sub.letter)}` : base;
}

function renderExperiments() {
  closeAllMenus();
  const visible = searchExperiments().slice().sort((a, b) =>
    a.number.localeCompare(b.number, undefined, { numeric: true })
  );
  list.innerHTML = "";
  visible.forEach((item) => list.appendChild(createCard(item)));

  emptyState.hidden = experiments.length > 0;
  progressValue.textContent = `${getProgress()}%`;

  if (experiments.length > 0 && visible.length === 0) {
    const message = el("p", "", "No experiments match your search.");
    message.style.cssText = "text-align:center;color:var(--muted)";
    list.appendChild(message);
  }
}

function createCard(item) {
  const card = el("article", "exp-card");
  card.dataset.id = item.id;

  const cover = el("div", "exp-card__cover");
  const image = el("img");
  image.src = item.cover;
  image.alt = `${item.title} cover`;
  image.loading = "lazy";
  cover.appendChild(image);

  const body = el("div", "exp-card__body");
  body.append(
    el("p", "exp-card__number", `Experiment ${item.number}`),
    el("h3", "exp-card__title", item.title),
    el("p", "exp-card__desc", item.shortDescription)
  );

  // Read More sits under the image; sub-experiment buttons get their own row under the text
  const readMore = el("a", "btn btn--primary btn--small exp-card__readmore", "Read More");
  readMore.href = detailsUrl(item);
  card.append(cover, body, readMore, createMenu(item.id));

  // Only the sub-experiments that exist; no empty row when there are none
  if (item.subExperiments.length > 0) {
    const subs = el("div", "exp-card__subs");
    item.subExperiments.forEach((sub) => {
      // Visible text is "Exp A"; the internal letter/id (A, B, C...) is unchanged
      const button = el("button", "sub-btn" + (sub.completed ? " sub-btn--done" : ""), `Exp ${sub.letter}`);
      button.type = "button";
      button.title = `${sub.title}${sub.completed ? " (completed)" : ""}`;
      button.setAttribute("aria-label", `Open ${sub.title}`);
      button.addEventListener("click", () => openPreview(item.id, sub.id));
      subs.appendChild(button);
    });
    card.appendChild(subs);
  }
  return card;
}

// ---------- Card three-dot menu ----------
// One ⋮ button in the top-right corner of every card. Each menu is built for one
// experiment id, so Edit / Delete always act on the card that was clicked.
function createMenu(id) {
  const menu = el("div", "menu");

  menu.innerHTML = `
    <button type="button" class="menu__toggle" aria-label="Experiment options"
            aria-haspopup="true" aria-expanded="false">&#8942;</button>
    <div class="menu__list" role="menu" hidden>
      <button type="button" class="menu__item" role="menuitem" data-action="edit">
        <span aria-hidden="true">✏️</span> Edit
      </button>
      <button type="button" class="menu__item menu__item--danger" role="menuitem" data-action="delete">
        <span aria-hidden="true">🗑️</span> Delete
      </button>
    </div>`;

  const toggle = menu.querySelector(".menu__toggle");
  const menuList = menu.querySelector(".menu__list");

  // Nothing inside the menu may reach the card (Read More, etc.)
  menu.addEventListener("click", (event) => event.stopPropagation());

  toggle.addEventListener("click", (event) => {
    event.preventDefault();
    const willOpen = menuList.hidden;
    closeAllMenus();                       // only one dropdown open at a time
    if (willOpen) {
      menuList.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      menu.closest(".exp-card")?.classList.add("exp-card--menu-open");
    }
  });

  menuList.addEventListener("click", (event) => {
    event.preventDefault();
    const button = event.target.closest("[data-action]");
    if (!button) return;
    closeAllMenus();
    if (button.dataset.action === "edit") openExperimentModal(id);
    if (button.dataset.action === "delete") requestDeleteExperiment(id);
  });

  return menu;
}

function closeAllMenus() {
  document.querySelectorAll(".menu__list").forEach((menuList) => {
    menuList.hidden = true;
  });
  document.querySelectorAll(".menu__toggle").forEach((button) => {
    button.setAttribute("aria-expanded", "false");
  });
  document.querySelectorAll(".exp-card--menu-open").forEach((card) => {
    card.classList.remove("exp-card--menu-open");
  });
}

// ---------- Sub-experiment preview ----------
function openPreview(experimentId, subId) {
  const item = experiments.find((entry) => entry.id === experimentId);
  const sub = item && item.subExperiments.find((entry) => entry.id === subId);
  if (!sub) return;

  const github = document.getElementById("previewGithub");
  document.getElementById("previewLabel").textContent = `Experiment ${sub.id}`;
  document.getElementById("previewCover").src = sub.cover || item.cover; // own cover first
  document.getElementById("previewTitle").textContent = sub.title;
  document.getElementById("previewDesc").textContent = sub.shortDescription;
  document.getElementById("previewReadMore").href = detailsUrl(item, sub);
  github.hidden = !sub.githubUrl;
  if (sub.githubUrl) github.href = sub.githubUrl;
  showModal(previewModal);
}

// ---------- Video picker (used by the main form and every sub-experiment) ----------
function bindVideoControl(root, state) {
  const input = root.querySelector('input[type="file"]');
  const status = root.querySelector("[data-video-status]");
  const removeBtn = root.querySelector("[data-video-remove]");

  const refresh = () => {
    const hasVideo = Boolean(state.file || state.key);
    status.textContent = state.file ? `Selected: ${state.file.name}` : state.key ? "Saved video attached" : "No video";
    removeBtn.hidden = !hasVideo;
  };
  input.addEventListener("change", () => {
    const file = input.files[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      input.value = "";
      status.textContent = "Choose a video file.";
      return;
    }
    state.file = file;
    refresh();
  });
  removeBtn.addEventListener("click", () => {
    state.file = null;
    state.key = "";
    input.value = "";
    refresh();
  });
  refresh();
  return refresh;
}

refreshMainVideo = bindVideoControl(document.getElementById("mainVideoField"), mainVideo);

// ---------- Add / edit form ----------
function openExperimentModal(id = null) {
  editingId = id;
  form.reset();
  FORM_ERROR_FIELDS.forEach((field) => setError(field, ""));
  subList.innerHTML = "";
  mainCover = "";
  mainVideo.file = null;
  mainVideo.key = "";
  setPreview(coverPreview, uploadHint, "");

  if (id) {
    const item = experiments.find((entry) => entry.id === id);
    if (!item) { editingId = null; return; }
    numberInput.value = item.number;
    nameInput.value = item.title;
    shortInput.value = item.shortDescription;
    d2HeadingInput.value = item.d2Heading;
    d2ContentInput.value = item.d2Content;
    githubInput.value = item.githubUrl;
    mainCover = item.cover;
    mainVideo.key = item.video;
    setPreview(coverPreview, uploadHint, item.cover);
    item.subExperiments.forEach((sub) => addSubBlock(sub));
  }
  refreshMainVideo();

  modalTitle.textContent = id ? "Edit Experiment" : "Add Experiment";
  submitBtn.textContent = id ? "Save Changes" : "Add Experiment";
  showModal(experimentModal);
  numberInput.focus();
}

function setPreview(image, hint, src) {
  image.hidden = !src;
  if (src) image.src = src;
  hint.hidden = Boolean(src);
}

function nextLetter(index) {
  return index < 26 ? String.fromCharCode(65 + index) : `A${index - 25}`;
}

function addSubBlock(data = {}) {
  const block = el("fieldset", "sub-block");
  block.innerHTML = `
    <div class="sub-block__head">
      <strong class="sub-block__heading"></strong>
      <button type="button" class="btn btn--ghost btn--small" data-remove>Remove</button>
    </div>
    <div class="field-row field-row--letter">
      <label class="field"><span>Letter</span><input type="text" data-f="letter" maxlength="3"></label>
      <label class="field"><span>Name</span><input type="text" data-f="title" maxlength="80"></label>
    </div>
    <label class="field"><span>Short Description (D1)</span><textarea data-f="shortDescription" rows="2" maxlength="300"></textarea></label>
    <label class="field"><span>D2 Heading</span><input type="text" data-f="d2Heading" maxlength="80" placeholder="Long Description"></label>
    <label class="field"><span>D2 Long Content</span><textarea data-f="d2Content" rows="6"></textarea></label>
    <div class="field"><span>Cover Page (optional, main cover is used if empty)</span>
      <label class="upload upload--small"><img alt="Sub-experiment cover preview" hidden><span>Click to choose an image</span><input type="file" accept="image/*" hidden></label>
    </div>
    <div class="field"><span>Video (Optional)</span>
      <div class="video-field" data-video-field><input type="file" accept="video/*"><span data-video-status></span><button type="button" class="btn btn--ghost btn--small" data-video-remove hidden>Remove video</button></div>
    </div>
    <label class="field"><span>GitHub Link (optional)</span><input type="url" data-f="githubUrl" placeholder="https://github.com/username/project"></label>
    <label class="check"><input type="checkbox" data-f="completed"> Mark as completed</label>
    <small class="error" data-sub-error></small>`;

  const field = (name) => block.querySelector(`[data-f="${name}"]`);
  field("letter").value = data.letter || nextLetter(subList.children.length);
  ["title", "shortDescription", "d2Heading", "d2Content", "githubUrl"].forEach((name) => {
    field(name).value = data[name] || "";
  });
  field("completed").checked = data.completed !== false;

  const image = block.querySelector(".upload img");
  const hint = block.querySelector(".upload span");
  block.cover = data.cover || "";
  setPreview(image, hint, block.cover);
  block.querySelector('.upload input[type="file"]').addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      block.cover = await readCoverImage(file);
      setPreview(image, hint, block.cover);
    } catch (error) {
      block.querySelector("[data-sub-error]").textContent = error.message;
    }
  });

  block.video = { file: null, key: data.video || "" };
  bindVideoControl(block.querySelector("[data-video-field]"), block.video);

  block.querySelector("[data-remove]").addEventListener("click", () => {
    block.remove();
    refreshSubHeadings();
  });

  subList.appendChild(block);
  refreshSubHeadings();
}

function refreshSubHeadings() {
  [...subList.children].forEach((block, index) => {
    block.querySelector(".sub-block__heading").textContent = `Sub-experiment ${index + 1}`;
  });
}

function readSubBlock(block) {
  const value = (name) => block.querySelector(`[data-f="${name}"]`).value.trim();
  return {
    letter: value("letter").toUpperCase(),
    title: value("title"),
    shortDescription: value("shortDescription"),
    d2Heading: value("d2Heading"),
    d2Content: block.querySelector('[data-f="d2Content"]').value, // kept exactly as typed
    cover: block.cover,
    githubUrl: value("githubUrl"),
    completed: block.querySelector('[data-f="completed"]').checked,
  };
}

function validateSubBlock(block, usedLetters) {
  const sub = readSubBlock(block);
  let message = "";
  if (!/^[A-Z0-9]{1,3}$/.test(sub.letter)) message = "Enter a letter (up to 3 characters).";
  else if (usedLetters.has(sub.letter)) message = `Letter ${sub.letter} is used twice.`;
  else if (!sub.title) message = "Enter the sub-experiment name.";
  else if (!sub.shortDescription) message = "Enter a short description (D1).";
  else if (sub.githubUrl && !isValidGithubUrl(sub.githubUrl)) message = "Use a link like https://github.com/username/project-name";

  block.querySelector("[data-sub-error]").textContent = message;
  usedLetters.add(sub.letter);
  return !message;
}

function validateForm() {
  FORM_ERROR_FIELDS.forEach((field) => setError(field, ""));
  let valid = true;

  if (!numberInput.value.trim()) { setError("number", "Enter a number."); valid = false; }
  if (!nameInput.value.trim()) { setError("name", "Enter a name."); valid = false; }
  if (!shortInput.value.trim()) { setError("description", "Enter a short description (D1)."); valid = false; }
  if (!mainCover) { setError("cover", "Choose a cover image."); valid = false; }
  const github = githubInput.value.trim();
  if (github && !isValidGithubUrl(github)) {
    setError("github", "Use a link like https://github.com/username/project-name");
    valid = false;
  }

  // Sub-experiments are optional: only the blocks that exist are checked
  const usedLetters = new Set();
  [...subList.children].forEach((block) => { if (!validateSubBlock(block, usedLetters)) valid = false; });
  return valid;
}

async function handleMainCoverChange() {
  const file = coverInput.files[0];
  if (!file) return;
  try {
    mainCover = await readCoverImage(file);
    setPreview(coverPreview, uploadHint, mainCover);
    setError("cover", "");
  } catch (error) {
    setError("cover", error.message);
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!validateForm()) return;

  submitBtn.disabled = true;
  const newVideoKeys = [];
  // Newly chosen video files are stored by the API; existing keys are retained.
  const resolveVideo = async (state) => {
    if (!state.file) return state.key;
    const key = await saveVideo(state.file);
    newVideoKeys.push(key);
    return key;
  };

  try {
    const number = numberInput.value.trim();
    const data = {
      number,
      title: nameInput.value.trim(),
      shortDescription: shortInput.value.trim(),
      d2Heading: d2HeadingInput.value.trim(),
      d2Content: d2ContentInput.value,
      cover: mainCover,
      video: await resolveVideo(mainVideo),
      githubUrl: githubInput.value.trim(),
      subExperiments: [],
    };
    for (const block of [...subList.children]) {
      const sub = readSubBlock(block);
      data.subExperiments.push({ id: `${number}${sub.letter}`, ...sub, video: await resolveVideo(block.video) });
    }

    const previous = editingId ? experiments.find((item) => item.id === editingId) : null;
    const saved = editingId ? await editExperiment(editingId, data) : await addExperiment(data);
    if (!saved) {
      await Promise.all(newVideoKeys.map((key) => deleteVideo(key).catch((error) => {
        console.error("Could not clean up an uploaded video:", error);
      })));
      return; // keep the modal open so nothing is lost
    }
    if (previous) { // drop videos that were replaced or removed
      const kept = new Set(getVideoKeys(data));
      await Promise.all(getVideoKeys(previous).filter((key) => !kept.has(key)).map((key) => deleteVideo(key).catch((error) => {
        console.error("Could not delete a replaced video:", error);
      })));
    }

    hideModal(experimentModal);
    editingId = null;
    searchInput.value = "";
    renderExperiments();
  } catch (error) {
    await Promise.all(newVideoKeys.map((key) => deleteVideo(key).catch((cleanupError) => {
      console.error("Could not clean up an uploaded video:", cleanupError);
    })));
    showToast(`Could not save experiment: ${error.message}`, true);
  } finally {
    submitBtn.disabled = false;
  }
}

// ---------- ID card profile ----------
const profileModal = document.getElementById("profileModal");
const profileForm = document.getElementById("profileForm");
const profileFields = {
  name: document.getElementById("profileName"),
  roll: document.getElementById("profileRoll"),
  section: document.getElementById("profileSection"),
  branch: document.getElementById("profileBranch"),
  assistantProfessor: document.getElementById("profileProfessor"),
  githubRepo: document.getElementById("profileGithub"),
};
const profilePhotoInput = document.getElementById("profilePhotoInput");
const profilePhotoPreview = document.getElementById("profilePhotoPreview");
const idPhoto = document.getElementById("idPhoto");
const idOutputs = {
  name: document.getElementById("idName"),
  roll: document.getElementById("idRoll"),
  section: document.getElementById("idSection"),
  branch: document.getElementById("idBranch"),
  assistantProfessor: document.getElementById("idProfessor"),
  githubRepo: document.getElementById("idGithub"),
};

const defaultProfile = {
  name: idOutputs.name.textContent,
  roll: idOutputs.roll.textContent,
  section: idOutputs.section.textContent,
  branch: idOutputs.branch.textContent,
  assistantProfessor: "", // never hard-coded: comes from the profile form
  githubRepo: "",         // optional repo link from the profile form
  photo: idPhoto.getAttribute("src"),
};
let profile = { ...defaultProfile };
let pendingPhoto = "";

// Older saved profiles have no assistantProfessor; the merge with defaultProfile keeps them working.
async function loadProfile() {
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(PROFILE_KEY));
    } catch (error) {
      return null;
    }
  })();

  const remote = await apiRequest("/profile");
  const hasRemoteValues = ["name", "roll", "section", "branch", "assistantProfessor", "githubRepo", "photo"]
    .some((key) => Boolean(remote[key]));
  if (!hasRemoteValues && saved) {
    profile = { ...defaultProfile, ...saved };
    await apiRequest("/profile", {
      method: "PUT",
      body: JSON.stringify(profile),
    });
    localStorage.removeItem(PROFILE_KEY);
    return;
  }
  profile = { ...defaultProfile, ...remote, photo: remote.photo || defaultProfile.photo };
}

async function saveProfile() {
  try {
    profile = { ...defaultProfile, ...await apiRequest("/profile", {
      method: "PUT",
      body: JSON.stringify(profile),
    }) };
    profile.photo = profile.photo || defaultProfile.photo;
    return true;
  } catch (error) {
    showToast(`Could not save ID card: ${error.message}`, true);
    return false;
  }
}

function renderProfile() {
  Object.keys(idOutputs).forEach((key) => {
    const value = String(profile[key] || "").trim();
    if (key === "githubRepo") {
      const output = idOutputs[key];
      const valid = value && isValidGithubUrl(value);
      output.classList.toggle("is-empty", !valid);
      if (valid) {
        const link = el("a", "id-card__link", "View Repository ↗");
        link.href = value;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.title = value;
        output.replaceChildren(link);
      } else {
        output.textContent = "Not added";
      }
    } else if (key === "assistantProfessor") {
      idOutputs[key].textContent = value || "Not added";
      idOutputs[key].classList.toggle("is-empty", !value);
    } else {
      idOutputs[key].textContent = value;
    }
  });
  idPhoto.src = profile.photo;
}

function openProfileModal() {
  Object.keys(profileFields).forEach((key) => {
    profileFields[key].value = profile[key] || "";
    setError(`profile-${key}`, "", profileForm);
  });
  setError("profile-photo", "", profileForm);
  pendingPhoto = profile.photo;
  profilePhotoPreview.src = pendingPhoto;
  profileModal.hidden = false;
  document.body.style.overflow = "hidden";
  profileFields.name.focus();
}

function closeProfileModal() {
  profileModal.hidden = true;
  document.body.style.overflow = "";
}

async function handleProfilePhotoChange() {
  const file = profilePhotoInput.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    setError("profile-photo", "Choose an image file (JPG, PNG, WebP).", profileForm);
    return;
  }
  try {
    pendingPhoto = await readCoverImage(file, MAX_PHOTO_WIDTH);
    profilePhotoPreview.src = pendingPhoto;
    setError("profile-photo", "", profileForm);
  } catch (error) {
    setError("profile-photo", error.message, profileForm);
  }
}

async function handleProfileSubmit(event) {
  event.preventDefault();
  let valid = true;
  // Assistant Professor is optional, so only these four are required
  const labels = { name: "name", roll: "roll number", section: "section", branch: "branch" };

  Object.keys(labels).forEach((key) => {
    const empty = !profileFields[key].value.trim();
    setError(`profile-${key}`, empty ? `Enter your ${labels[key]}.` : "", profileForm);
    if (empty) valid = false;
  });
  // GitHub repo link is optional, but must be a valid github.com link when entered
  const repo = profileFields.githubRepo.value.trim();
  const repoOk = !repo || isValidGithubUrl(repo);
  setError("profile-githubRepo", repoOk ? "" : "Use a link like https://github.com/username/repo-name", profileForm);
  if (!repoOk) valid = false;
  if (!valid) return;

  const previous = profile;
  profile = { photo: pendingPhoto };
  Object.keys(profileFields).forEach((key) => (profile[key] = profileFields[key].value.trim()));

  if (!await saveProfile()) {
    profile = previous;
    return;
  }
  renderProfile();
  closeProfileModal();
  showToast("ID card updated.");
}

// ---------- Events ----------
document.getElementById("openAddBtn").addEventListener("click", () => openExperimentModal());
document.getElementById("addSubBtn").addEventListener("click", () => addSubBlock());
document.querySelectorAll(".modal").forEach((modal) => {
  modal.querySelectorAll("[data-close]").forEach((node) => node.addEventListener("click", () => hideModal(modal)));
});
form.addEventListener("submit", handleSubmit);
coverInput.addEventListener("change", handleMainCoverChange);
searchInput.addEventListener("input", renderExperiments);
document.getElementById("editIdBtn").addEventListener("click", openProfileModal);
profileForm.addEventListener("submit", handleProfileSubmit);
profilePhotoInput.addEventListener("change", handleProfilePhotoChange);

// Clicking anywhere outside an open menu closes it (clicks inside a menu stop here).
document.addEventListener("click", closeAllMenus);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeAllMenus();
  if (!deleteModal.hidden) deletingId = null;
  document.querySelectorAll(".modal:not([hidden])").forEach(hideModal);
});

// ---------- Start ----------
async function initialize() {
  try {
    await loadProfile();
  } catch (error) {
    showToast(`Could not load ID card from server: ${error.message}`, true);
  }
  renderProfile();

  try {
    await loadExperiments();
  } catch (error) {
    experiments = [];
    showToast(`Could not load experiments from server: ${error.message}`, true);
  }
  renderExperiments();
}

initialize();