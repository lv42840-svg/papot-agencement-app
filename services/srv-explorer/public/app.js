"use strict";
const $ = (id) => document.getElementById(id);
let currentPath = "",
  entries = [],
  maxUpload = 0,
  uploading = false,
  loadVersion = 0,
  previewEntries = [],
  previewIndex = 0,
  canDeposit = false,
  isAdmin = false,
  aclRevision = 0,
  aclSelectedKey = "",
  aclUsers = [],
  aclGrants = {},
  aclRules = new Map();
const previewable = (name) => /\.(pdf|jpe?g|png|gif|webp|txt)$/i.test(name);
const filePath = (name) => [currentPath, name].filter(Boolean).join("/");
const fileUrl = (path, preview = false) =>
  `/api/file?${new URLSearchParams({ path, ...(preview ? { preview: "1" } : {}) })}`;
const size = (bytes) =>
  bytes < 1024
    ? `${bytes} o`
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(1)} Ko`
      : `${(bytes / 1048576).toFixed(1)} Mo`;
function status(message = "", error = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
}
function loggedOut() {
  loadVersion++;
  $("login").hidden = false;
  $("explorer").hidden = true;
  $("permissions").hidden = true;
  $("view-tabs").hidden = true;
  $("admin-tab").hidden = true;
  $("account").hidden = true;
  isAdmin = false;
  entries = [];
  $("files").replaceChildren();
  $("preview-dialog").close();
  $("preview-content").replaceChildren();
  $("folder-dialog").close();
}
async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) loggedOut();
    throw new Error(data.error || "La requête a échoué.");
  }
  return data;
}
function loggedIn(data) {
  $("login").hidden = true;
  $("explorer").hidden = false;
  $("permissions").hidden = true;
  $("view-tabs").hidden = false;
  $("account").hidden = false;
  isAdmin = data.user.isAdmin === true;
  $("admin-tab").hidden = !isAdmin;
  $("explorer-tab").classList.add("tab-active");
  $("admin-tab").classList.remove("tab-active");
  $("user-name").textContent = data.user.displayName;
  maxUpload = data.maxUpload;
}
function button(label, callback, className = "") {
  const element = document.createElement("button");
  element.textContent = label;
  element.className = className;
  element.addEventListener("click", callback);
  return element;
}
function breadcrumbs() {
  const nav = $("breadcrumbs");
  nav.replaceChildren(button("Serveur / srv", () => navigate("")));
  let path = "";
  for (const part of currentPath.split("/").filter(Boolean)) {
    path = [path, part].filter(Boolean).join("/");
    const target = path;
    const separator = document.createElement("span");
    separator.textContent = "/";
    nav.append(
      separator,
      button(part, () => navigate(target)),
    );
  }
}
function render() {
  const query = $("search").value.trim().toLocaleLowerCase("fr");
  const filtered = entries.filter((item) => item.name.toLocaleLowerCase("fr").includes(query));
  $("files").replaceChildren();
  for (const item of filtered) {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    const name = button(
      "",
      () => (item.directory ? navigate(filePath(item.name)) : openPreview(item.name)),
      "file-name",
    );
    const icon = document.createElement("span");
    icon.className = `file-icon ${item.directory ? "folder-icon" : ""}`;
    icon.textContent = item.directory ? "▰" : "▤";
    icon.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = item.name;
    name.append(icon, text);
    nameCell.append(name);
    const date = document.createElement("td");
    date.textContent = new Date(item.modified).toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    });
    const bytes = document.createElement("td");
    bytes.textContent = item.directory ? "—" : size(item.size);
    const action = document.createElement("td");
    if (!item.directory) {
      const link = document.createElement("a");
      link.href = fileUrl(filePath(item.name));
      link.textContent = "Télécharger";
      link.className = "download";
      link.download = item.name;
      action.append(link);
    }
    row.append(nameCell, date, bytes, action);
    $("files").append(row);
  }
  $("empty").hidden = filtered.length > 0;
  $("empty").textContent = query
    ? "Aucun fichier ne correspond à votre recherche."
    : "Ce dossier est vide. Vous pouvez y déposer vos fichiers.";
  $("count").textContent =
    `${filtered.length} élément${filtered.length > 1 ? "s" : ""}${query ? ` sur ${entries.length}` : ""}`;
}
async function navigate(path, updateHash = true) {
  if (uploading) {
    status("Attendez la fin du dépôt avant de changer de dossier.");
    return;
  }
  const version = ++loadVersion;
  status("Chargement du dossier…");
  $("files").replaceChildren();
  $("empty").hidden = true;
  try {
    const data = await api(`/api/files?${new URLSearchParams({ path })}`);
    if (version !== loadVersion) return;
    currentPath = path;
    entries = data.entries;
    canDeposit = data.canWrite === true;
    $("new-folder").hidden = !canDeposit;
    $("upload-button").hidden = !canDeposit;
    $("search").value = "";
    if (updateHash) history.replaceState(null, "", `#${encodeURIComponent(path)}`);
    breadcrumbs();
    render();
    status(data.truncated ? "Affichage limité aux 5 000 premiers éléments de ce dossier." : "");
  } catch (error) {
    if (version === loadVersion || $("explorer").hidden) status(error.message, true);
  }
}
$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  submit.disabled = true;
  status("Connexion…");
  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        source: $("source").value,
        username: $("username").value,
        password: $("password").value,
      }),
    });
    $("password").value = "";
    loggedIn(data);
    await navigate("");
  } catch (error) {
    status(error.message, true);
  } finally {
    submit.disabled = false;
  }
});
$("logout").addEventListener("click", async () => {
  if (uploading) {
    status("Attendez la fin du dépôt avant de vous déconnecter.");
    return;
  }
  try {
    await api("/api/logout", { method: "POST" });
    loggedOut();
    status("Vous êtes déconnecté.");
  } catch (error) {
    status(error.message, true);
  }
});
$("search").addEventListener("input", render);
$("refresh").addEventListener("click", () => navigate(currentPath));
$("new-folder").addEventListener("click", () => {
  if (uploading) return;
  $("folder-name").value = "";
  $("folder-error").textContent = "";
  $("folder-dialog").showModal();
  $("folder-name").focus();
});
$("folder-cancel").addEventListener("click", () => $("folder-dialog").close());
$("folder-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  event.submitter.disabled = true;
  try {
    await api(`/api/folders?${new URLSearchParams({ path: currentPath })}`, {
      method: "POST",
      body: JSON.stringify({ name: $("folder-name").value.trim() }),
    });
    $("folder-dialog").close();
    await navigate(currentPath);
  } catch (error) {
    $("folder-error").textContent = error.message;
  } finally {
    event.submitter.disabled = false;
  }
});
$("upload-button").addEventListener("click", () => $("upload").click());
$("upload").addEventListener("change", () => {
  uploadFiles([...$("upload").files]);
  $("upload").value = "";
});
for (const type of ["dragenter", "dragover"])
  $("dropzone").addEventListener(type, (event) => {
    event.preventDefault();
    $("dropzone").classList.add("drag");
  });
$("dropzone").addEventListener("dragleave", () => $("dropzone").classList.remove("drag"));
$("dropzone").addEventListener("drop", (event) => {
  event.preventDefault();
  $("dropzone").classList.remove("drag");
  uploadFiles([...event.dataTransfer.files]);
});
async function uploadFiles(files) {
  if (uploading || !files.length || !canDeposit) return;
  uploading = true;
  $("upload-button").disabled = true;
  $("new-folder").disabled = true;
  $("transfer").hidden = false;
  let count = 0;
  const failures = [];
  for (const file of files) {
    if ($("explorer").hidden) break;
    $("transfer-label").textContent =
      `Dépôt ${count + failures.length + 1}/${files.length} · ${file.name}`;
    $("progress").value = 0;
    try {
      if (file.size > maxUpload) throw new Error(`Taille maximale : ${size(maxUpload)}.`);
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(
          "PUT",
          `/api/upload?${new URLSearchParams({ path: currentPath, name: file.name })}`,
        );
        xhr.timeout = 15 * 60 * 1000;
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) $("progress").value = (event.loaded / event.total) * 100;
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) return resolve();
          if (xhr.status === 401) loggedOut();
          let message = "Le dépôt a échoué.";
          try {
            message = JSON.parse(xhr.responseText).error || message;
          } catch {
            /* generic message */
          }
          reject(new Error(message));
        };
        xhr.onerror = xhr.ontimeout = () =>
          reject(new Error("Transfert interrompu. Vérifiez le dossier avant de réessayer."));
        xhr.send(file);
      });
      count++;
    } catch (error) {
      failures.push(`${file.name} : ${error.message}`);
    }
  }
  uploading = false;
  $("upload-button").disabled = false;
  $("new-folder").disabled = false;
  $("transfer").hidden = true;
  if (!$("explorer").hidden) await navigate(currentPath);
  status(
    `${count} fichier${count > 1 ? "s" : ""} déposé${count > 1 ? "s" : ""}.${failures.length ? ` ${failures.join(" ")}` : ""}`,
    failures.length > 0,
  );
}
function openPreview(name) {
  if (!previewable(name)) {
    const link = document.createElement("a");
    link.href = fileUrl(filePath(name));
    link.download = name;
    link.click();
    return;
  }
  previewEntries = entries.filter((item) => !item.directory && previewable(item.name));
  previewIndex = previewEntries.findIndex((item) => item.name === name);
  showPreview();
  $("preview-dialog").showModal();
}
function showPreview() {
  const item = previewEntries[previewIndex];
  if (!item) return;
  $("preview-name").textContent = item.name;
  $("preview-download").href = fileUrl(filePath(item.name));
  $("preview-content").replaceChildren();
  const image = /\.(jpe?g|png|gif|webp)$/i.test(item.name);
  const content = document.createElement(image ? "img" : "iframe");
  if (image) {
    content.alt = item.name;
    content.onerror = () => {
      $("preview-content").textContent =
        "Aperçu indisponible. Actualisez votre session ou téléchargez le fichier.";
    };
  } else {
    content.title = item.name;
    // Sandboxed frames disable the browser's native PDF viewer.
    // Only allowlisted application/pdf responses use that viewer.
    if (!/\.pdf$/i.test(item.name)) content.setAttribute("sandbox", "allow-same-origin");
  }
  content.src = fileUrl(filePath(item.name), true);
  $("preview-content").append(content);
  $("previous").disabled = previewIndex === 0;
  $("next").disabled = previewIndex === previewEntries.length - 1;
  $("preview-position").textContent = `${previewIndex + 1} / ${previewEntries.length}`;
}
$("preview-close").addEventListener("click", () => $("preview-dialog").close());
$("preview-dialog").addEventListener("close", () => $("preview-content").replaceChildren());
$("previous").addEventListener("click", () => {
  if (previewIndex > 0) {
    previewIndex--;
    showPreview();
  }
});
$("next").addEventListener("click", () => {
  if (previewIndex < previewEntries.length - 1) {
    previewIndex++;
    showPreview();
  }
});
$("preview-dialog").addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") $("previous").click();
  if (event.key === "ArrowRight") $("next").click();
});

// Folder ACL editor. No permissions are trusted from this page: the API enforces every action.
function showTab(tab) {
  if (uploading) return;
  $("explorer").hidden = tab !== "explorer";
  $("permissions").hidden = tab !== "permissions";
  $("explorer-tab").classList.toggle("tab-active", tab === "explorer");
  $("admin-tab").classList.toggle("tab-active", tab === "permissions");
  status("");
}
$("explorer-tab").addEventListener("click", () => showTab("explorer"));
$("admin-tab").addEventListener("click", async () => {
  if (!isAdmin) return;
  showTab("permissions");
  try {
    await loadAcl();
  } catch (error) {
    $("acl-feedback").textContent = error.message;
  }
});
async function loadAcl() {
  const data = await api("/api/admin/access");
  aclRevision = data.revision;
  aclUsers = data.users;
  aclGrants = data.grants;
  const selection = $("acl-user");
  selection.replaceChildren();
  for (const user of aclUsers) {
    const option = document.createElement("option");
    option.value = user.key;
    option.textContent = `${user.displayName} · ${user.source === "concept" ? "Concept" : "Agencement"} (${user.username})`;
    selection.append(option);
  }
  aclSelectedKey = aclUsers.some((user) => user.key === aclSelectedKey)
    ? aclSelectedKey : (aclUsers[0]?.key || "");
  selection.value = aclSelectedKey;
  $("acl-save").disabled = !aclSelectedKey;
  $("acl-help").textContent = aclSelectedKey
    ? "Dépliez les dossiers, cochez Lecture et/ou Dépôt, puis enregistrez."
    : "Aucun autre utilisateur connu. Un collaborateur doit d’abord se connecter une fois à PAPOT SRV.";
  setEditorRules();
}
function setEditorRules() {
  aclRules = new Map((aclGrants[aclSelectedKey] || []).map((rule) => [rule.path, { ...rule }]));
  $("acl-feedback").textContent = "";
  renderAclTree();
}
$("acl-user").addEventListener("change", () => {
  aclSelectedKey = $("acl-user").value;
  setEditorRules();
});
function effectiveAcl(path) {
  let selected = { read: false, write: false }, longest = -1;
  for (const rule of aclRules.values()) {
    if (
      (rule.path === "" || path === rule.path || path.startsWith(`${rule.path}/`)) &&
      rule.path.length > longest
    ) {
      selected = rule;
      longest = rule.path.length;
    }
  }
  return selected;
}
function refreshAclChecks() {
  for (const row of $("acl-tree").querySelectorAll("[data-acl-path]")) {
    const path = row.dataset.aclPath;
    const current = effectiveAcl(path);
    row.querySelector("[data-right=read]").checked = current.read;
    row.querySelector("[data-right=write]").checked = current.write;
    row.classList.toggle("acl-explicit", aclRules.has(path));
  }
}
function changeAcl(path, right, checked) {
  if (!aclSelectedKey) return;
  if (path === "" && checked && right === "read" &&
      !window.confirm("Autoriser tout le serveur à cet utilisateur, y compris les dossiers sensibles ?"))
    return refreshAclChecks();
  const rule = { path, ...effectiveAcl(path) };
  if (right === "read") {
    rule.read = checked;
    if (!checked) rule.write = false;
  } else {
    rule.write = checked;
    if (checked) rule.read = true;
  }
  aclRules.set(path, rule);
  refreshAclChecks();
  $("acl-feedback").textContent = "Modifications non enregistrées.";
}
function aclNode(path, label) {
  const block = document.createElement("div");
  block.className = "acl-node";
  const row = document.createElement("div");
  row.className = "acl-node-row";
  row.dataset.aclPath = path;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "acl-expand";
  toggle.textContent = "▸";
  toggle.setAttribute("aria-label", `Déplier ${label}`);
  const title = document.createElement("span");
  title.className = "acl-name";
  title.textContent = label;
  const checks = document.createElement("div");
  checks.className = "acl-checks";
  for (const right of ["read", "write"]) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.right = right;
    input.setAttribute("aria-label", `${right === "read" ? "Lecture" : "Dépôt"} : ${label}`);
    input.addEventListener("change", () => changeAcl(path, right, input.checked));
    checks.append(input);
  }
  row.append(toggle, title, checks);
  const children = document.createElement("div");
  children.className = "acl-children";
  children.hidden = true;
  let loaded = false;
  toggle.addEventListener("click", async () => {
    if (!children.hidden) {
      children.hidden = true;
      toggle.textContent = "▸";
      return;
    }
    toggle.disabled = true;
    try {
      if (!loaded) {
        const data = await api(`/api/admin/directories?${new URLSearchParams({ path })}`);
        children.replaceChildren();
        for (const item of data.entries) {
          const childPath = [path, item.name].filter(Boolean).join("/");
          children.append(aclNode(childPath, item.name));
        }
        if (data.truncated) {
          const note = document.createElement("p");
          note.textContent = "Liste limitée à 5 000 éléments. Réduisez le nombre de dossiers.";
          children.append(note);
        }
        loaded = true;
      }
      children.hidden = false;
      toggle.textContent = "▾";
      refreshAclChecks();
    } catch (error) {
      $("acl-feedback").textContent = error.message;
    } finally {
      toggle.disabled = false;
    }
  });
  block.append(row, children);
  return block;
}
function renderAclTree() {
  $("acl-tree").replaceChildren();
  if (!aclSelectedKey) return;
  $("acl-tree").append(aclNode("", "Serveur / srv"));
  refreshAclChecks();
  // Open only the first level, keeping deep trees responsive even with thousands of folders.
  $("acl-tree").querySelector(".acl-expand").click();
}
$("acl-save").addEventListener("click", async () => {
  if (!aclSelectedKey) return;
  const button = $("acl-save");
  button.disabled = true;
  try {
    const payload = {
      key: aclSelectedKey,
      revision: aclRevision,
      rules: [...aclRules.values()],
    };
    const result = await api("/api/admin/access", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    aclRevision = result.revision;
    aclGrants[aclSelectedKey] = result.rules;
    $("acl-feedback").textContent = "Autorisations enregistrées. Application immédiate.";
  } catch (error) {
    $("acl-feedback").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

window.addEventListener("hashchange", () => {
  if (!$("explorer").hidden) {
    try {
      navigate(decodeURIComponent(location.hash.slice(1)), false);
    } catch {
      navigate("");
    }
  }
});
window.addEventListener("beforeunload", (event) => {
  if (uploading) {
    event.preventDefault();
    event.returnValue = "";
  }
});
(async () => {
  try {
    const data = await api("/api/me");
    loggedIn(data);
    let path = "";
    try {
      path = decodeURIComponent(location.hash.slice(1));
    } catch {
      /* root */
    }
    await navigate(path);
  } catch (error) {
    loggedOut();
    status(error.message === "Connectez-vous avec votre compte PAPOT." ? "" : error.message, true);
  }
})();
