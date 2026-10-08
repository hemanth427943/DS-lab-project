const catalogPage = document.querySelector("[data-catalog]");
const catalogType = catalogPage.dataset.catalog;
const catalogIsTool = catalogType === "tools";
const catalogEndpoint = `/${catalogType}`;
const catalogGrid = document.getElementById("catalogGrid");
const catalogEmpty = document.getElementById("catalogEmpty");
const catalogModal = document.getElementById("catalogModal");
const catalogForm = document.getElementById("catalogForm");
const catalogTitleInput = document.getElementById("catalogTitleInput");
const catalogDescriptionInput = document.getElementById("catalogDescriptionInput");
const catalogDetailsInput = document.getElementById("catalogDetailsInput");
const catalogUrlInput = document.getElementById("catalogUrlInput");
const catalogSaveButton = document.getElementById("saveCatalogBtn");
const catalogDeleteModal = document.getElementById("catalogDeleteModal");
const catalogDeletePrompt = document.getElementById("catalogDeletePrompt");
const catalogDeleteName = document.getElementById("catalogDeleteName");
const catalogToast = document.getElementById("catalogToast");
const catalogDetailsModal = document.getElementById("catalogDetailsModal");
const catalogDetailsTitle = document.getElementById("catalogDetailsTitle");
const catalogDetailsContent = document.getElementById("catalogDetailsContent");

let catalogItems = [];
let editingCatalogItem = null;
let deletingCatalogItem = null;
let catalogToastTimer;

function showCatalogToast(message, isError = false) {
  catalogToast.textContent = message;
  catalogToast.classList.toggle("toast--error", isError);
  catalogToast.hidden = false;
  clearTimeout(catalogToastTimer);
  catalogToastTimer = setTimeout(() => { catalogToast.hidden = true; }, 3500);
}

function setCatalogError(field, message) {
  const output = catalogForm.querySelector(`[data-catalog-error="${field}"]`);
  output.textContent = message;
  output.classList.toggle("is-visible", Boolean(message));
}

function clearCatalogErrors() {
  ["title", "description", catalogIsTool ? "details" : "url"].forEach((field) => setCatalogError(field, ""));
}

function closeCatalogMenus() {
  document.querySelectorAll(".module-card__menu-list:not([hidden])").forEach((menu) => {
    menu.hidden = true;
    menu.parentElement.querySelector(".module-card__menu-toggle").setAttribute("aria-expanded", "false");
  });
}

function closeCatalogForm() {
  catalogModal.hidden = true;
  document.body.style.overflow = "";
  editingCatalogItem = null;
  catalogForm.reset();
  clearCatalogErrors();
}

function openCatalogForm(item = null) {
  editingCatalogItem = item;
  catalogForm.reset();
  clearCatalogErrors();
  catalogTitleInput.value = item ? item.title : "";
  catalogDescriptionInput.value = item ? item.description : "";
  if (catalogIsTool) catalogDetailsInput.value = item ? item.details : "";
  else catalogUrlInput.value = item ? item.url : "";

  document.getElementById("catalogModalTitle").textContent = item
    ? `Edit ${catalogIsTool ? "Tool" : "Resource"}`
    : `Add ${catalogIsTool ? "Tool" : "Resource"}`;
  catalogSaveButton.textContent = item ? "Save Changes" : `Save ${catalogIsTool ? "Tool" : "Resource"}`;
  catalogModal.hidden = false;
  document.body.style.overflow = "hidden";
  catalogTitleInput.focus();
}

function validateCatalogUrl(value) {
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname);
  } catch (error) {
    return false;
  }
}

function validateCatalogForm() {
  clearCatalogErrors();
  let valid = true;
  if (!catalogTitleInput.value.trim()) {
    setCatalogError("title", `Enter a ${catalogIsTool ? "tool" : "resource"} title.`);
    valid = false;
  }
  if (!catalogDescriptionInput.value.trim()) {
    setCatalogError("description", "Enter a short description.");
    valid = false;
  }
  if (catalogIsTool && !catalogDetailsInput.value.trim()) {
    setCatalogError("details", "Enter a detailed explanation.");
    valid = false;
  }
  if (!catalogIsTool && !validateCatalogUrl(catalogUrlInput.value)) {
    setCatalogError("url", "Enter a valid URL beginning with https:// or http://.");
    valid = false;
  }
  return valid;
}

async function saveCatalogItem(event) {
  event.preventDefault();
  if (!validateCatalogForm()) return;

  const isEditing = Boolean(editingCatalogItem);
  const payload = {
    title: catalogTitleInput.value.trim(),
    description: catalogDescriptionInput.value.trim(),
  };
  if (catalogIsTool) payload.details = catalogDetailsInput.value.trim();
  else payload.url = catalogUrlInput.value.trim();

  catalogSaveButton.disabled = true;
  try {
    await apiRequest(isEditing ? `${catalogEndpoint}/${encodeURIComponent(editingCatalogItem.id)}` : catalogEndpoint, {
      method: isEditing ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });
    closeCatalogForm();
    await loadCatalogItems();
    showCatalogToast(`${catalogIsTool ? "Tool" : "Resource"} ${isEditing ? "updated" : "added"}.`);
  } catch (error) {
    showCatalogToast(error.message || `Could not save the ${catalogIsTool ? "tool" : "resource"}.`, true);
  } finally {
    catalogSaveButton.disabled = false;
  }
}

function createCatalogMenu(item) {
  const menu = el("div", "module-card__menu");
  const toggle = el("button", "module-card__menu-toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-label", `Edit or delete ${item.title}`);
  toggle.setAttribute("aria-haspopup", "menu");
  toggle.setAttribute("aria-expanded", "false");
  toggle.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13.7 3.3a1.8 1.8 0 0 1 2.5 2.5l-8.8 8.8-3.5.9.9-3.5 8.9-8.7ZM11.9 5.1l3 3M3.5 16.5h13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const menuList = el("div", "module-card__menu-list");
  menuList.hidden = true;
  menuList.setAttribute("role", "menu");
  const editButton = el("button", "module-card__menu-action", "Edit");
  editButton.type = "button";
  editButton.setAttribute("role", "menuitem");
  editButton.insertAdjacentHTML("afterbegin", '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13.7 3.3a1.8 1.8 0 0 1 2.5 2.5l-8.8 8.8-3.5.9.9-3.5 8.9-8.7ZM11.9 5.1l3 3M3.5 16.5h13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>');
  editButton.addEventListener("click", () => {
    closeCatalogMenus();
    openCatalogForm(item);
  });

  const deleteButton = el("button", "module-card__menu-action module-card__menu-action--danger", "Delete");
  deleteButton.type = "button";
  deleteButton.setAttribute("role", "menuitem");
  deleteButton.insertAdjacentHTML("afterbegin", '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6h11l-.7 10.2a1.5 1.5 0 0 1-1.5 1.4H6.7a1.5 1.5 0 0 1-1.5-1.4L4.5 6ZM3 4h14M8 4V2.8h4V4m-3 5v5m2-5v5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>');
  deleteButton.addEventListener("click", () => {
    closeCatalogMenus();
    deletingCatalogItem = item;
    catalogDeletePrompt.textContent = `Are you sure you want to delete this ${catalogIsTool ? "tool" : "resource"}?`;
    catalogDeleteName.textContent = item.title;
    catalogDeleteModal.hidden = false;
    document.body.style.overflow = "hidden";
  });

  menuList.append(editButton, deleteButton);
  menu.append(toggle, menuList);
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = menuList.hidden;
    closeCatalogMenus();
    menuList.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  });
  menuList.addEventListener("click", (event) => event.stopPropagation());
  return menu;
}

function createCatalogCard(item) {
  const card = el("article", "module-card");
  const eyebrow = el("p", "module-card__eyebrow", catalogIsTool ? "Data science tool" : "Learning resource");
  const title = el("h2", "", item.title);
  const description = el("p", "module-card__description", item.description);
  const actions = el("div", "module-card__actions");

  if (catalogIsTool) {
    const detailsButton = el("button", "btn btn--ghost", "Read More");
    detailsButton.type = "button";
    detailsButton.addEventListener("click", () => {
      catalogDetailsTitle.textContent = item.title;
      catalogDetailsContent.textContent = item.details;
      catalogDetailsModal.hidden = false;
      document.body.style.overflow = "hidden";
    });
    actions.append(detailsButton);
  } else {
    const openLink = el("a", "btn btn--primary", "Open Resource");
    openLink.href = item.url;
    openLink.target = "_blank";
    openLink.rel = "noopener noreferrer";
    openLink.setAttribute("aria-label", `Open ${item.title} in a new tab`);
    actions.append(openLink);
  }

  card.append(createCatalogMenu(item), eyebrow, title, description, actions);
  return card;
}

function renderCatalogItems() {
  catalogGrid.replaceChildren(...catalogItems.map(createCatalogCard));
  catalogEmpty.hidden = catalogItems.length > 0;
}

async function loadCatalogItems() {
  catalogItems = await apiRequest(catalogEndpoint);
  renderCatalogItems();
}

async function deleteCatalogItem() {
  if (!deletingCatalogItem) return;
  const deleting = deletingCatalogItem;
  const confirmButton = document.getElementById("confirmCatalogDelete");
  confirmButton.disabled = true;
  try {
    await apiRequest(`${catalogEndpoint}/${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
    catalogDeleteModal.hidden = true;
    document.body.style.overflow = "";
    deletingCatalogItem = null;
    await loadCatalogItems();
    showCatalogToast(`${catalogIsTool ? "Tool" : "Resource"} deleted.`);
  } catch (error) {
    showCatalogToast(error.message || `Could not delete the ${catalogIsTool ? "tool" : "resource"}.`, true);
  } finally {
    confirmButton.disabled = false;
  }
}

document.getElementById("openCatalogBtn").addEventListener("click", () => openCatalogForm());
catalogForm.addEventListener("submit", saveCatalogItem);
document.querySelectorAll("[data-catalog-close]").forEach((element) => element.addEventListener("click", closeCatalogForm));
document.querySelectorAll("[data-delete-close]").forEach((element) => element.addEventListener("click", () => {
  catalogDeleteModal.hidden = true;
  deletingCatalogItem = null;
  document.body.style.overflow = "";
}));
document.querySelectorAll("[data-details-close]").forEach((element) => element.addEventListener("click", () => {
  catalogDetailsModal.hidden = true;
  document.body.style.overflow = "";
}));
document.getElementById("confirmCatalogDelete").addEventListener("click", deleteCatalogItem);
document.addEventListener("click", closeCatalogMenus);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeCatalogMenus();
    [catalogModal, catalogDeleteModal, catalogDetailsModal].filter(Boolean).forEach((modal) => {
      modal.hidden = true;
    });
    document.body.style.overflow = "";
    deletingCatalogItem = null;
    editingCatalogItem = null;
  }
});

loadCatalogItems().catch((error) => {
  catalogItems = [];
  renderCatalogItems();
  showCatalogToast(`Could not load ${catalogIsTool ? "tools" : "resources"}: ${error.message}`, true);
});
