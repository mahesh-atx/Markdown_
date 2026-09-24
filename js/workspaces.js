// Workspaces: each loaded folder / GitHub repo / upload set is a separate
// workspace (one top-level entry in fileSystem). Only the active workspace
// renders in #file-list — toggle via #workspace-list. Loading a new repo
// adds a workspace instead of replacing the current one.
// Depends on: data.js (fileSystem, activeFileId, activeWorkspaceId),
//   file-tree.js (updateFileList, setActiveFile, findFileById),
//   utils.js (escapeHtml).
// Defines: MAX_WORKSPACES, getActiveWorkspace, setActiveWorkspace, addWorkspace,
//   removeWorkspace, removeActiveWorkspace, renderWorkspaceSwitcher,
//   findWorkspaceContainingFile, findWorkspaceByGithub, findUploadsWorkspace,
//   getPersistedGithub, persistGithubWorkspaces.

var MAX_WORKSPACES = 10;
var LS_GITHUB_KEY = 'md-workspaces-github-v1';

var __wsSeq = 0;
function __wsNextId() {
    __wsSeq += 1;
    return 'ws-' + Date.now() + '-' + __wsSeq;
}

function __wsFirstFileId(nodes) {
    if (typeof findFirstFileId === 'function') return findFirstFileId(nodes);
    for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].type === 'file') return nodes[i].id;
        if (nodes[i].children) { var f = __wsFirstFileId(nodes[i].children); if (f) return f; }
    }
    return null;
}

function getActiveWorkspace() {
    if (activeWorkspaceId) {
        for (var i = 0; i < fileSystem.length; i++) {
            if (fileSystem[i].id === activeWorkspaceId) return fileSystem[i];
        }
    }
    if (fileSystem.length) {
        activeWorkspaceId = fileSystem[0].id;
        return fileSystem[0];
    }
    return null;
}

function findWorkspaceContainingFile(fileId) {
    for (var i = 0; i < fileSystem.length; i++) {
        var root = fileSystem[i];
        var found = null;
        if (typeof findFileById === 'function') found = findFileById([root], fileId);
        if (found) return root;
    }
    return null;
}

function findWorkspaceByGithub(owner, repo, branch) {
    var o = String(owner || '').toLowerCase(), r = String(repo || '').toLowerCase();
    for (var i = 0; i < fileSystem.length; i++) {
        var g = fileSystem[i]._github;
        if (g && String(g.owner || '').toLowerCase() === o && String(g.repo || '').toLowerCase() === r &&
            (!branch || String(g.branch || '').toLowerCase() === String(branch).toLowerCase())) {
            return fileSystem[i];
        }
    }
    return null;
}

function findUploadsWorkspace() {
    for (var i = 0; i < fileSystem.length; i++) {
        if (fileSystem[i]._kind === 'uploads') return fileSystem[i];
    }
    return null;
}

// Tag every descendant with the workspace id (used for namespaced image URLs).
function __wsTagSubtree(root) {
    (function walk(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            nodes[i]._wsId = root.id;
            if (nodes[i].children) walk(nodes[i].children);
        }
    })([root]);
}

function addWorkspace(rootNode, opts) {
    opts = opts || {};
    // GitHub duplicate: switch instead of adding twice
    if (opts.kind === 'github' && opts.github) {
        var dup = findWorkspaceByGithub(opts.github.owner, opts.github.repo, opts.github.branch);
        if (dup) {
            setActiveWorkspace(dup.id);
            try { if (typeof showToast === 'function') showToast('Already loaded — switched to "' + dup.name + '".', 'info'); } catch (e) {}
            return dup;
        }
    }
    if (fileSystem.length >= MAX_WORKSPACES) {
        try { if (typeof showToast === 'function') showToast('Workspace limit (' + MAX_WORKSPACES + ') reached. Remove one first.', 'error'); } catch (e) {}
        return null;
    }
    if (!rootNode.id) rootNode.id = __wsNextId();
    // De-collide legacy fixed ids (folder-opened / folder-github / folder-uploads)
    for (var i = 0; i < fileSystem.length; i++) {
        if (fileSystem[i].id === rootNode.id) { rootNode.id = __wsNextId(); break; }
    }
    rootNode._kind = opts.kind || 'folder';
    rootNode._status = opts.status || '';
    if (opts.github) rootNode._github = opts.github;
    rootNode._activeFileId = null;
    rootNode._imageKeys = rootNode._imageKeys || [];
    fileSystem.push(rootNode);
    __wsTagSubtree(rootNode);
    activeWorkspaceId = rootNode.id;
    persistGithubWorkspaces();
    updateFileList();
    var firstId = __wsFirstFileId([rootNode]);
    if (firstId) {
        rootNode._activeFileId = firstId;
        setActiveFile(firstId);
    } else {
        activeFileId = null;
    }
    return rootNode;
}

function setActiveWorkspace(id) {
    var ws = null;
    for (var i = 0; i < fileSystem.length; i++) {
        if (fileSystem[i].id === id) { ws = fileSystem[i]; break; }
    }
    if (!ws) return;
    activeWorkspaceId = ws.id;
    updateFileList();
    var target = (ws._activeFileId && typeof findFileById === 'function' && findFileById([ws], ws._activeFileId))
        ? ws._activeFileId : __wsFirstFileId([ws]);
    if (target) {
        ws._activeFileId = target;
        setActiveFile(target);
    } else {
        activeFileId = null;
        try { if (typeof clearFileHeader === 'function') clearFileHeader(); } catch (e) {}
        if (ws._disconnected && typeof showReconnectPrompt === 'function') showReconnectPrompt(ws);
        else if (typeof showWelcomeState === 'function') showWelcomeState();
    }
}

function removeWorkspace(id) {
    var idx = -1;
    for (var i = 0; i < fileSystem.length; i++) {
        if (fileSystem[i].id === id) { idx = i; break; }
    }
    if (idx === -1) return;
    var root = fileSystem[idx];
    // Revoke this workspace's blob: URLs (namespaced keys — no cross-workspace clash)
    try {
        if (typeof localImageURLMap !== 'undefined' && root._imageKeys) {
            for (var k = 0; k < root._imageKeys.length; k++) {
                var key = root._imageKeys[k];
                if (localImageURLMap[key]) {
                    try { URL.revokeObjectURL(localImageURLMap[key]); } catch (e) {}
                    delete localImageURLMap[key];
                }
            }
        }
    } catch (e) {}
    fileSystem.splice(idx, 1);
    persistGithubWorkspaces();
    if (typeof saveLocalWorkspaces === 'function') saveLocalWorkspaces();
    if (fileSystem.length === 0) {
        activeWorkspaceId = null;
        activeFileId = null;
        try { if (typeof clearFileHeader === 'function') clearFileHeader(); } catch (e) {}
        updateFileList();
        if (typeof showWelcomeState === 'function') showWelcomeState();
    } else {
        if (activeWorkspaceId === id) setActiveWorkspace(fileSystem[Math.max(0, idx - 1)].id);
        else updateFileList();
    }
}

function removeActiveWorkspace() {
    var ws = getActiveWorkspace();
    if (!ws) return;
    removeWorkspace(ws.id);
}

function renderWorkspaceSwitcher() {
    var el = document.getElementById('workspace-list');
    if (!el) return;
    if (!fileSystem.length) { el.innerHTML = ''; el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = '';
    var label = document.createElement('div');
    label.className = 'text-[10px] uppercase tracking-wider text-[#555] px-2 pb-1';
    label.textContent = fileSystem.length > 1 ? 'Workspaces (' + fileSystem.length + ')' : 'Workspace';
    el.appendChild(label);
    fileSystem.forEach(function(ws) {
        var isActive = ws.id === activeWorkspaceId;
        var row = document.createElement('div');
        row.className = 'flex items-center gap-1 px-1 py-0.5 rounded cursor-pointer transition-colors ' +
            (isActive ? 'bg-[#1a1a1a]' : 'hover:bg-[#141414]');
        var icon = 'ph-folder';
        if (ws._kind === 'github') icon = 'ph-github-logo';
        else if (ws._kind === 'uploads') icon = 'ph-upload-simple';
        var btn = document.createElement('div');
        btn.className = 'flex items-center gap-2 flex-1 min-w-0 px-1.5 py-1';
        btn.title = ws.name || '';
        btn.innerHTML = '<i class="ph ' + icon + ' text-[14px] flex-shrink-0 ' +
            (isActive ? 'text-white' : 'text-[#777]') + '"></i>' +
            '<span class="text-[12px] truncate ' + (isActive ? 'text-white font-medium' : 'text-[#999]') + '">' +
            escapeHtml(ws.name || 'Untitled') + '</span>' +
            (ws._disconnected ? '<span class="text-[9px] uppercase tracking-wider text-[#f0a35e] border border-[#5a3a1a] rounded px-1 ml-1 flex-shrink-0">reconnect</span>' : '') +
            (ws.count !== undefined ? '<span class="text-[10px] text-[#555] font-mono ml-auto flex-shrink-0">' + ws.count + '</span>' : '');
        btn.addEventListener('click', function() { setActiveWorkspace(ws.id); });
        row.appendChild(btn);
        var x = document.createElement('button');
        x.className = 'text-[#555] hover:text-white p-1 rounded hover:bg-[#2a2a2a] transition-colors flex-shrink-0';
        x.title = 'Remove "' + (ws.name || '') + '"';
        x.innerHTML = '<i class="ph ph-x text-[12px]"></i>';
        x.addEventListener('click', function(e) { e.stopPropagation(); removeWorkspace(ws.id); });
        row.appendChild(x);
        el.appendChild(row);
    });
}

// --- Persistence: GitHub repo list only (never tokens; folders can't persist) ---
function getPersistedGithub() {
    try {
        var raw = localStorage.getItem(LS_GITHUB_KEY);
        if (!raw) return [];
        var arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
}

function persistGithubWorkspaces() {
    try {
        var list = [];
        for (var i = 0; i < fileSystem.length; i++) {
            if (fileSystem[i]._kind === 'github' && fileSystem[i]._github) {
                list.push({
                    owner: fileSystem[i]._github.owner,
                    repo: fileSystem[i]._github.repo,
                    branch: fileSystem[i]._github.branch
                });
            }
        }
        localStorage.setItem(LS_GITHUB_KEY, JSON.stringify(list));
    } catch (e) { /* file:// / private mode — non-fatal */ }
}

// --- IndexedDB persistence: folder handles + uploads + github mirror.
// localStorage alone can't keep folders/uploads across reload, so the full
// workspace set lives here. Everything degrades gracefully when IDB is missing.
var IDB_NAME = 'md-reader-db';
var IDB_STORE = 'kv';
var IDB_WS_KEY = 'ws-v1';

function __idbOpen() {
    return new Promise(function(resolve, reject) {
        try {
            if (typeof indexedDB === 'undefined') { reject(new Error('no-indexeddb')); return; }
            var req = indexedDB.open(IDB_NAME, 1);
            req.onupgradeneeded = function() {
                try { req.result.createObjectStore(IDB_STORE); } catch (e) {}
            };
            req.onsuccess = function() { resolve(req.result); };
            req.onerror = function() { reject(req.error || new Error('idb-open')); };
        } catch (e) { reject(e); }
    });
}

function __idbGet(key) {
    return __idbOpen().then(function(db) {
        return new Promise(function(res, rej) {
            try {
                var tx = db.transaction(IDB_STORE, 'readonly');
                var rq = tx.objectStore(IDB_STORE).get(key);
                rq.onsuccess = function() { res(rq.result); };
                rq.onerror = function() { rej(rq.error || new Error('idb-get')); };
            } catch (e) { rej(e); }
        });
    });
}

function __idbSet(key, val) {
    return __idbOpen().then(function(db) {
        return new Promise(function(res, rej) {
            try {
                var tx = db.transaction(IDB_STORE, 'readwrite');
                var rq = tx.objectStore(IDB_STORE).put(val, key);
                rq.onsuccess = function() { res(); };
                rq.onerror = function() { rej(rq.error || new Error('idb-put')); };
            } catch (e) { rej(e); }
        });
    });
}

// Snapshot everything restorable: folder handles, legacy folder snapshots, upload contents, github list.
function saveLocalWorkspaces() {
    try {
        var folders = [], uploads = [], github = [], localFolders = [];
        for (var i = 0; i < fileSystem.length; i++) {
            var r = fileSystem[i];
            if (r._kind === 'folder' && r._dirHandle && !r._disconnected) {
                folders.push({ wsId: r.id, name: r.name, handle: r._dirHandle });
            } else if (r._kind === 'folder' && !r._dirHandle && r.children) {
                // Legacy fallback (webkitdirectory / blob-based) — IDB can store File/Blob via structured clone,
                // so we snapshot the whole tree as files with relPath + blob/content.
                var files = [];
                var totalLocal = 0;
                (function walk(nodes) {
                    for (var j = 0; j < nodes.length; j++) {
                        var n = nodes[j];
                        if (n.type === 'file') {
                            var c = n.content || '';
                            // cap per-folder ~2MB like uploads, but keep blob if content not yet loaded
                            totalLocal += String(c).length;
                            if (totalLocal > 2500000) continue;
                            files.push({ relPath: n.relPath || n.name, name: n.name, content: c || null, blob: n.blob || null });
                        }
                        if (n.children) walk(n.children);
                    }
                })(r.children || []);
                if (files.length) localFolders.push({ name: r.name, files: files, count: r.count || files.length });
            } else if (r._kind === 'uploads') {
                for (var c2 = 0; c2 < (r.children || []).length; c2++) {
                    var f2 = r.children[c2];
                    if (f2.type === 'file') uploads.push({ name: f2.name, content: f2.content || '' });
                }
            } else if (r._kind === 'github' && r._github) {
                github.push({ owner: r._github.owner, repo: r._github.repo, branch: r._github.branch });
            }
        }
        // Cap upload snapshot (~2MB) so one giant paste can't break the save
        var total = 0;
        uploads = uploads.filter(function(u) {
            total += String(u.content || '').length;
            return total < 2000000;
        });
        var payload = { folders: folders, uploads: uploads, github: github, localFolders: localFolders };
        // Also mirror uploads + localFolders (content only) to localStorage for file:// where IDB may be opaque
        try {
            var lsBackup = {
                uploads: uploads,
                localFolders: localFolders.map(function(lf) {
                    return {
                        name: lf.name,
                        count: lf.count,
                        files: lf.files.map(function(f) { return { relPath: f.relPath, name: f.name, content: f.content || '' }; })
                    };
                })
            };
            localStorage.setItem('md-workspaces-backup-v1', JSON.stringify(lsBackup));
        } catch (e2) {}
        return __idbSet(IDB_WS_KEY, payload).catch(function() {});
    } catch (e) { return Promise.resolve(); }
}

// Merge IDB github mirror into localStorage so the existing
// restoreGithubWorkspaces() picks up repos even if LS was cleared.
function __mergeGithubIntoLS(idbGithub) {
    try {
        var seen = {};
        var out = [];
        [getPersistedGithub(), idbGithub || []].forEach(function(list) {
            (list || []).forEach(function(m) {
                if (!m || !m.owner || !m.repo) return;
                var k = String(m.owner).toLowerCase() + '/' + String(m.repo).toLowerCase() + '@' + String(m.branch || 'main').toLowerCase();
                if (!seen[k]) { seen[k] = true; out.push(m); }
            });
        });
        localStorage.setItem(LS_GITHUB_KEY, JSON.stringify(out));
    } catch (e) {}
}

// Restore uploads + local fallback folders + handle folders from IDB.
// GitHub repos are restored separately by restoreGithubWorkspaces() right after this resolves.
function __restoreUploads(list) {
    if (!list || !list.length || typeof addWorkspace !== 'function') return;
    var kids = [];
    list.forEach(function(u) {
        kids.push({
            id: 'file-restore-' + Date.now() + '-' + kids.length + '-' + Math.floor(Math.random() * 1e6),
            type: 'file',
            name: u.name || 'untitled.md',
            content: typeof u.content === 'string' ? u.content : ''
        });
    });
    if (kids.length) {
        addWorkspace(
            { type: 'folder', name: 'Uploads', isOpen: true, count: kids.length, children: kids },
            { kind: 'uploads', status: kids.length + ' uploaded file' + (kids.length === 1 ? '' : 's') + ' (restored).' }
        );
    }
}

function __restoreLocalFolders(list) {
    if (!list || !list.length || typeof addWorkspace !== 'function') return;
    var cap = (typeof MAX_WORKSPACES !== 'undefined') ? MAX_WORKSPACES : 10;
    // Don't exceed workspace limit
    var remaining = cap - fileSystem.length;
    if (remaining <= 0) return;
    list = list.slice(0, remaining);
    list.forEach(function(entry) {
        if (!entry || !entry.files || !entry.files.length) return;
        var root = { type: 'folder', name: entry.name || 'Folder', isOpen: true, children: [] };
        var dirMap = { '': root };
        entry.files.forEach(function(f) {
            if (!f || !f.name) return;
            var rel = f.relPath || f.name;
            var parts = String(rel).split('/').filter(Boolean);
            if (!parts.length) return;
            var parent = root;
            var key = '';
            for (var d = 0; d < parts.length - 1; d++) {
                key += '/' + parts[d];
                if (!dirMap[key]) {
                    dirMap[key] = {
                        id: 'folder-restore-' + Date.now() + '-' + Math.floor(Math.random() * 1e6),
                        type: 'folder',
                        name: parts[d],
                        isOpen: true,
                        children: []
                    };
                    parent.children.push(dirMap[key]);
                }
                parent = dirMap[key];
            }
            parent.children.push({
                id: 'file-restore-' + Date.now() + '-' + Math.floor(Math.random() * 1e6),
                type: 'file',
                name: f.name,
                relPath: rel,
                content: f.content || null,
                blob: f.blob || null
            });
        });
        if (!root.children.length) return;
        if (typeof sortTreeNodes === 'function') { try { sortTreeNodes(root.children); } catch (e) {} }
        root.count = entry.count || entry.files.length;
        addWorkspace(root, { kind: 'folder', status: '' });
    });
}

function restoreLocalWorkspaces() {
    return __idbGet(IDB_WS_KEY).then(function(data) {
        // IDB may be empty on file:// if opaque origin — fall back to LS backup
        if (!data) {
            try {
                var raw = localStorage.getItem('md-workspaces-backup-v1');
                if (raw) {
                    var ls = JSON.parse(raw);
                    if (ls) {
                        __restoreUploads(ls.uploads);
                        __restoreLocalFolders(ls.localFolders);
                    }
                }
            } catch (e2) {}
            return;
        }
        // 1. Uploads (instant, no permission needed)
        __restoreUploads(data.uploads);
        // 2. Legacy local folders (webkitdirectory fallback — no handle needed)
        __restoreLocalFolders(data.localFolders);
        // 3. LS backup: if IDB had no localFolders but LS does, merge it (covers old saves)
        if ((!data.localFolders || !data.localFolders.length)) {
            try {
                var raw2 = localStorage.getItem('md-workspaces-backup-v1');
                if (raw2) {
                    var ls2 = JSON.parse(raw2);
                    if (ls2 && ls2.localFolders && ls2.localFolders.length) {
                        // Only restore those not already present by name
                        var existingNames = {};
                        for (var i = 0; i < fileSystem.length; i++) existingNames[String(fileSystem[i].name).toLowerCase()] = true;
                        var toAdd = ls2.localFolders.filter(function(lf) { return !existingNames[String(lf.name || '').toLowerCase()]; });
                        __restoreLocalFolders(toAdd);
                    }
                    if (ls2 && ls2.uploads && ls2.uploads.length && !data.uploads) {
                        __restoreUploads(ls2.uploads);
                    }
                }
            } catch (e3) {}
        }
        // 4. GitHub mirror → localStorage for the github.js restore step
        __mergeGithubIntoLS(data.github);
        // 5. Folders with handles (need read permission; else disconnected placeholder)
        var fns = (data.folders || []).slice(0, (typeof MAX_WORKSPACES !== 'undefined') ? MAX_WORKSPACES : 10);
        var chain = Promise.resolve();
        fns.forEach(function(entry) {
            chain = chain.then(function() { return __restoreOneFolder(entry); });
        });
        return chain;
    }).catch(function() {
        // IDB failed — try LS fallback
        try {
            var raw3 = localStorage.getItem('md-workspaces-backup-v1');
            if (raw3) {
                var ls3 = JSON.parse(raw3);
                if (ls3) {
                    __restoreUploads(ls3.uploads);
                    __restoreLocalFolders(ls3.localFolders);
                }
            }
        } catch (e4) {}
    });
}

function __restoreOneFolder(entry) {
    if (!entry || !entry.handle) return Promise.resolve();
    var h = entry.handle;
    function rebuild() {
        if (typeof rebuildFolderWorkspace === 'function') return rebuildFolderWorkspace(entry.name || h.name || 'Folder', h);
        return Promise.resolve();
    }
    function placeholder() {
        if (typeof addDisconnectedFolderWorkspace === 'function') {
            addDisconnectedFolderWorkspace(entry.name || h.name || 'Folder', h);
        }
        return Promise.resolve();
    }
    try {
        if (typeof h.queryPermission === 'function') {
            return h.queryPermission({ mode: 'read' }).then(function(p) {
                if (p === 'granted') return rebuild();
                return placeholder();
            }).catch(function() { return rebuild(); });
        }
    } catch (e) {}
    return rebuild().catch(function() { return placeholder(); });
}
