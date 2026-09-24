// App entry point. Runs last — all other modules must be loaded first.
// Depends on: file-tree.js (setActiveFile, updateFileList, activeFileId),
//   workspaces.js (restoreGithubWorkspaces — optional), ui.js (toggleSidebar).

function showWelcomeState() {
    activeFileId = null;
    try { if (typeof clearFileHeader === 'function') clearFileHeader(); } catch (e) {}
    updateFileList();
    var el = document.getElementById('markdown-content');
    if (el) {
        el.innerHTML =
            '<div class="text-center py-16">' +
                '<div class="text-5xl mb-4 text-[#333]"><i class="ph ph-book-open-text"></i></div>' +
                '<h1 class="text-xl font-semibold text-white mb-2">No file open</h1>' +
                '<p class="text-sm text-[#888]">Open a folder, upload a .md file, or load a GitHub repo to start reading.</p>' +
            '</div>';
    }
}

// Initialize: restore persisted workspaces (uploads + folders from IndexedDB,
// GitHub repos via API), else welcome until the user opens something.
if (activeFileId) {
    setActiveFile(activeFileId);
} else {
    var bootLocal = (typeof restoreLocalWorkspaces === 'function') ? restoreLocalWorkspaces() : Promise.resolve();
    bootLocal.then(function() {
        if (typeof restoreGithubWorkspaces === 'function') return restoreGithubWorkspaces();
    }).then(function() {
        if (!fileSystem.length) showWelcomeState();
        else updateFileList();
        // Boot transients (e.g. "Restoring N repo(s)…") must never linger.
        if (typeof setFolderStatus === 'function') setFolderStatus('');
    }).catch(function() {
        if (!fileSystem.length) showWelcomeState();
        else updateFileList();
        if (typeof setFolderStatus === 'function') setFolderStatus('');
    });
}

// Mobile Sidebar Toggle Logic
var mobileMenuBtn = document.getElementById('mobile-menu-btn');
var closeSidebarBtn = document.getElementById('close-sidebar-btn');
var sidebarSearchBtn = document.getElementById('sidebar-search-btn');
var sidebarOverlay = document.getElementById('sidebar-overlay');

if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', toggleSidebar);
if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', toggleSidebar);
if (sidebarSearchBtn) {
    sidebarSearchBtn.addEventListener('click', function() {
        var input = document.getElementById('file-search');
        if (!input) return;
        input.focus();
        input.select();
    });
}
if (sidebarOverlay) sidebarOverlay.addEventListener('click', toggleSidebar);
