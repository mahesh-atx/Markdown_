// Document Tabs management.
// Keeps track of open tabs, active tab, switching, and closing.
// Depends on: data.js (activeFileId, fileSystem), utils.js (escapeHtml).
// Defines: openTabs, renderTabs, addTab, closeTab, closeAllTabs.

var openTabs = [];

function renderTabs() {
    var bar = document.getElementById('tabs-bar');
    if (!bar) return;

    if (!openTabs.length) {
        bar.innerHTML = '';
        bar.classList.add('hidden');
        return;
    }

    bar.classList.remove('hidden');
    bar.innerHTML = '';

    openTabs.forEach(function(fileId) {
        var file = null;
        if (typeof findFileById === 'function' && typeof fileSystem !== 'undefined') {
            file = findFileById(fileSystem, fileId);
        }
        if (!file) return;

        var isActive = fileId === activeFileId;
        var tab = document.createElement('div');
        tab.className = 'doc-tab group relative flex items-center gap-1.5 px-3 py-1.5 rounded-t-md text-xs cursor-pointer border-t-2 border-r border-l border-[#1c1c1f] flex-shrink-0 max-w-[190px] min-w-[100px] ' +
            (isActive ? 'active bg-black text-white border-t-[#ff6b00] font-medium' : 'bg-[#101012] text-[#888] hover:text-[#ddd] hover:bg-[#161619] border-t-transparent');

        tab.title = file.name || 'Untitled';

        var icon = document.createElement('i');
        icon.className = 'ph-fill ph-file-text text-[13px] flex-shrink-0 ' + (isActive ? 'text-[#ff6b00]' : 'text-[#666] group-hover:text-[#888]');
        tab.appendChild(icon);

        var nameSpan = document.createElement('span');
        nameSpan.className = 'truncate flex-1 font-medium select-none';
        nameSpan.textContent = file.name || 'Untitled';
        tab.appendChild(nameSpan);

        var closeBtn = document.createElement('button');
        closeBtn.className = 'tab-close-btn p-0.5 rounded hover:bg-[#27272a] text-[#555] hover:text-white transition-colors flex-shrink-0';
        closeBtn.title = 'Close tab';
        closeBtn.innerHTML = '<i class="ph ph-x text-[10px]"></i>';
        closeBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            closeTab(fileId);
        });
        tab.appendChild(closeBtn);

        tab.addEventListener('click', function() {
            if (activeFileId !== fileId) {
                if (typeof setActiveFile === 'function') setActiveFile(fileId);
            }
        });

        bar.appendChild(tab);
    });

    if (openTabs.length > 1) {
        var closeAll = document.createElement('button');
        closeAll.className = 'text-[#71717a] hover:text-white px-2 py-1 rounded hover:bg-[#18181b] transition-colors text-[11px] flex items-center gap-1 ml-auto flex-shrink-0';
        closeAll.title = 'Close all tabs';
        closeAll.innerHTML = '<i class="ph ph-x text-[11px]"></i><span class="hidden sm:inline">Close all</span>';
        closeAll.addEventListener('click', function(e) {
            e.stopPropagation();
            closeAllTabs();
        });
        bar.appendChild(closeAll);
    }
}

function addTab(fileId) {
    if (!fileId) return;
    if (openTabs.indexOf(fileId) === -1) {
        openTabs.push(fileId);
    }
    renderTabs();
}

function closeTab(fileId) {
    var idx = openTabs.indexOf(fileId);
    if (idx === -1) return;
    openTabs.splice(idx, 1);

    if (activeFileId === fileId) {
        if (openTabs.length > 0) {
            var nextId = openTabs[Math.min(idx, openTabs.length - 1)];
            if (typeof setActiveFile === 'function') setActiveFile(nextId);
        } else {
            if (typeof showWelcomeState === 'function') showWelcomeState();
        }
    } else {
        renderTabs();
    }
}

function closeAllTabs() {
    openTabs = [];
    renderTabs();
    if (typeof showWelcomeState === 'function') showWelcomeState();
}
