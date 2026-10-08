const moduleGrid = document.getElementById("moduleGrid");
const moduleEmpty = document.getElementById("moduleEmpty");
const moduleModal = document.getElementById("moduleModal");
const moduleForm = document.getElementById("moduleForm");
const moduleTitleInput = document.getElementById("moduleTitle");
const moduleDescriptionInput = document.getElementById("moduleDescription");
const moduleFileInput = document.getElementById("moduleFile");
const moduleFileLabel = document.getElementById("moduleFileLabel");
const moduleFileName = document.getElementById("moduleFileName");
const moduleSaveButton = document.getElementById("saveModuleBtn");
const moduleToast = document.getElementById("moduleToast");
const deleteModuleModal = document.getElementById("deleteModuleModal");
const deleteModuleName = document.getElementById("deleteModuleName");
const confirmDeleteModuleButton = document.getElementById("confirmDeleteModule");
const ALLOWED_MODULE_EXTENSIONS = new Set(["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "zip"]);
const MAX_MODULE_FILE_SIZE = 50 * 1024 * 1024;

let modules = [];
let editingModule = null;
let deletingModule = null;
let selectedModuleFile = null;
let moduleToastTimer;

function showModuleToast(message, isError = false) {
  moduleToast.textContent = message;
  moduleToast.classList.toggle("toast--error", isError);
  moduleToast.hidden = false;
  clearTimeout(moduleToastTimer);
  moduleToastTimer = setTimeout(() => { moduleToast.hidden = true; }, 3500);
}

function setModuleError(field, message) {
  const output = moduleForm.querySelector(`[data-module-error="${field}"]`);
  output.textContent = message;
  output.classList.toggle("is-visible", Boolean(message));
}

function clearModuleErrors() {
  ["title", "description", "file"].forEach((field) => setModuleError(field, ""));
}

function getFileExtension(fileName) {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot + 1).toLowerCase();
}

function validateModuleFile(file) {
  if (!file) return "Choose a file for this module.";
  if (!ALLOWED_MODULE_EXTENSIONS.has(getFileExtension(file.name))) {
    return "Use a PDF, DOC/DOCX, PPT/PPTX, XLS/XLSX, or ZIP file.";
  }
  if (!file.size) return "The selected file is empty.";
  if (file.size > MAX_MODULE_FILE_SIZE) return "Files must be 50 MB or smaller.";
  return "";
}

function closeModuleMenus() {
  document.querySelectorAll(".module-card__menu-list:not([hidden])").forEach((menu) => {
    menu.hidden = true;
    menu.parentElement.querySelector(".module-card__menu-toggle").setAttribute("aria-expanded", "false");
  });
}

function closeModuleForm() {
  moduleModal.hidden = true;
  document.body.style.overflow = "";
  editingModule = null;
  selectedModuleFile = null;
  moduleForm.reset();
  moduleFileLabel.textContent = "Choose a course file";
  moduleFileName.textContent = "PDF, DOC/DOCX, PPT/PPTX, XLS/XLSX, ZIP · up to 50 MB";
  moduleFileName.classList.remove("is-selected");
  moduleFileInput.required = true;
  clearModuleErrors();
}

function openModuleForm(module = null) {
  editingModule = module;
  selectedModuleFile = null;
  moduleForm.reset();
  clearModuleErrors();
  moduleTitleInput.value = module ? module.title : "";
  moduleDescriptionInput.value = module ? module.description : "";
  moduleFileInput.required = !module;
  moduleFileLabel.textContent = module ? "Choose a replacement file (optional)" : "Choose a course file";
  moduleFileName.textContent = module ? `Current file: ${module.fileName}` : "PDF, DOC/DOCX, PPT/PPTX, XLS/XLSX, ZIP · up to 50 MB";
  moduleFileName.classList.toggle("is-selected", Boolean(module));
  document.getElementById("moduleModalTitle").textContent = module ? "Edit Module" : "Add Module";
  moduleSaveButton.textContent = module ? "Save Changes" : "Save Module";
  moduleModal.hidden = false;
  document.body.style.overflow = "hidden";
  moduleTitleInput.focus();
}

async function uploadModuleFile(file) {
  return apiRequest("/module-files", {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Module-File-Name": encodeURIComponent(file.name),
    },
    body: file,
  });
}

async function removeUnattachedModuleFile(id) {
  if (!id) return;
  try {
    await apiRequest(`/module-files/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (error) {
    console.error("Could not remove an unused module upload:", error);
  }
}

async function saveModule(event) {
  event.preventDefault();
  clearModuleErrors();
  const isEditing = Boolean(editingModule);
  const title = moduleTitleInput.value.trim();
  const description = moduleDescriptionInput.value.trim();
  let valid = true;

  if (!title) {
    setModuleError("title", "Enter a module title.");
    valid = false;
  }
  if (!description) {
    setModuleError("description", "Enter a short description.");
    valid = false;
  }
  if (selectedModuleFile) {
    const fileError = validateModuleFile(selectedModuleFile);
    if (fileError) {
      setModuleError("file", fileError);
      valid = false;
    }
  } else if (!editingModule) {
    setModuleError("file", "Choose a file for this module.");
    valid = false;
  }
  if (!valid) return;

  moduleSaveButton.disabled = true;
  let uploadedFileId = "";
  try {
    let file = editingModule ? {
      fileId: editingModule.fileId,
      fileName: editingModule.fileName,
      fileType: editingModule.fileType,
    } : null;

    if (selectedModuleFile) {
      const upload = await uploadModuleFile(selectedModuleFile);
      uploadedFileId = upload.id;
      file = { fileId: upload.id, fileName: upload.fileName, fileType: upload.fileType };
    }

    const payload = { title, description, ...file };
    const saved = await apiRequest(editingModule ? `/modules/${encodeURIComponent(editingModule.id)}` : "/modules", {
      method: editingModule ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });
    uploadedFileId = "";
    closeModuleForm();
    await loadModules();
    showModuleToast(isEditing ? "Module updated." : "Module added.");
    return saved;
  } catch (error) {
    await removeUnattachedModuleFile(uploadedFileId);
    showModuleToast(error.message || "Could not save the module.", true);
  } finally {
    moduleSaveButton.disabled = false;
  }
}

function createModuleCard(module) {
  const card = el("article", "module-card");
  const menu = el("div", "module-card__menu");
  const menuToggle = el("button", "module-card__menu-toggle");
  menuToggle.type = "button";
  menuToggle.setAttribute("aria-label", `Edit or delete ${module.title}`);
  menuToggle.setAttribute("aria-haspopup", "menu");
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13.7 3.3a1.8 1.8 0 0 1 2.5 2.5l-8.8 8.8-3.5.9.9-3.5 8.9-8.7ZM11.9 5.1l3 3M3.5 16.5h13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const menuList = el("div", "module-card__menu-list");
  menuList.hidden = true;
  menuList.setAttribute("role", "menu");
  const editButton = el("button", "module-card__menu-action", "Edit");
  editButton.type = "button";
  editButton.setAttribute("role", "menuitem");
  editButton.insertAdjacentHTML("afterbegin", '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13.7 3.3a1.8 1.8 0 0 1 2.5 2.5l-8.8 8.8-3.5.9.9-3.5 8.9-8.7ZM11.9 5.1l3 3M3.5 16.5h13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>');
  editButton.addEventListener("click", () => {
    closeModuleMenus();
    openModuleForm(module);
  });

  const deleteButton = el("button", "module-card__menu-action module-card__menu-action--danger", "Delete");
  deleteButton.type = "button";
  deleteButton.setAttribute("role", "menuitem");
  deleteButton.insertAdjacentHTML("afterbegin", '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6h11l-.7 10.2a1.5 1.5 0 0 1-1.5 1.4H6.7a1.5 1.5 0 0 1-1.5-1.4L4.5 6ZM3 4h14M8 4V2.8h4V4m-3 5v5m2-5v5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>');
  deleteButton.addEventListener("click", () => {
    closeModuleMenus();
    deletingModule = module;
    deleteModuleName.textContent = module.title;
    deleteModuleModal.hidden = false;
    document.body.style.overflow = "hidden";
  });

  menuList.append(editButton, deleteButton);
  menu.append(menuToggle, menuList);
  menuToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = menuList.hidden;
    closeModuleMenus();
    menuList.hidden = !open;
    menuToggle.setAttribute("aria-expanded", String(open));
  });
  menuList.addEventListener("click", (event) => event.stopPropagation());

  const eyebrow = el("p", "module-card__eyebrow", "Learning module");
  const title = el("h2", "", module.title);
  const description = el("p", "module-card__description", module.description);
  const file = el("div", "module-card__file");
  const fileIcon = el("span", "module-card__file-icon");
  fileIcon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.8h6l4 4v12.4H7a1.5 1.5 0 0 1-1.5-1.5V5.3A1.5 1.5 0 0 1 7 3.8Zm6 0v4h4M8.5 13h7m-7 3h7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const fileMeta = el("span", "module-card__file-meta");
  fileMeta.append(el("strong", "", module.fileName), el("span", "", `${getFileExtension(module.fileName)} file`));
  file.append(fileIcon, fileMeta);

  const actions = el("div", "module-card__actions");
  const fileUrl = `${API_BASE}/module-files/${encodeURIComponent(module.fileId)}`;
  const viewLink = el("a", "btn btn--ghost", "View file");
  viewLink.href = fileUrl;
  viewLink.target = "_blank";
  viewLink.rel = "noopener noreferrer";
  viewLink.setAttribute("aria-label", `View ${module.fileName}`);
  const downloadLink = el("a", "btn btn--primary", "Download");
  downloadLink.href = `${fileUrl}?download=1`;
  downloadLink.setAttribute("aria-label", `Download ${module.fileName}`);
  actions.append(viewLink, downloadLink);

  card.append(menu, eyebrow, title, description, file, actions);
  return card;
}

function renderModules() {
  moduleGrid.replaceChildren(...modules.map(createModuleCard));
  moduleEmpty.hidden = modules.length > 0;
}

async function loadModules() {
  modules = await apiRequest("/modules");
  renderModules();
}

async function deleteModule() {
  if (!deletingModule) return;
  confirmDeleteModuleButton.disabled = true;
  try {
    await apiRequest(`/modules/${encodeURIComponent(deletingModule.id)}`, { method: "DELETE" });
    deleteModuleModal.hidden = true;
    document.body.style.overflow = "";
    deletingModule = null;
    await loadModules();
    showModuleToast("Module deleted.");
  } catch (error) {
    showModuleToast(error.message || "Could not delete the module.", true);
  } finally {
    confirmDeleteModuleButton.disabled = false;
  }
}

document.getElementById("openModuleBtn").addEventListener("click", () => openModuleForm());
moduleForm.addEventListener("submit", saveModule);
moduleFileInput.addEventListener("change", () => {
  selectedModuleFile = moduleFileInput.files[0] || null;
  clearModuleErrors();
  if (selectedModuleFile) {
    moduleFileLabel.textContent = "File selected";
    moduleFileName.textContent = selectedModuleFile.name;
    moduleFileName.classList.add("is-selected");
    const error = validateModuleFile(selectedModuleFile);
    if (error) setModuleError("file", error);
  } else if (editingModule) {
    moduleFileLabel.textContent = "Choose a replacement file (optional)";
    moduleFileName.textContent = `Current file: ${editingModule.fileName}`;
  } else {
    moduleFileLabel.textContent = "Choose a course file";
    moduleFileName.textContent = "PDF, DOC/DOCX, PPT/PPTX, XLS/XLSX, ZIP · up to 50 MB";
  }
});

document.querySelectorAll("[data-module-close]").forEach((element) => element.addEventListener("click", closeModuleForm));
document.querySelectorAll("[data-module-delete-close]").forEach((element) => element.addEventListener("click", () => {
  deleteModuleModal.hidden = true;
  deletingModule = null;
  document.body.style.overflow = "";
}));
confirmDeleteModuleButton.addEventListener("click", deleteModule);
document.addEventListener("click", closeModuleMenus);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModuleMenus();
});

loadModules().catch((error) => {
  modules = [];
  renderModules();
  showModuleToast(`Could not load modules: ${error.message}`, true);
});
