// .md file upload handling — now via a modal popup like the GitHub modal
// (replaces the previous direct file-input alert style).
// Depends on: utils.js (normalizeMarkdown, escapeHtml), file-tree.js (setActiveFile, fileSystem),
//   workspaces.js (addWorkspace, findUploadsWorkspace, setActiveWorkspace — optional).
// Uploads live in their own "Uploads" workspace so repos stay clean.
// Wires itself on load (script is included after the DOM elements).

var __pendingUploadFiles = [];

function __upEl(id) { return document.getElementById(id); }

function __upShowModal(show) {
    var m = __upEl('upload-modal');
    if (!m) return;
    if (show) { m.classList.remove('hidden'); m.classList.add('flex'); }
    else { m.classList.add('hidden'); m.classList.remove('flex'); }
}

function __upError(msg) {
    var el = __upEl('upload-error');
    if (!el) return;
    if (!msg) { el.classList.add('hidden'); el.textContent = ''; }
    else { el.textContent = msg; el.classList.remove('hidden'); }
}

function __isAllowedUpload(name) {
    return /\.(md|markdown|txt)$/i.test(name || '');
}

function __upRenderList() {
    var box = __upEl('upload-file-list');
    var btn = __upEl('upload-load-btn');
    if (!box) return;
    if (!__pendingUploadFiles.length) {
        box.classList.add('hidden');
        box.innerHTML = '';
        if (btn) { btn.disabled = true; btn.querySelector('span').textContent = 'Load files'; }
        return;
    }
    box.classList.remove('hidden');
    var html = '';
    for (var i = 0; i < __pendingUploadFiles.length; i++) {
        var f = __pendingUploadFiles[i];
        html += '<div class="flex items-center gap-2 py-1.5 px-2 text-[12px] border-b border-[#1e1e1e] last:border-0">'
            + '<i class="ph ph-file-text text-[#ff6b00] text-sm flex-shrink-0"></i>'
            + '<span class="truncate text-[#d1d5db] flex-1">' + escapeHtml(f.name) + '</span>'
            + '<span class="text-[10px] text-[#555] font-mono flex-shrink-0">' + (f.size ? (Math.ceil(f.size / 1024) + ' KB') : '') + '</span>'
            + '<button data-idx="' + i + '" class="up-remove text-[#555] hover:text-white p-1 rounded hover:bg-[#1a1a1a] flex-shrink-0" title="Remove"><i class="ph ph-x text-xs"></i></button>'
            + '</div>';
    }
    box.innerHTML = html;
    box.querySelectorAll('.up-remove').forEach(function(b) {
        b.addEventListener('click', function(e) {
            e.stopPropagation();
            var idx = parseInt(this.getAttribute('data-idx'), 10);
            if (!isNaN(idx)) {
                __pendingUploadFiles.splice(idx, 1);
                __upRenderList();
                __upError(null);
            }
        });
    });
    if (btn) {
        btn.disabled = false;
        btn.querySelector('span').textContent = 'Load ' + __pendingUploadFiles.length + ' file' + (__pendingUploadFiles.length === 1 ? '' : 's');
    }
}

function __upSetFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    var added = 0, skipped = 0;
    for (var i = 0; i < fileList.length; i++) {
        var f = fileList[i];
        if (!f || !f.name) continue;
        if (!__isAllowedUpload(f.name)) { skipped += 1; continue; }
        // de-dupe by name+size
        var dup = false;
        for (var j = 0; j < __pendingUploadFiles.length; j++) {
            if (__pendingUploadFiles[j].name === f.name && __pendingUploadFiles[j].size === f.size) { dup = true; break; }
        }
        if (dup) continue;
        __pendingUploadFiles.push(f);
        added += 1;
    }
    __upRenderList();
    if (added === 0 && skipped > 0) {
        __upError('No .md files selected. Pick files ending in .md, .markdown or .txt.');
    } else if (skipped > 0) {
        __upError(skipped + ' file(s) skipped — only .md / .markdown / .txt are accepted.');
    } else {
        __upError(null);
    }
}

function __upClear() {
    __pendingUploadFiles = [];
    __upRenderList();
    __upError(null);
    var inp = __upEl('file-upload');
    if (inp) inp.value = '';
}

function __upLoading(loading) {
    var btn = __upEl('upload-load-btn');
    if (!btn) return;
    if (loading) {
        btn.dataset.orig = btn.innerHTML;
        btn.innerHTML = '<i class="ph ph-spinner-gap animate-spin"></i><span>Loading…</span>';
        btn.disabled = true;
        btn.classList.add('opacity-75', 'pointer-events-none');
    } else {
        if (btn.dataset.orig) btn.innerHTML = btn.dataset.orig;
        btn.classList.remove('opacity-75', 'pointer-events-none');
        // re-enable based on list
        __upRenderList();
    }
}

function __upProcessSelectedFiles() {
    if (!__pendingUploadFiles.length) {
        __upError('Pick at least one .md file first.');
        return;
    }
    var files = __pendingUploadFiles.slice();
    __upLoading(true);
    __upError(null);

    var promises = files.map(function(f) {
        return new Promise(function(resolve) {
            var reader = new FileReader();
            reader.onload = function(e) {
                resolve({ name: f.name, content: normalizeMarkdown(e.target.result) });
            };
            reader.onerror = function() { resolve(null); };
            try { reader.readAsText(f, 'UTF-8'); } catch (err) { resolve(null); }
        });
    });

    Promise.all(promises).then(function(results) {
        var valid = results.filter(function(r) { return r && typeof r.content === 'string'; });
        if (!valid.length) {
            __upError('Could not read selected files. Try again.');
            __upLoading(false);
            return;
        }

        // Batch-add to workspaces (single workspace update, not one per file)
        var addedNames = [];
        if (typeof addWorkspace === 'function' && typeof findUploadsWorkspace === 'function') {
            var uploads = findUploadsWorkspace();
            if (uploads) {
                valid.forEach(function(item) {
                    var nf = {
                        id: 'file-' + Date.now() + '-' + Math.floor(Math.random() * 1e6),
                        type: 'file',
                        name: item.name,
                        content: item.content
                    };
                    uploads.children.push(nf);
                    nf._wsId = uploads.id;
                    addedNames.push(item.name);
                });
                uploads.count = uploads.children.length;
                uploads.isOpen = true;
                setActiveWorkspace(uploads.id);
                // focus last added
                var last = uploads.children[uploads.children.length - 1];
                uploads._activeFileId = last.id;
                setActiveFile(last.id);
                if (typeof saveLocalWorkspaces === 'function') saveLocalWorkspaces();
            } else {
                var kids = valid.map(function(item) {
                    return {
                        id: 'file-' + Date.now() + '-' + Math.floor(Math.random() * 1e6),
                        type: 'file',
                        name: item.name,
                        content: item.content
                    };
                });
                var root = { type: 'folder', name: 'Uploads', isOpen: true, count: kids.length, children: kids };
                var ws = addWorkspace(root, { kind: 'uploads', status: '' });
                if (ws) {
                    ws._activeFileId = kids[kids.length - 1].id;
                    setActiveFile(kids[kids.length - 1].id);
                    if (typeof saveLocalWorkspaces === 'function') saveLocalWorkspaces();
                    valid.forEach(function(item) { addedNames.push(item.name); });
                } else {
                    // Workspace limit hit — fallback to active workspace
                    var fb = (typeof getActiveWorkspace === 'function') ? getActiveWorkspace() : null;
                    if (fb) {
                        valid.forEach(function(item) {
                            var nf2 = {
                                id: 'file-' + Date.now() + '-' + Math.floor(Math.random() * 1e6),
                                type: 'file',
                                name: item.name,
                                content: item.content
                            };
                            fb.children.push(nf2);
                            nf2._wsId = fb.id;
                            fb.isOpen = true;
                            setActiveFile(nf2.id);
                            addedNames.push(item.name);
                        });
                    } else {
                        valid.forEach(function(item) {
                            var nf3 = { id: 'file-' + Date.now() + '-' + Math.floor(Math.random() * 1e6), type: 'file', name: item.name, content: item.content };
                            fileSystem.push(nf3);
                            setActiveFile(nf3.id);
                            addedNames.push(item.name);
                        });
                    }
                }
            }
        } else {
            // Legacy fallback (no workspaces.js)
            valid.forEach(function(item) {
                var nf = { id: 'file-' + Date.now() + '-' + Math.floor(Math.random() * 1e6), type: 'file', name: item.name, content: item.content };
                var uploadsFolder = (typeof findFileById === 'function') ? findFileById(fileSystem, 'folder-uploads') : null;
                if (uploadsFolder) {
                    uploadsFolder.children.push(nf);
                    uploadsFolder.count = uploadsFolder.children.length;
                    uploadsFolder.isOpen = true;
                } else {
                    fileSystem.push(nf);
                }
                setActiveFile(nf.id);
                addedNames.push(item.name);
            });
        }

        __upShowModal(false);
        __upClear();
        __upLoading(false);

        if (addedNames.length === 1) {
            try { if (typeof showToast === 'function') showToast('Uploaded "' + addedNames[0] + '".', 'success'); } catch (e) {}
        } else if (addedNames.length > 1) {
            try { if (typeof showToast === 'function') showToast('Uploaded ' + addedNames.length + ' files.', 'success'); } catch (e) {}
        }
    });
}

// Wire up modal + dropzone (elements exist because this script loads after the DOM)
(function wireUploadModal() {
    var openBtn = __upEl('open-upload-btn');
    var modal = __upEl('upload-modal');
    if (!openBtn || !modal) return;

    var closeBtn = __upEl('upload-modal-close');
    var cancelBtn = __upEl('upload-modal-cancel');
    var backdrop = __upEl('upload-modal-backdrop');
    var browseBtn = __upEl('upload-browse-btn');
    var dropzone = __upEl('upload-dropzone');
    var fileInput = __upEl('file-upload');
    var loadBtn = __upEl('upload-load-btn');

    var close = function() { __upShowModal(false); };
    var open = function() { __upError(null); __upShowModal(true); };

    openBtn.addEventListener('click', function() { open(); });

    if (closeBtn) closeBtn.addEventListener('click', close);
    if (cancelBtn) cancelBtn.addEventListener('click', close);
    if (backdrop) backdrop.addEventListener('click', close);

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) close();
    });

    if (browseBtn && fileInput) {
        browseBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            fileInput.click();
        });
    }

    // Clicking the empty dropzone also opens picker
    if (dropzone && fileInput) {
        dropzone.addEventListener('click', function(e) {
            if (e.target === dropzone || e.target.closest && !e.target.closest('button')) {
                // Let browse button handle its own click; otherwise open picker
                if (e.target !== browseBtn && !e.target.closest('#upload-browse-btn')) {
                    // Only if not clicking the remove buttons area
                    if (!e.target.closest('#upload-file-list')) fileInput.click();
                }
            }
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', function() {
            var files = this.files;
            if (files && files.length) __upSetFiles(files);
            this.value = '';
            // keep modal open so user can review before Load
            if (__pendingUploadFiles.length) open();
        });
    }

    // Drag & drop
    if (dropzone) {
        ['dragenter', 'dragover'].forEach(function(ev) {
            dropzone.addEventListener(ev, function(e) {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.add('border-[#555]', 'bg-[#141414]');
            });
        });
        ['dragleave', 'drop'].forEach(function(ev) {
            dropzone.addEventListener(ev, function(e) {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.remove('border-[#555]', 'bg-[#141414]');
            });
        });
        dropzone.addEventListener('drop', function(e) {
            var dt = e.dataTransfer;
            var files = dt ? dt.files : null;
            if (files && files.length) {
                __upSetFiles(files);
                if (__pendingUploadFiles.length) open();
            }
        });
    }

    if (loadBtn) loadBtn.addEventListener('click', __upProcessSelectedFiles);
})();
