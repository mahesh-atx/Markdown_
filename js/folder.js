// Open-folder support: shows subfolders and only .md files.
// Depends on: utils.js (normalizeMarkdown via file-tree lazy load, escapeHtml),
//   file-tree.js (fileSystem, findFileById, setActiveFile, updateFileList).
// Defines: openFolderWithPicker, clearOpenedFolder (+ helpers).
// Wires itself on load (script is included after the DOM elements).

var OPENED_FOLDER_ID = 'folder-opened';
var MAX_FOLDER_FILES = 3000;
var MAX_LOCAL_IMAGES = 500;

// relPath (e.g. "docs/a.md") -> blob: URL for local-folder images.
// renderer.js (__resolverForFile) reads this to fix relative ![img] paths.
var localImageURLMap = {};

function isMarkdownFilename(name) {
    return /\.(md|markdown)$/i.test(name || '');
}

function isImageFilename(name) {
    return /\.(png|jpe?g|gif|svg|webp|bmp|ico|avif)$/i.test(name || '');
}

function clearLocalImageCache() {
    try {
        for (var k in localImageURLMap) {
            try { URL.revokeObjectURL(localImageURLMap[k]); } catch (e) {}
        }
    } catch (e) {}
    localImageURLMap = {};
}

function registerLocalImageBlob(relPath, blob, wsId) {
    if (!relPath || !blob) return null;
    if (Object.keys(localImageURLMap).length >= MAX_LOCAL_IMAGES) return null;
    // Namespaced per workspace so two folders with the same relPath don't clash
    var key = wsId ? wsId + '::' + relPath : relPath;
    try {
        if (localImageURLMap[key]) { try { URL.revokeObjectURL(localImageURLMap[key]); } catch (e) {} }
        localImageURLMap[key] = URL.createObjectURL(blob);
        return key;
    } catch (e) { return null; }
}

function shouldSkipDir(name) {
    if (!name || name.charAt(0) === '.') return true;
    var lower = name.toLowerCase();
    return lower === 'node_modules' || lower === '__pycache__';
}

var __folderSeq = 0;
function nextFolderNodeId(prefix) {
    __folderSeq += 1;
    return prefix + '-' + Date.now() + '-' + __folderSeq;
}

function sortTreeNodes(nodes) {
    nodes.sort(function(a, b) {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        var an = (a.name || '').toLowerCase();
        var bn = (b.name || '').toLowerCase();
        if (an < bn) return -1;
        if (an > bn) return 1;
        return 0;
    });
    nodes.forEach(function(n) {
        if (n.type === 'folder' && n.children) sortTreeNodes(n.children);
    });
}

function countMarkdownFiles(node) {
    if (node.type === 'file') return 1;
    var total = 0;
    (node.children || []).forEach(function(c) { total += countMarkdownFiles(c); });
    return total;
}

function pruneEmptyFolders(nodes) {
    return nodes.filter(function(n) {
        if (n.type === 'file') return true;
        n.children = pruneEmptyFolders(n.children || []);
        return n.children.length > 0;
    });
}

function findFirstFileId(nodes) {
    for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].type === 'file') return nodes[i].id;
        if (nodes[i].children) {
            var found = findFirstFileId(nodes[i].children);
            if (found) return found;
        }
    }
    return null;
}

function setFolderStatus(msg) {
    // Footer status UI removed — no-op kept for compatibility.
    // Real errors now use showToast() directly at their call sites.
}

function __folderToast(msg, type) {
    try { if (typeof showToast === 'function' && msg) showToast(msg, type || 'error'); } catch (e) {}
}

function showClearButton(show) {
    // Footer Remove button UI removed — no-op kept for compatibility.
}

function replaceOpenedFolder(rootNode) {
    for (var i = fileSystem.length - 1; i >= 0; i--) {
        if (fileSystem[i].id === OPENED_FOLDER_ID) fileSystem.splice(i, 1);
    }
    if (rootNode) {
        rootNode.id = OPENED_FOLDER_ID;
        fileSystem.push(rootNode);
    }
}

function finishOpenedFolder(tree, rootName, state) {
    tree.children = pruneEmptyFolders(tree.children || []);
    sortTreeNodes(tree.children);
    if (tree.children.length === 0) {
        __folderToast('No .md files found in "' + rootName + '".');
        return null;
    }
    tree.name = rootName;
    tree.isOpen = true;
    tree.count = countMarkdownFiles(tree);
    tree._imageKeys = tree._imageKeys || [];
    // Workspaces: each opened folder becomes its own toggleable workspace.
    // No success status message — the workspace entry + file count shows it.
    if (typeof addWorkspace === 'function') {
        var ws = addWorkspace(tree, { kind: 'folder', status: '' });
        if (!ws) return null; // limit hit — addWorkspace already showed status
        // Materialize sync blob images collected by the FileList path (namespaced per workspace)
        var pend = tree._pendingImages || [];
        for (var i = 0; i < pend.length; i++) {
            var key = registerLocalImageBlob(pend[i].relPath, pend[i].blob, ws.id);
            if (key) ws._imageKeys.push(key);
        }
        delete tree._pendingImages;
        if (pend.length) {
            // Re-render: first-file render inside addWorkspace ran before blob: URLs existed
            try {
                var cur = findFileById(fileSystem, activeFileId);
                if (cur && cur.content && cur._wsId === ws.id) renderMarkdown(cur.content, cur);
            } catch (e) {}
        }
        return ws;
    }
    // Legacy fallback (no workspaces.js): single replaceable folder
    replaceOpenedFolder(tree);
    updateFileList();
    var firstId = findFirstFileId(tree.children);
    if (firstId) setActiveFile(firstId);
    setFolderStatus('');
    showClearButton(true);
    return null;
}

// --- File System Access API path (Chromium/Edge/Safari 15.2+) ---
function buildTreeFromDirectoryHandle(dirHandle, state, basePath) {
    basePath = basePath || '';
    state.imageEntries = state.imageEntries || [];
    var folderNode = {
        id: nextFolderNodeId('folder'),
        type: 'folder',
        name: dirHandle.name,
        isOpen: true,
        children: []
    };
    // dirHandle.values() returns an async iterator of entries
    var iterator = dirHandle.values();
    function loop() {
        return iterator.next().then(function(res) {
            if (res.done) {
                sortTreeNodes(folderNode.children);
                return folderNode;
            }
            var entry = res.value;
            if (state.count >= MAX_FOLDER_FILES) {
                state.truncated = true;
                sortTreeNodes(folderNode.children);
                return folderNode;
            }
            if (entry.kind === 'file') {
                var relPath = basePath ? basePath + '/' + entry.name : entry.name;
                if (isMarkdownFilename(entry.name)) {
                    state.count += 1;
                    folderNode.children.push({
                        id: nextFolderNodeId('file'),
                        type: 'file',
                        name: entry.name,
                        relPath: relPath,
                        handle: entry, // FileSystemFileHandle — content lazy-loaded on click
                        content: null
                    });
                } else if (isImageFilename(entry.name) && state.imageEntries.length < MAX_LOCAL_IMAGES) {
                    state.imageEntries.push({ relPath: relPath, handle: entry });
                }
                return loop();
            }
            if (entry.kind === 'directory') {
                if (shouldSkipDir(entry.name)) return loop();
                var subBase = basePath ? basePath + '/' + entry.name : entry.name;
                return buildTreeFromDirectoryHandle(entry, state, subBase).then(function(sub) {
                    if (sub.children.length > 0) folderNode.children.push(sub);
                    return loop();
                });
            }
            return loop();
        });
    }
    return loop();
}

function openFolderWithPicker() {
    if (!window.showDirectoryPicker) {
        // Legacy browsers (e.g. Firefox): use the webkitdirectory fallback input
        document.getElementById('folder-upload').click();
        return;
    }
    window.showDirectoryPicker().then(function(dirHandle) {
        var state = { count: 0, truncated: false, imageEntries: [] };
        return buildTreeFromDirectoryHandle(dirHandle, state).then(function(tree) {
            // Stash async handles; finishOpenedFolder creates the workspace first
            // (assigns its id + selects first file), then we materialize blob: URLs.
            tree._pendingHandles = state.imageEntries || [];
            tree._dirHandle = dirHandle;
            var ws = finishOpenedFolder(tree, dirHandle.name, state);
            if (ws) {
                ws._dirHandle = dirHandle; // persisted to IndexedDB for reload restore
                if (typeof saveLocalWorkspaces === 'function') saveLocalWorkspaces();
                return __materializePendingHandles(ws);
            }
        });
    }).catch(function(err) {
        if (err && err.name === 'AbortError') return; // user cancelled — stay silent
        console.error('Open folder failed', err);
        __folderToast('Could not open folder. Try again or use Upload.');
    });
}

// Materialize blob: URLs for a workspace's pending image handles (File System
// Access path), then re-render the active file if it belongs to this workspace.
function __materializePendingHandles(ws) {
    var entries = ws._pendingHandles || [];
    delete ws._pendingHandles;
    if (!entries.length) return Promise.resolve();
    var chain = Promise.resolve();
    entries.forEach(function(e) {
        chain = chain.then(function() {
            return e.handle.getFile().then(function(f) {
                var key = registerLocalImageBlob(e.relPath, f, ws.id);
                if (key) ws._imageKeys.push(key);
            }).catch(function() {});
        });
    });
    return chain.then(function() {
        try {
            var cur = findFileById(fileSystem, activeFileId);
            if (cur && cur.content && cur._wsId === ws.id) renderMarkdown(cur.content, cur);
        } catch (e) {}
    });
}

// Rebuild a folder workspace from a persisted directory handle (reload restore).
function rebuildFolderWorkspace(name, dirHandle) {
    var state = { count: 0, truncated: false, imageEntries: [] };
    return buildTreeFromDirectoryHandle(dirHandle, state).then(function(tree) {
        tree._pendingHandles = state.imageEntries || [];
        tree._dirHandle = dirHandle;
        var ws = finishOpenedFolder(tree, name, state);
        if (ws) {
            ws._dirHandle = dirHandle;
            return __materializePendingHandles(ws).then(function() { return ws; });
        }
        return null;
    });
}

// Placeholder when the browser withheld folder permission after reload.
// Content can't be read until the user reconnects (button = user gesture).
function addDisconnectedFolderWorkspace(name, dirHandle) {
    var root = {
        type: 'folder',
        name: name,
        isOpen: true,
        count: 0,
        children: [],
        _disconnected: true,
        _dirHandle: dirHandle || null,
        _imageKeys: []
    };
    if (typeof addWorkspace === 'function') {
        return addWorkspace(root, { kind: 'folder', status: 'Folder "' + name + '" needs reconnect after reload.' });
    }
    return null;
}

function showReconnectPrompt(ws) {
    var el = document.getElementById('markdown-content');
    if (!el) return;
    el.innerHTML =
        '<div class="text-center py-16">' +
            '<div class="text-5xl mb-4 text-[#333]"><i class="ph ph-folder-open"></i></div>' +
            '<h1 class="text-xl font-semibold text-white mb-2">' + escapeHtml(ws.name || 'Folder') + '</h1>' +
            '<p class="text-sm text-[#888] mb-5">Browser permission was reset by the reload.<br/>Reconnect to read this folder again.</p>' +
            '<button id="reconnect-btn" class="px-4 py-2 text-sm font-medium rounded-md bg-white text-black hover:bg-gray-200 transition-colors">Reconnect folder</button>' +
        '</div>';
    var btn = document.getElementById('reconnect-btn');
    if (btn) btn.addEventListener('click', function() { reconnectWorkspace(ws.id); });
}

function reconnectWorkspace(wsId) {
    var ws = null;
    for (var i = 0; i < fileSystem.length; i++) {
        if (fileSystem[i].id === wsId) { ws = fileSystem[i]; break; }
    }
    if (!ws) return;
    if (!window.showDirectoryPicker) {
        __folderToast('Reconnect needs a Chromium/Edge browser. Use Open Folder instead.');
        return;
    }
    window.showDirectoryPicker().then(function(dirHandle) {
        var state = { count: 0, truncated: false, imageEntries: [] };
        return buildTreeFromDirectoryHandle(dirHandle, state).then(function(tree) {
            tree.children = pruneEmptyFolders(tree.children || []);
            sortTreeNodes(tree.children);
            if (!tree.children.length) {
                __folderToast('No .md files found in "' + dirHandle.name + '".');
                return;
            }
            ws.children = tree.children;
            ws.name = dirHandle.name;
            ws.count = countMarkdownFiles(ws);
            ws.isOpen = true;
            ws._disconnected = false;
            ws._dirHandle = dirHandle;
            ws._pendingHandles = state.imageEntries || [];
            if (typeof __wsTagSubtree === 'function') __wsTagSubtree(ws);
            else { (function tag(n) { n._wsId = ws.id; (n.children || []).forEach(tag); })(ws); }
            if (typeof saveLocalWorkspaces === 'function') saveLocalWorkspaces();
            ws._status = '';
            setActiveWorkspace(ws.id);
            return __materializePendingHandles(ws);
        });
    }).catch(function(err) {
        if (err && err.name === 'AbortError') return;
        console.error('Reconnect failed', err);
        __folderToast('Could not reconnect folder.');
    });
}

// --- Legacy fallback path: <input webkitdirectory> FileList ---
function buildTreeFromFileList(fileList, fallbackRootName) {
    var root = {
        id: nextFolderNodeId('folder'),
        type: 'folder',
        name: fallbackRootName || 'Opened Folder',
        isOpen: true,
        children: []
    };
    var dirMap = { '': root };
    var rootNameSet = !!fallbackRootName;
    var state = { count: 0, truncated: false };
    // First pass: collect sibling images (relPath relative to picked root).
    // URLs are materialized in finishOpenedFolder AFTER the workspace id exists
    // (namespaced per workspace). Never clear the global cache here — other
    // workspaces keep their own blob: URLs.
    var pendingImages = [];
    for (var j = 0; j < fileList.length; j++) {
        if (pendingImages.length >= MAX_LOCAL_IMAGES) break;
        var img = fileList[j];
        if (!isImageFilename(img.name)) continue;
        var imgRel = img.webkitRelativePath || img.name;
        var imgParts = imgRel.split('/');
        var imgRelPath = imgParts.length > 1 ? imgParts.slice(1).join('/') : imgParts[0];
        pendingImages.push({ relPath: imgRelPath, blob: img });
    }
    root._pendingImages = pendingImages;
    for (var i = 0; i < fileList.length; i++) {
        var f = fileList[i];
        if (!isMarkdownFilename(f.name)) continue; // only .md files in tree
        var rel = f.webkitRelativePath || f.name;
        var parts = rel.split('/');
        if (!rootNameSet && parts.length > 1) {
            root.name = parts[0];
            rootNameSet = true;
        }
        // Skip hidden / dependency dirs anywhere in the path
        var skip = false;
        for (var s = 0; s < parts.length - 1; s++) {
            var seg = (parts.length > 1 && s === 0) ? null : parts[s]; // parts[0] is the picked root itself
            if (seg !== null && shouldSkipDir(seg)) { skip = true; break; }
        }
        if (skip) continue;
        if (state.count >= MAX_FOLDER_FILES) { state.truncated = true; break; }
        // Walk/create intermediate dirs (skip index 0 = picked root)
        var parent = root;
        var pathKey = '';
        var start = parts.length > 1 ? 1 : 0;
        for (var d = start; d < parts.length - 1; d++) {
            pathKey += '/' + parts[d];
            if (!dirMap[pathKey]) {
                dirMap[pathKey] = {
                    id: nextFolderNodeId('folder'),
                    type: 'folder',
                    name: parts[d],
                    isOpen: true,
                    children: []
                };
                parent.children.push(dirMap[pathKey]);
            }
            parent = dirMap[pathKey];
        }
        state.count += 1;
        var relPath = parts.length > 1 ? parts.slice(1).join('/') : parts[0];
        parent.children.push({
            id: nextFolderNodeId('file'),
            type: 'file',
            name: parts[parts.length - 1],
            relPath: relPath,
            blob: f, // File object — content lazy-loaded on click
            content: null
        });
    }
    sortTreeNodes(root.children);
    return { tree: root, state: state };
}

function clearOpenedFolder() {
    // Workspaces: footer Remove drops the active workspace only
    if (typeof removeActiveWorkspace === 'function' && typeof fileSystem !== 'undefined' && fileSystem.length) {
        removeActiveWorkspace();
        return;
    }
    replaceOpenedFolder(null);
    clearLocalImageCache();
    updateFileList();
    setFolderStatus('');
    showClearButton(false);
}

document.getElementById('open-folder-btn').addEventListener('click', openFolderWithPicker);

document.getElementById('folder-upload').addEventListener('change', function() {
    var files = this.files;
    if (!files || files.length === 0) return;
    var res = buildTreeFromFileList(files, null);
    var ws = finishOpenedFolder(res.tree, res.tree.name, res.state);
    if (ws && typeof saveLocalWorkspaces === 'function') saveLocalWorkspaces();
    // Also persist even if addWorkspace hit limit and returned null — still save what we have
    if (!ws && typeof saveLocalWorkspaces === 'function') { try { saveLocalWorkspaces(); } catch (e) {} }
    this.value = '';
});

// Footer Remove button was removed from the UI — workspaces are removed
// via the × button on each workspace row instead.
