// Copy/Run buttons + sidebar toggle + Add-content menu + toasts + file header.
// Depends on: nothing at load time (functions called after DOM ready).
// Defines: attachInteractions, toggleSidebar, toggleAddMenu, closeAddMenu,
//   showToast, updateFileHeader, clearFileHeader.

var __toastTimer = [];

function showToast(msg, type) {
  if (!msg) return;
  var wrap = document.getElementById("toast-wrap");
  // Fallback if container missing (e.g. cached HTML)
  if (!wrap) {
    try {
      console.warn("[toast]", msg);
    } catch (e) {}
    return;
  }
  type = type === "error" || type === "success" ? type : "info";
  // Cap stacking at 3 — drop the oldest
  while (wrap.children.length >= 3) {
    try {
      wrap.removeChild(wrap.firstChild);
    } catch (e) {
      break;
    }
  }
  var el = document.createElement("div");
  el.className = "toast toast-" + type;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  var icon =
    type === "error"
      ? "ph-warning-circle"
      : type === "success"
        ? "ph-check-circle"
        : "ph-info";
  el.innerHTML = '<i class="ph ' + icon + '"></i><span></span>';
  el.querySelector("span").textContent = String(msg);
  var done = false;
  function dismiss() {
    if (done) return;
    done = true;
    el.classList.remove("toast-in");
    el.classList.add("toast-out");
    setTimeout(function () {
      try {
        el.remove();
      } catch (e) {}
    }, 200);
  }
  el.addEventListener("click", dismiss);
  wrap.appendChild(el);
  // Trigger transition
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      el.classList.add("toast-in");
    });
  });
  __toastTimer.push(setTimeout(dismiss, type === "error" ? 5000 : 3500));
}

function isAddMenuOpen() {
  var menu = document.getElementById("add-menu");
  return !!(menu && !menu.classList.contains("hidden"));
}

function toggleAddMenu(force) {
  var menu = document.getElementById("add-menu");
  var btn = document.getElementById("add-menu-btn");
  if (!menu || !btn) return;
  var show =
    typeof force === "boolean" ? force : menu.classList.contains("hidden");
  menu.classList.toggle("hidden", !show);
  btn.setAttribute("aria-expanded", show ? "true" : "false");
}

function closeAddMenu() {
  toggleAddMenu(false);
}

// Add-menu wiring (elements exist because scripts load after the DOM)
(function wireAddMenu() {
  var wrap = document.getElementById("add-menu-wrap");
  var btn = document.getElementById("add-menu-btn");
  var menu = document.getElementById("add-menu");
  if (!wrap || !btn || !menu) return;
  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    toggleAddMenu();
  });
  menu.addEventListener("click", function (e) {
    e.stopPropagation();
  });
  // Close after picking an option (the option's own handler still runs)
  var folderBtn = document.getElementById("open-folder-btn");
  var ghBtn = document.getElementById("open-github-btn");
  var uploadBtn = document.getElementById("open-upload-btn");
  var uploadLabel = menu.querySelector('label[for="file-upload"]');
  if (folderBtn) folderBtn.addEventListener("click", closeAddMenu);
  if (ghBtn) ghBtn.addEventListener("click", closeAddMenu);
  if (uploadBtn) uploadBtn.addEventListener("click", closeAddMenu);
  if (uploadLabel) uploadLabel.addEventListener("click", closeAddMenu);
  document.addEventListener("click", function (e) {
    if (isAddMenuOpen() && !wrap.contains(e.target)) closeAddMenu();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isAddMenuOpen()) closeAddMenu();
  });
})();

function attachInteractions() {
  // Attach Copy Button Functionality
  document.querySelectorAll(".copy-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var codeContainer =
        this.closest(".md-code-block") || this.closest("div.my-6");
      var codeElement = codeContainer
        ? codeContainer.querySelector("code")
        : null;
      if (!codeElement) return;
      var textToCopy = codeElement.innerText;

      var textArea = document.createElement("textarea");
      textArea.value = textToCopy;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand("copy");
        var icon = this.querySelector("i");
        icon.classList.remove("ph-copy");
        icon.classList.add("ph-check", "text-green-400");

        setTimeout(function () {
          icon.classList.remove("ph-check", "text-green-400");
          icon.classList.add("ph-copy");
        }, 2000);
      } catch (err) {
        console.error("Failed to copy", err);
      }
      document.body.removeChild(textArea);
    });
  });

  // Attach mock Run button functionality
  document.querySelectorAll(".run-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var originalText = this.innerHTML;
      this.innerHTML =
        '<i class="ph ph-spinner-gap animate-spin text-[10px]"></i> Running';
      this.classList.add("opacity-75", "cursor-not-allowed");

      setTimeout(
        function () {
          this.innerHTML = originalText;
          this.classList.remove("opacity-75", "cursor-not-allowed");
        }.bind(this),
        800,
      );
    });
  });
}

function toggleSidebar() {
  var sidebar = document.getElementById("sidebar");
  var sidebarOverlay = document.getElementById("sidebar-overlay");
  var isOpen = !sidebar.classList.contains("-translate-x-full");
  if (isOpen) {
    // Close sidebar
    sidebar.classList.add("-translate-x-full");
    sidebarOverlay.classList.remove("opacity-100");
    sidebarOverlay.classList.add("opacity-0");
    setTimeout(function () {
      sidebarOverlay.classList.add("hidden");
    }, 300);
  } else {
    // Open sidebar
    sidebarOverlay.classList.remove("hidden");
    // Trigger reflow to ensure CSS transition runs
    void sidebarOverlay.offsetWidth;
    sidebarOverlay.classList.remove("opacity-0");
    sidebarOverlay.classList.add("opacity-100");
    sidebar.classList.remove("-translate-x-full");
  }
}

// Current-file header: workspace + path breadcrumb above the preview.
// file: active file node (relPath / repoPath / name). wsName: workspace label.
function updateFileHeader(file, wsName) {
  var bar = document.getElementById("file-header");
  if (!bar) return;
  if (!file) {
    bar.classList.add("hidden");
    return;
  }
  var path =
    file.repoPath !== undefined
      ? file.repoPath
      : file.relPath !== undefined
        ? file.relPath
        : null;
  var nameEl = document.getElementById("file-header-name");
  var pathEl = document.getElementById("file-header-path");
  var slash2 = document.getElementById("file-header-slash2");
  var wsEl = document.getElementById("file-header-ws");
  if (wsEl) wsEl.textContent = wsName || "";
  if (!path || path === file.name) {
    if (nameEl) nameEl.textContent = file.name || "Untitled";
    if (pathEl) {
      pathEl.textContent = "";
      pathEl.classList.add("hidden");
    }
    if (slash2) slash2.classList.add("hidden");
  } else {
    var parts = String(path).split("/");
    var fname = parts.pop();
    if (nameEl) nameEl.textContent = fname || file.name;
    if (pathEl) {
      var dir = parts.join("/");
      pathEl.textContent = dir;
      var hasDir = !!dir;
      pathEl.classList.toggle("hidden", !hasDir);
      if (slash2) slash2.classList.toggle("hidden", !hasDir);
    }
  }
  bar.classList.remove("hidden");
}

function clearFileHeader() {
  var bar = document.getElementById("file-header");
  if (bar) bar.classList.add("hidden");
}
