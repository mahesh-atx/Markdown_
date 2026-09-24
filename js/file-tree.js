// File tree rendering + active-file state.
// Depends on: data.js (fileSystem, activeFileId, activeWorkspaceId), renderer.js (renderMarkdown),
//   utils.js (escapeHtml, normalizeMarkdown for lazy-loaded folder files),
//   workspaces.js (getActiveWorkspace, renderWorkspaceSwitcher, findWorkspaceContainingFile — optional).
// Defines: renderTree, updateFileList, findFileById, setActiveFile, readNodeContent.

// Active search filter (lowercased, trimmed). Set by #file-search input.
var fileSearchQuery = '';

function __searchMatches(node, q) {
    if (!q) return true;
    if ((node.name || '').toLowerCase().indexOf(q) !== -1) return true;
    if (node.type === 'folder' && node.children) {
        for (var i = 0; i < node.children.length; i++) {
            if (__searchMatches(node.children[i], q)) return true;
        }
    }
    return false;
}

// Recursive function to render the file tree
function renderTree(nodes, parentEl, level) {
    level = level || 0;
    var q = (typeof fileSearchQuery === 'string') ? fileSearchQuery : '';
    var visible = 0;
    nodes.forEach(function(node) {
        // Search: hide subtrees with no match
        if (q && !__searchMatches(node, q)) return;
        visible += 1;
        var itemWrapper = document.createElement('div');

        var itemRow = document.createElement('div');
        // Styling mimicking the reference image's minimal rows
        itemRow.className = 'flex items-center justify-between py-1.5 px-2 rounded hover:bg-[#1a1a1a] cursor-pointer group transition-colors ' + (node.id === activeFileId ? 'bg-[#151515]' : '');

        // Left section: Chevron + Icon + Name
        var leftSection = document.createElement('div');
        leftSection.className = 'flex items-center gap-2 overflow-hidden';

        // Add left padding based on depth level to create the tree structure look
        leftSection.style.paddingLeft = (level * 2) + 'px';

        // 1. Chevron (only for folders)
        var chevron = document.createElement('div');
        chevron.className = 'w-4 flex items-center justify-center flex-shrink-0';
        if (node.type === 'folder') {
            var open = node.isOpen || !!q;
            chevron.innerHTML = '<i class="ph-fill ph-caret-right text-[10px] text-[#666] transition-transform duration-200 ' + (open ? 'rotate-90' : '') + '"></i>';
        }
        leftSection.appendChild(chevron);

        // 2. Icon & Name
        var iconAndName = document.createElement('div');
        iconAndName.className = 'flex items-center gap-2 truncate';

        var iconHtml = '';
        if (node.type === 'folder') {
            iconHtml = '<i class="ph ph-folder text-[#888] text-[15px]"></i>';
        } else {
            // Mimic the active orange checkbox/state from the reference image
            if (node.id === activeFileId) {
                iconHtml = '<i class="ph-fill ph-file-text text-[#ff6b00] text-[15px]"></i>';
            } else {
                iconHtml = '<i class="ph ph-file-text text-[#666] text-[15px]"></i>';
            }
        }

        var textColorClass = node.id === activeFileId ? 'text-[#e0e0e0] font-medium' : 'text-[#a0a0a0]';

        iconAndName.innerHTML =
            iconHtml +
            '<span class="text-[13px] truncate ' + textColorClass + '">' + escapeHtml(node.name) + '</span>';
        leftSection.appendChild(iconAndName);

        // Right section: Count (Numbers from the reference image)
        var rightSection = document.createElement('div');
        rightSection.className = 'text-[11px] text-[#555] font-mono pr-1 opacity-0 group-hover:opacity-100 transition-opacity';
        if (node.type === 'folder' || node.id === activeFileId) rightSection.classList.remove('opacity-0'); // Always show for active or folders
        rightSection.textContent = node.count !== undefined ? node.count : '';

        // Assemble row
        itemRow.appendChild(leftSection);
        itemRow.appendChild(rightSection);
        itemWrapper.appendChild(itemRow);

        // Interactions
        itemRow.addEventListener('click', function(e) {
            e.stopPropagation();
            if (node.type === 'folder') {
                node.isOpen = !node.isOpen;
                updateFileList();
            } else {
                setActiveFile(node.id);
            }
        });

        parentEl.appendChild(itemWrapper);

        // Render children if it's an open folder (search forces ancestors open)
        var forceOpen = !!(q && node.type === 'folder');
        if (node.type === 'folder' && (node.isOpen || forceOpen) && node.children && node.children.length > 0) {
            var childrenContainer = document.createElement('div');
            // Optional: Add the connecting vertical line for nested items
            childrenContainer.className = 'tree-line';
            renderTree(node.children, childrenContainer, level + 1);
            itemWrapper.appendChild(childrenContainer);
        }
    });
    return visible;
}

function updateFileList() {
    var fileListEl = document.getElementById('file-list');
    fileListEl.innerHTML = '';
    // Workspaces: only the active workspace renders (toggle via switcher)
    var roots = fileSystem;
    if (typeof getActiveWorkspace === 'function') {
        var ws = getActiveWorkspace();
        roots = ws ? [ws] : [];
    }
    if (!roots.length) {
        if (!fileSearchQuery) {
            fileListEl.innerHTML =
                '<p class="text-[12px] text-[#555] px-2 py-6 text-center">No content yet.<br/>Use Add content below.</p>';
        } else {
            fileListEl.innerHTML =
                '<p class="text-[12px] text-[#555] px-2 py-6 text-center">No files match "' +
                escapeHtml(fileSearchQuery) + '".</p>';
        }
        if (typeof renderWorkspaceSwitcher === 'function') renderWorkspaceSwitcher();
        return;
    }
    var shown = renderTree(roots, fileListEl);
    if (fileSearchQuery && !shown) {
        fileListEl.innerHTML =
            '<p class="text-[12px] text-[#555] px-2 py-6 text-center">No files match "' +
            escapeHtml(fileSearchQuery) + '".</p>';
    }
    if (typeof renderWorkspaceSwitcher === 'function') renderWorkspaceSwitcher();
}

// Sidebar search wiring — now toggled by top header icon (#sidebar-search-btn).
// The input lives in #file-search-wrap which is hidden until the icon is clicked.
(function wireFileSearch() {
    var input = document.getElementById('file-search');
    var clearBtn = document.getElementById('file-search-clear');
    var wrap = document.getElementById('file-search-wrap');
    var toggleBtn = document.getElementById('sidebar-search-btn');
    if (!input || !wrap) return;

    function syncClear() {
        if (clearBtn) clearBtn.classList.toggle('hidden', !input.value);
    }
    function setToggleActive(active) {
        if (!toggleBtn) return;
        toggleBtn.classList.toggle('bg-[#1a1a1a]', active);
        toggleBtn.classList.toggle('text-white', active);
    }
    function isWrapVisible() {
        return !wrap.classList.contains('hidden');
    }
    function showWrap() {
        wrap.classList.remove('hidden');
        setToggleActive(true);
        try { input.focus(); } catch (e) {}
    }
    function hideWrap() {
        wrap.classList.add('hidden');
        setToggleActive(false);
        input.value = '';
        fileSearchQuery = '';
        syncClear();
        updateFileList();
    }

    // Toggle button (top header search icon)
    if (toggleBtn) {
        toggleBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (isWrapVisible()) hideWrap();
            else showWrap();
        });
    }

    input.addEventListener('input', function() {
        fileSearchQuery = String(input.value || '').trim().toLowerCase();
        syncClear();
        updateFileList();
    });
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            if (input.value) {
                input.value = '';
                fileSearchQuery = '';
                syncClear();
                updateFileList();
            } else {
                hideWrap();
            }
            e.stopPropagation();
        }
    });
    if (clearBtn) clearBtn.addEventListener('click', function() {
        input.value = '';
        fileSearchQuery = '';
        syncClear();
        updateFileList();
        try { input.focus(); } catch (e) {}
    });

    // Clicking outside the search wrap while it's open should not keep it stuck,
    // but we don't auto-hide on outside click — only via toggle / Escape / clear.
})();

function findFileById(nodes, id) {
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node.id === id) return node;
        if (node.children) {
            var found = findFileById(node.children, id);
            if (found) return found;
        }
    }
    return null;
}

function readNodeContent(file) {
    // Folder-opened files lazy-load their text only when clicked
    if (file.handle) {
        return file.handle.getFile().then(function(f) { return f.text(); });
    }
    if (file.blob) {
        return file.blob.text();
    }
    if (file.url) {
        var init = file.fetchHeaders ? { headers: file.fetchHeaders } : undefined;
        return fetch(file.url, init).then(function(res) {
            if (!res.ok) throw new Error('Fetch failed: ' + res.status);
            return res.text();
        });
    }
    return Promise.resolve(file.content || '');
}

function __updateFileHeaderFor(file) {
    try {
        if (typeof updateFileHeader !== 'function') return;
        if (!file) {
            if (typeof clearFileHeader === 'function') clearFileHeader();
            return;
        }
        var wsName = '';
        if (typeof findWorkspaceContainingFile === 'function') {
            var ws = findWorkspaceContainingFile(file.id);
            if (ws) wsName = ws.name || '';
        } else if (typeof getActiveWorkspace === 'function') {
            var cur = getActiveWorkspace();
            if (cur) wsName = cur.name || '';
        }
        updateFileHeader(file, wsName);
    } catch (e) {}
}

function setActiveFile(id) {
    activeFileId = id;
    // Keep workspace in sync (cross-workspace link navigation switches toggle)
    if (typeof findWorkspaceContainingFile === 'function') {
        var owner = findWorkspaceContainingFile(id);
        if (owner) {
            activeWorkspaceId = owner.id;
            owner._activeFileId = id;
        }
    }
    var file = findFileById(fileSystem, id);
    if (file && file.type !== 'folder') {
        __updateFileHeaderFor(file);
        if (file.content) {
            renderMarkdown(file.content, file);
        } else if (file.handle || file.blob || file.url) {
            // Lazy-load folder / GitHub files on first open
            document.getElementById('markdown-content').innerHTML =
                '<p class="text-[#888] text-sm">Loading ' + escapeHtml(file.name) + '…</p>';
            readNodeContent(file).then(function(text) {
                if (activeFileId !== id) return; // user clicked elsewhere while loading
                file.content = normalizeMarkdown(text);
                renderMarkdown(file.content, file);
                // Persist newly loaded content so legacy folder snapshots survive reload
                try { if (typeof saveLocalWorkspaces === 'function') saveLocalWorkspaces(); } catch (e) {}
            }).catch(function(err) {
                console.error('Failed to read file', err);
                if (activeFileId !== id) return;
                document.getElementById('markdown-content').innerHTML =
                    '<p style="color:#f87171">Could not read this file.</p>';
                try { if (typeof showToast === 'function') showToast('Could not read "' + file.name + '".', 'error'); } catch (e2) {}
            });
        } else {
            renderMarkdown(file.content || '', file);
        }
    } else if (!file) {
        try { if (typeof clearFileHeader === 'function') clearFileHeader(); } catch (e) {}
    }
    updateFileList();

    // Close sidebar automatically on mobile after a file is selected
    if (window.innerWidth < 768 && typeof toggleSidebar === 'function') {
        var sidebar = document.getElementById('sidebar');
        if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
            toggleSidebar();
        }
    }
}
