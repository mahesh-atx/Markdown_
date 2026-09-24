// Load .md files from a public GitHub repo link.
// Depends on: utils.js (escapeHtml, normalizeMarkdown via file-tree),
//   file-tree.js (fileSystem, updateFileList, setActiveFile),
//   folder.js (nextFolderNodeId, sortTreeNodes, countMarkdownFiles,
//     findFirstFileId, setFolderStatus, showClearButton, isMarkdownFilename) — fallbacks included.
// Defines: parseGithubUrl, loadGithubRepo, clearGithubFolder.
// Wires itself on load (script is included after the DOM elements).

var GITHUB_FOLDER_ID = 'folder-github';
var GITHUB_MAX_FILES = (typeof MAX_FOLDER_FILES !== 'undefined') ? MAX_FOLDER_FILES : 3000;

// --- Fallbacks (used only if folder.js load order changes) ---
function __ghNextId(prefix) {
    if (typeof nextFolderNodeId === 'function') return nextFolderNodeId(prefix);
    return prefix + '-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
}
function __ghIsMd(name) {
    if (typeof isMarkdownFilename === 'function') return isMarkdownFilename(name);
    return /\.(md|markdown)$/i.test(name || '');
}
function __ghSort(nodes) {
    if (typeof sortTreeNodes === 'function') { sortTreeNodes(nodes); return; }
    nodes.sort(function(a, b) {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        var an = (a.name || '').toLowerCase(), bn = (b.name || '').toLowerCase();
        return an < bn ? -1 : an > bn ? 1 : 0;
    });
}
function __ghCount(node) {
    if (typeof countMarkdownFiles === 'function') return countMarkdownFiles(node);
    if (node.type === 'file') return 1;
    var t = 0;
    (node.children || []).forEach(function(c) { t += __ghCount(c); });
    return t;
}
function __ghFirstFile(nodes) {
    if (typeof findFirstFileId === 'function') return findFirstFileId(nodes);
    for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].type === 'file') return nodes[i].id;
        if (nodes[i].children) { var f = __ghFirstFile(nodes[i].children); if (f) return f; }
    }
    return null;
}

// --- URL parsing: accepts blob/tree URLs, .git suffix, trailing slash ---
function parseGithubUrl(input) {
    if (!input) return null;
    var s = String(input).trim();
    // Allow pasting "owner/repo" shorthand
    if (/^[\w.-]+\/[\w.-]+(\/.*)?$/.test(s) && s.indexOf('://') === -1 && s.indexOf('github.com') === -1) {
        var p = s.split('/').filter(Boolean);
        if (p.length >= 2) return { owner: p[0], repo: p[1].replace(/\.git$/, '') };
        return null;
    }
    // Full URL
    var m = s.match(/github\.com\/([\w.-]+)\/([\w.-]+)/i);
    if (!m) return null;
    return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

function __ghApiHeaders(token) {
    var h = { 'Accept': 'application/vnd.github+json' };
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
}

function __ghFetchJson(url, token) {
    return fetch(url, { headers: __ghApiHeaders(token) }).then(function(res) {
        if (res.status === 404) {
            var e = new Error('Repository or branch not found. Check the link (public repos only unless you add a token).');
            e.code = 404;
            throw e;
        }
        if (res.status === 403 || res.status === 429) {
            var r = new Error('GitHub rate limit hit (60/hr without token). Add a token in Advanced, wait a bit, and retry.');
            r.code = res.status;
            throw r;
        }
        if (res.status === 401) {
            var u = new Error('Invalid token (401). Check the token or leave it empty for public repos.');
            u.code = 401;
            throw u;
        }
        if (!res.ok) throw new Error('GitHub request failed: ' + res.status);
        return res.json();
    });
}

function __ghLoadTree(owner, repo, branches, token) {
    // Try branches in order; resolve { branch, tree, truncated }
    var chain = Promise.reject(null);
    branches.forEach(function(br) {
        chain = chain.catch(function(prevErr) {
            // Don't mask a rate-limit/auth error with a fallback attempt
            if (prevErr && (prevErr.code === 403 || prevErr.code === 429 || prevErr.code === 401)) throw prevErr;
            return __ghFetchJson(
                'https://api.github.com/repos/' + owner + '/' + repo + '/git/trees/' + encodeURIComponent(br) + '?recursive=1',
                token
            ).then(function(data) {
                return { branch: br, tree: data.tree || [], truncated: !!data.truncated };
            });
        });
    });
    return chain;
}

function buildTreeFromGithubPaths(paths, owner, repo, branch, token) {
    var root = {
        id: __ghNextId('gh-folder'),
        type: 'folder',
        name: owner + '/' + repo + '@' + branch,
        isOpen: true,
        children: []
    };
    var dirMap = { '': root };
    var fetchHeaders = token ? { 'Authorization': 'Bearer ' + token } : undefined;
    var count = 0, truncated = false;

    for (var i = 0; i < paths.length; i++) {
        if (count >= GITHUB_MAX_FILES) { truncated = true; break; }
        var fullPath = paths[i];
        var parts = fullPath.split('/');
        var fileName = parts[parts.length - 1];
        if (!__ghIsMd(fileName)) continue;
        var parent = root, key = '';
        for (var d = 0; d < parts.length - 1; d++) {
            key += '/' + parts[d];
            if (!dirMap[key]) {
                dirMap[key] = { id: __ghNextId('gh-folder'), type: 'folder', name: parts[d], isOpen: true, children: [] };
                parent.children.push(dirMap[key]);
            }
            parent = dirMap[key];
        }
        count += 1;
        var dir = parts.slice(0, -1).join('/');
        parent.children.push({
            id: __ghNextId('gh-file'),
            type: 'file',
            name: fileName,
            url: 'https://raw.githubusercontent.com/' + owner + '/' + repo + '/' + encodeURIComponent(branch) + '/' + fullPath.split('/').map(encodeURIComponent).join('/'),
            fetchHeaders: fetchHeaders, // undefined for public repos — readNodeContent skips it
            repoPath: fullPath,
            github: { owner: owner, repo: repo, branch: branch, dir: dir },
            content: null
        });
    }
    __ghSort(root.children);
    return { tree: root, count: count, truncated: truncated };
}

function replaceGithubFolder(rootNode) {
    for (var i = fileSystem.length - 1; i >= 0; i--) {
        if (fileSystem[i].id === GITHUB_FOLDER_ID) fileSystem.splice(i, 1);
    }
    if (rootNode) {
        rootNode.id = GITHUB_FOLDER_ID;
        fileSystem.push(rootNode);
    }
}

function clearGithubFolder() {
    // Workspaces: footer Remove drops the active workspace only (single handler
    // lives in folder.js clearOpenedFolder — no second listener here, or one
    // click would remove two workspaces).
    if (typeof removeActiveWorkspace === 'function' && typeof fileSystem !== 'undefined' && fileSystem.length) {
        var ws = (typeof getActiveWorkspace === 'function') ? getActiveWorkspace() : null;
        if (ws && ws._kind === 'github') { removeActiveWorkspace(); return; }
        if (!ws) return;
    }
    replaceGithubFolder(null);
    if (typeof updateFileList === 'function') updateFileList();
}

// Re-load persisted GitHub workspaces on startup (public repos, no token).
// Called from main.js. Sequential to respect rate limits.
function restoreGithubWorkspaces() {
    if (typeof getPersistedGithub !== 'function') return Promise.resolve();
    var list = getPersistedGithub();
    if (!list || !list.length) return Promise.resolve();
    var cap = (typeof MAX_WORKSPACES !== 'undefined') ? MAX_WORKSPACES : 10;
    list = list.slice(0, cap);
    if (typeof setFolderStatus === 'function') setFolderStatus('Restoring ' + list.length + ' repo(s)…');
    var chain = Promise.resolve();
    list.forEach(function(m) {
        chain = chain.then(function() { return __restoreOneRepo(m); });
    });
    return chain;
}

function __restoreOneRepo(m) {
    if (!m || !m.owner || !m.repo) return Promise.resolve();
    var branches = [m.branch || 'main'];
    ['main', 'master'].forEach(function(b) { if (branches.indexOf(b) === -1) branches.push(b); });
    return __ghLoadTree(m.owner, m.repo, branches, undefined).then(function(res) {
        var mdPaths = res.tree
            .filter(function(n) { return n && n.type === 'blob' && __ghIsMd(n.path); })
            .map(function(n) { return n.path; });
        if (!mdPaths.length) return;
        var built = buildTreeFromGithubPaths(mdPaths, m.owner, m.repo, res.branch, undefined);
        built.tree.count = __ghCount(built.tree);
        if (typeof addWorkspace === 'function') {
            addWorkspace(built.tree, {
                kind: 'github',
                status: '',
                github: { owner: m.owner, repo: m.repo, branch: res.branch }
            });
        }
    }).catch(function(err) {
        console.warn('Workspace restore skipped for ' + m.owner + '/' + m.repo + ':', err && err.message);
    });
}

// --- Modal UI ---
function __ghEl(id) { return document.getElementById(id); }
function __ghShowModal(show) {
    var m = __ghEl('github-modal');
    if (!m) return;
    if (show) { m.classList.remove('hidden'); m.classList.add('flex'); }
    else { m.classList.add('hidden'); m.classList.remove('flex'); }
}
function __ghError(msg) {
    var el = __ghEl('github-error');
    if (!el) return;
    if (!msg) { el.classList.add('hidden'); el.textContent = ''; }
    else { el.textContent = msg; el.classList.remove('hidden'); }
}
function __ghLoading(loading) {
    var btn = __ghEl('github-load-btn');
    if (!btn) return;
    if (loading) {
        btn.dataset.orig = btn.innerHTML;
        btn.innerHTML = '<i class="ph ph-spinner-gap animate-spin"></i><span>Loading…</span>';
        btn.classList.add('opacity-75', 'pointer-events-none');
    } else if (btn.dataset.orig) {
        btn.innerHTML = btn.dataset.orig;
        btn.classList.remove('opacity-75', 'pointer-events-none');
    }
}

function loadGithubRepo() {
    var urlVal = (__ghEl('github-url-input') || {}).value || '';
    var branchVal = ((__ghEl('github-branch-input') || {}).value || '').trim();
    var tokenVal = ((__ghEl('github-token-input') || {}).value || '').trim();
    __ghError(null);

    var parsed = parseGithubUrl(urlVal);
    if (!parsed) {
        __ghError('Could not parse that link. Use https://github.com/OWNER/REPO or OWNER/REPO.');
        return;
    }

    __ghLoading(true);
    // No footer status while loading — the modal spinner shows progress and the
    // status is cleared on success, so nothing can get stuck here.

    var branches;
    if (branchVal) {
        branches = [branchVal];
    } else {
        // Resolve default branch first, fall back to main → master
        branches = null;
    }

    function proceed(branchList) {
        __ghLoadTree(parsed.owner, parsed.repo, branchList, tokenVal || undefined).then(function(res) {
            var mdPaths = res.tree
                .filter(function(n) { return n && n.type === 'blob' && __ghIsMd(n.path); })
                .map(function(n) { return n.path; });
            if (mdPaths.length === 0) {
                try { if (typeof showToast === 'function') showToast('No .md files found in "' + parsed.owner + '/' + parsed.repo + '".', 'error'); } catch (e) {}
                __ghError('No .md files found on branch "' + res.branch + '".');
                __ghLoading(false);
                return;
            }
            var built = buildTreeFromGithubPaths(mdPaths, parsed.owner, parsed.repo, res.branch, tokenVal || undefined);
            built.tree.count = __ghCount(built.tree);
            // Workspaces: new repo becomes its own toggleable workspace (duplicate → switch).
            // No success status message — the workspace entry + file count shows it.
            if (typeof addWorkspace === 'function') {
                addWorkspace(built.tree, {
                    kind: 'github',
                    status: '',
                    github: { owner: parsed.owner, repo: parsed.repo, branch: res.branch }
                });
                if (typeof saveLocalWorkspaces === 'function') saveLocalWorkspaces();
            } else {
                // Legacy fallback (no workspaces.js): single replaceable repo
                replaceGithubFolder(built.tree);
                updateFileList();
                var firstId = __ghFirstFile(built.tree.children);
                if (firstId) setActiveFile(firstId);
            }
            __ghLoading(false);
            __ghShowModal(false);
        }).catch(function(err) {
            console.error('GitHub load failed', err);
            var msg = (err && err.message) ? err.message : 'Could not load this repository.';
            __ghError(msg);
            try { if (typeof showToast === 'function') showToast('GitHub load failed. ' + msg, 'error'); } catch (e) {}
            __ghLoading(false);
        });
    }

    if (branches) {
        proceed(branches);
    } else {
        __ghFetchJson('https://api.github.com/repos/' + parsed.owner + '/' + parsed.repo, tokenVal || undefined).then(function(meta) {
            var def = meta && meta.default_branch ? [meta.default_branch] : [];
            var list = def.concat(['main', 'master'].filter(function(b) { return def.indexOf(b) === -1; }));
            proceed(list.length ? list : ['main', 'master']);
        }).catch(function() {
            // Repo meta failed (often 404) — still try main → master so the tree call surfaces the real error
            proceed(['main', 'master']);
        });
    }
}

// Wire up (elements exist because this script loads after the DOM)
(function wireGithubModal() {
    var openBtn = __ghEl('open-github-btn');
    var modal = __ghEl('github-modal');
    if (!openBtn || !modal) return;
    openBtn.addEventListener('click', function() { __ghError(null); __ghShowModal(true); setTimeout(function() { var i = __ghEl('github-url-input'); if (i) i.focus(); }, 50); });
    var close = function() { __ghShowModal(false); };
    var closeBtn = __ghEl('github-modal-close');
    var cancelBtn = __ghEl('github-modal-cancel');
    var backdrop = __ghEl('github-modal-backdrop');
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (cancelBtn) cancelBtn.addEventListener('click', close);
    if (backdrop) backdrop.addEventListener('click', close);
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && !modal.classList.contains('hidden')) close(); });
    var urlInput = __ghEl('github-url-input');
    if (urlInput) urlInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') loadGithubRepo(); });
    var loadBtn = __ghEl('github-load-btn');
    if (loadBtn) loadBtn.addEventListener('click', loadGithubRepo);
})();
