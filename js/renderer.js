// Custom marked renderer + render entry point.
// Depends on: utils.js, marked, Prism. Defines: renderer, renderMarkdown.

var renderer = new marked.Renderer();

// Override Inline Code rendering (escape to avoid broken HTML on uploads)
renderer.codespan = function(token) {
    // Support both newer Marked.js (object token) and legacy (string)
    var raw = typeof token === 'object' ? (token.text || '') : token;
    return '<code class="bg-[#2d2d2d] text-[#e0e0e0] px-1.5 py-0.5 rounded-md text-[0.85em] font-mono border border-[#3d3d3d] mx-0.5">' + escapeHtml(raw) + '</code>';
};

// Override Link rendering: external → new tab; #anchor + relative .md links
// stay inside the preview (open file / scroll). See preview click handler below.
var defaultLink = renderer.link.bind(renderer);
renderer.link = function(href, title, text) {
    var rawHref = '', rawTitle = '', inner = '';
    var tokens = null;
    if (typeof href === 'object' && href !== null) {
        rawHref = href.href || '';
        rawTitle = href.title || '';
        tokens = href.tokens || null;
        // Preserve inline formatting (**bold**, `code`) inside link text
        try {
            if (tokens && this.parser && this.parser.parseInline) inner = this.parser.parseInline(tokens);
            else inner = escapeHtml(href.text || '');
        } catch (e) { inner = escapeHtml(href.text || ''); }
    } else {
        rawHref = href || '';
        rawTitle = title || '';
        inner = text || '';
    }
    var titleAttr = rawTitle ? ' title="' + escapeHtml(rawTitle) + '"' : '';
    var h = String(rawHref || '');
    // External / special schemes → new tab, untouched
    if (/^(https?:)?\/\//i.test(h) || /^(mailto|tel|data|blob):/i.test(h)) {
        var ext = /^https?:\/\//i.test(h) ? ' target="_blank" rel="noopener noreferrer"' : '';
        if (typeof href === 'object' && href !== null) {
            return '<a href="' + escapeHtml(h) + '"' + titleAttr + ext + '>' + inner + '</a>';
        }
        return defaultLink(href, title, text).replace('<a ', '<a' + ext + ' ');
    }
    // Same-page anchor (#section)
    if (h.charAt(0) === '#') {
        var anchorOnly = h.slice(1);
        return '<a href="' + escapeHtml(h) + '"' + titleAttr + ' data-md-anchor="' + escapeHtml(anchorOnly) + '">' + inner + '</a>';
    }
    // Relative link: split path + #anchor, decide .md vs asset
    var hashIdx = h.indexOf('#');
    var pathPart = hashIdx === -1 ? h : h.slice(0, hashIdx);
    var anchorPart = hashIdx === -1 ? '' : h.slice(hashIdx + 1);
    var cleanPath = pathPart.split('?')[0];
    var isMd = /\.(md|markdown)$/i.test(cleanPath) || (cleanPath !== '' && !/\.[a-z0-9]+$/i.test(cleanPath.split('/').pop()));
    var isImgAsset = /\.(png|jpe?g|gif|svg|webp|bmp|ico|avif|pdf)$/i.test(cleanPath);
    if (isMd && cleanPath !== '') {
        var norm = __resolveLinkPath(cleanPath);
        if (norm) {
            return '<a href="' + escapeHtml(h) + '"' + titleAttr +
                ' data-md-file="' + escapeHtml(norm) + '" data-md-anchor="' + escapeHtml(anchorPart) + '">' + inner + '</a>';
        }
        // Unresolvable (e.g. single upload with no folder context) — keep href so
        // the click handler can show "not found" instead of navigating away.
        return '<a href="' + escapeHtml(h) + '"' + titleAttr +
            ' data-md-file="' + escapeHtml(cleanPath) + '" data-md-anchor="' + escapeHtml(anchorPart) + '">' + inner + '</a>';
    }
    if (isImgAsset && cleanPath !== '') {
        // Linked image/pdf: open resolved absolute URL in new tab
        var resolved = __resolveImgSrc(cleanPath);
        var suffix = hashIdx === -1 ? '' : h.slice(hashIdx);
        // __resolveImgSrc strips query/hash; re-append portion after path
        var qIdx = pathPart.indexOf('?');
        var query = qIdx === -1 ? '' : pathPart.slice(qIdx);
        return '<a href="' + escapeHtml(resolved + query + suffix) + '"' + titleAttr + ' target="_blank" rel="noopener noreferrer">' + inner + '</a>';
    }
    // Fallback: leave as-is (no new tab, handler may still intercept)
    if (typeof href === 'object' && href !== null) {
        return '<a href="' + escapeHtml(h) + '"' + titleAttr + '>' + inner + '</a>';
    }
    return defaultLink(href, title, text);
};

// Headings need stable ids or #anchor links have no target.
// Uses GitHub-style slugs (lowercase, spaces → -, strip punctuation), deduped.
var __headingCounts = {};
function __slugifyHeading(s) {
    var base = String(s || '').trim().toLowerCase()
        .replace(/[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    if (!base) base = 'section';
    var n = __headingCounts[base] || 0;
    __headingCounts[base] = n + 1;
    return n === 0 ? base : base + '-' + n;
}

renderer.heading = function(text, level, raw) {
    var depth = level, plain = raw, inner = '';
    if (typeof text === 'object' && text !== null) {
        depth = text.depth || 1;
        plain = text.text || '';
        try {
            if (text.tokens && this.parser && this.parser.parseInline) inner = this.parser.parseInline(text.tokens);
            else inner = escapeHtml(plain);
        } catch (e) { inner = escapeHtml(plain); }
    } else {
        inner = text || '';
        depth = level || 1;
    }
    // Strip HTML tags for slug source
    var slugSrc = String(plain || '').replace(/<[^>]*>/g, '');
    var id = __slugifyHeading(slugSrc);
    return '<h' + depth + ' id="' + escapeHtml(id) + '">' + inner + '</h' + depth + '>';
};

// Wrap tables so wide uploaded-file tables scroll instead of breaking layout
var defaultTable = renderer.table.bind(renderer);
renderer.table = function() {
    var html = defaultTable.apply(this, arguments);
    return '<div class="md-table-wrapper">' + html + '</div>';
};

// --- Image resolution: relative ./images/foo.png breaks when the .md came
// from a GitHub repo or a local folder (browser resolves against index.html).
// renderMarkdown(content, fileOrResolver) sets mdImageResolver; renderer.image
// + post-process below rewrite relatives to raw.githubusercontent URLs or
// local blob: URLs. Absolute https/data/blob URLs pass through untouched.
var mdImageResolver = null;

function __isAbsoluteImgSrc(s) {
    if (!s) return true;
    return /^(https?:)?\/\//i.test(s) || /^(data|blob):/i.test(s) || s.charAt(0) === '#';
}

function __normalizeRelParts(parts) {
    var out = [];
    for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (!p || p === '.') continue;
        if (p === '..') { if (out.length) out.pop(); continue; }
        out.push(p);
    }
    return out;
}

function __resolveImgSrc(src) {
    if (!src || __isAbsoluteImgSrc(src)) return src;
    // Strip query/hash for resolution, re-append after
    var suffix = '';
    var q = src.indexOf('#'), qq = src.indexOf('?');
    var cut = -1;
    if (q !== -1 && qq !== -1) cut = Math.min(q, qq);
    else if (q !== -1) cut = q;
    else if (qq !== -1) cut = qq;
    var clean = cut === -1 ? src : src.slice(0, cut);
    if (cut !== -1) suffix = src.slice(cut);
    if (typeof mdImageResolver === 'function') {
        try {
            var r = mdImageResolver(clean);
            if (r) return r + suffix;
        } catch (e) { /* fall through */ }
    }
    return src;
}

// Build a resolver from a file node: GitHub files carry .github context,
// local-folder files carry .relPath + global localImageURLMap (see folder.js).
function __resolverForFile(file) {
    if (!file || typeof file !== 'object') return null;
    if (file.github && file.github.owner) {
        var g = file.github;
        var base = 'https://raw.githubusercontent.com/' + g.owner + '/' + g.repo + '/' + encodeURIComponent(g.branch) + '/';
        var dir = g.dir ? g.dir.split('/').map(encodeURIComponent).join('/') + '/' : '';
        var rootBase = base;
        return function(src) {
            var s = String(src || '').trim();
            if (!s || __isAbsoluteImgSrc(s)) return s;
            // Remove leading ./ and decode-safe split
            while (s.indexOf('./') === 0) s = s.slice(2);
            if (s.charAt(0) === '/') {
                return rootBase + __normalizeRelParts(s.slice(1).split('/')).map(encodeURIComponent).join('/');
            }
            var combined = (g.dir ? g.dir.split('/') : []).concat(s.split('/'));
            return base + __normalizeRelParts(combined).map(encodeURIComponent).join('/');
        };
    }
    if (file.relPath !== undefined) {
        return function(src) {
            var s = String(src || '').trim();
            if (!s || __isAbsoluteImgSrc(s)) return s;
            while (s.indexOf('./') === 0) s = s.slice(2);
            var dirParts = file.relPath.split('/');
            dirParts.pop(); // strip filename -> dir
            var combined;
            if (s.charAt(0) === '/') combined = s.slice(1).split('/');
            else combined = dirParts.concat(s.split('/'));
            var norm = __normalizeRelParts(combined).join('/');
            var map = (typeof localImageURLMap !== 'undefined') ? localImageURLMap : {};
            // Namespaced per-workspace keys (wsId::relPath) first, then legacy plain keys
            if (file._wsId) {
                var nsk = file._wsId + '::' + norm;
                if (map[nsk]) return map[nsk];
                var nlow = nsk.toLowerCase();
                for (var nk in map) { if (nk.toLowerCase() === nlow) return map[nk]; }
            }
            if (map[norm]) return map[norm];
            // case-insensitive fallback (Windows folders, extension case)
            var low = norm.toLowerCase();
            for (var k in map) { if (k.toLowerCase() === low) return map[k]; }
            return s; // unresolved — leave so broken icon shows with alt text
        };
    }
    return null;
}

// Current file context for link navigation (set in renderMarkdown).
var mdCurrentFile = null;
var mdPendingNav = { fileId: null, anchor: '' };

// Normalize a relative link to a repo/folder-relative path (no URL encoding)
// e.g. current docs/guide.md + ../shared/x.md → docs/shared/x.md
function __resolveLinkPath(src) {
    var file = mdCurrentFile;
    if (!file || typeof file !== 'object') return null;
    var s = String(src || '').trim();
    if (!s) return null;
    // Strip query/hash (anchor handled separately)
    var cut = s.search(/[#?]/);
    if (cut !== -1) s = s.slice(0, cut);
    s = s.trim();
    if (!s || /^(https?:)?\/\//i.test(s) || /^(mailto|tel|data|blob):/i.test(s)) return null;
    while (s.indexOf('./') === 0) s = s.slice(2);
    var norm;
    if (s.charAt(0) === '/') {
        norm = __normalizeRelParts(s.slice(1).split('/')).join('/');
    } else if (file.github && file.github.owner) {
        var base = file.github.dir ? file.github.dir.split('/') : [];
        norm = __normalizeRelParts(base.concat(s.split('/'))).join('/');
    } else if (file.relPath !== undefined) {
        var dir = file.relPath.split('/');
        dir.pop();
        norm = __normalizeRelParts(dir.concat(s.split('/'))).join('/');
    } else {
        return null;
    }
    return norm;
}

function __findPreviewFile(normPath) {
    if (!normPath || typeof fileSystem === 'undefined') return null;
    var cands = [normPath];
    try { var dec = decodeURIComponent(normPath); if (dec !== normPath) cands.push(dec); } catch (e) {}
    // Extension-less wiki links: try .md / .markdown
    if (!/\.[a-z0-9]+$/i.test(normPath.split('/').pop())) {
        cands.push(normPath + '.md');
        cands.push(normPath + '.markdown');
    }
    // Prefer the active workspace, then fall back to the others
    var ordered = fileSystem.slice();
    try {
        if (typeof activeWorkspaceId !== 'undefined' && activeWorkspaceId) {
            ordered.sort(function(a, b) {
                return (a.id === activeWorkspaceId ? -1 : 0) - (b.id === activeWorkspaceId ? -1 : 0);
            });
        }
    } catch (e) {}
    function walk(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            if (n.type === 'file') {
                var key = n.repoPath !== undefined ? n.repoPath : n.relPath;
                if (key !== undefined) {
                    for (var c = 0; c < cands.length; c++) {
                        if (key === cands[c]) return n;
                    }
                }
            }
            if (n.children) { var f = walk(n.children); if (f) return f; }
        }
        return null;
    }
    var found = null;
    for (var w = 0; w < ordered.length; w++) {
        found = walk([ordered[w]]);
        if (found) return found;
    }
    // case-insensitive fallback
    function walkCi(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            if (n.type === 'file') {
                var key2 = n.repoPath !== undefined ? n.repoPath : n.relPath;
                if (key2 !== undefined) {
                    for (var c2 = 0; c2 < cands.length; c2++) {
                        if (String(key2).toLowerCase() === String(cands[c2]).toLowerCase()) return n;
                    }
                }
            }
            if (n.children) { var f2 = walkCi(n.children); if (f2) return f2; }
        }
        return null;
    }
    for (var w2 = 0; w2 < ordered.length; w2++) {
        var fci = walkCi([ordered[w2]]);
        if (fci) return fci;
    }
    return null;
}

function __scrollToPreviewAnchor(anchor) {
    if (!anchor) return true;
    var raw = String(anchor);
    var cands = [raw];
    try { var dec = decodeURIComponent(raw); if (dec !== raw) cands.push(dec); } catch (e) {}
    cands.push(raw.toLowerCase());
    // GitHub slug variant (spaces → -, strip punctuation)
    try {
        var slug = raw.trim().toLowerCase()
            .replace(/[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g, '')
            .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        if (slug && cands.indexOf(slug) === -1) cands.push(slug);
    } catch (e) {}
    for (var i = 0; i < cands.length; i++) {
        var el = document.getElementById(cands[i]);
        if (el) {
            try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
            catch (e) { el.scrollIntoView(); }
            return true;
        }
    }
    return false;
}

function __previewStatus(msg) {
    if (!msg) return;
    try { if (typeof showToast === 'function') showToast(msg, 'error'); } catch (e) {}
}

function __handlePreviewClick(e) {
    var a = null;
    try { a = e.target && e.target.closest ? e.target.closest('a') : null; } catch (err) { a = null; }
    if (!a) return;
    var container = document.getElementById('markdown-content');
    if (!container || !container.contains(a)) return;
    var href = a.getAttribute('href') || '';
    // Let external / special schemes use default behavior (new tab via target)
    if (/^(https?:)?\/\//i.test(href) || /^(mailto|tel|data|blob):/i.test(href)) return;
    e.preventDefault();
    var fileAttr = a.getAttribute('data-md-file');
    var anchorAttr = a.getAttribute('data-md-anchor') || '';
    // Strip anchor from href if data attrs missing (fallback-rendered links)
    if ((fileAttr === null || fileAttr === '') && href.charAt(0) === '#') {
        __scrollToPreviewAnchor(href.slice(1));
        return;
    }
    var norm = fileAttr;
    var anchor = anchorAttr;
    if (norm === null || norm === undefined) {
        // Fallback: parse href now using current file context
        var h = href.split('#')[0].split('?')[0];
        anchor = href.indexOf('#') !== -1 ? href.slice(href.indexOf('#') + 1) : '';
        norm = __resolveLinkPath(h);
        if (!norm) {
            if (anchor) __scrollToPreviewAnchor(anchor);
            else __previewStatus('Could not resolve link: ' + href);
            return;
        }
    }
    if (!norm) { // same-file anchor
        if (anchor) {
            if (!__scrollToPreviewAnchor(anchor)) __previewStatus('Heading not found: #' + anchor);
        }
        return;
    }
    var target = __findPreviewFile(norm);
    if (!target) {
        __previewStatus('Linked file not loaded: "' + norm + '" (open its folder / repo first).');
        return;
    }
    if (mdCurrentFile && target.id === mdCurrentFile.id) {
        if (anchor && !__scrollToPreviewAnchor(anchor)) __previewStatus('Heading not found: #' + anchor);
        else if (typeof updateFileList === 'function') updateFileList();
        return;
    }
    mdPendingNav = { fileId: target.id, anchor: anchor || '' };
    try {
        if (typeof setActiveFile === 'function') setActiveFile(target.id);
        else window.location.hash = anchor;
    } catch (err) { console.error('Navigation failed', err); }
}

// Attach once (element persists; only innerHTML is replaced on render)
(function __wirePreviewNav() {
    function wire() {
        var el = document.getElementById('markdown-content');
        if (el && !el.__mdNavWired) {
            el.addEventListener('click', __handlePreviewClick);
            el.__mdNavWired = true;
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
    else wire();
})();

renderer.image = function(href, title, text) {
    var rawHref = '', rawTitle = '', rawText = '';
    if (typeof href === 'object' && href !== null) {
        rawHref = href.href || '';
        rawTitle = href.title || '';
        rawText = href.text || '';
    } else {
        rawHref = href || '';
        rawTitle = title || '';
        rawText = text || '';
    }
    var resolved = __resolveImgSrc(rawHref);
    var titleAttr = rawTitle ? ' title="' + escapeHtml(rawTitle) + '"' : '';
    return '<img src="' + escapeHtml(resolved) + '" alt="' + escapeHtml(rawText) + '"' + titleAttr +
        ' loading="lazy" referrerpolicy="no-referrer" onerror="this.classList.add(\'md-img-broken\');" />';
};

// Override Code Block rendering
renderer.code = function(token, legacyLanguage) {
    // Support both newer Marked.js (object token) and legacy (string)
    var rawCode = typeof token === 'object' ? token.text : token;
    var rawLang = typeof token === 'object' ? token.lang : legacyLanguage;
    var language = normalizeLang(rawLang);

    // If no language is provided, we assume it's an output/text block
    var isPlain = !language || language === 'none';
    var prismLang = isPlain ? 'none' : language;
    var langClass = isPlain ? 'language-none' : ('language-' + prismLang);
    var displayName = prettyLangName(prismLang);

    // Start building the container
    var html = '<div class="md-code-block my-6 bg-[#1a1a1a] rounded-[20px] border border-[#2a2a2a] overflow-hidden">';

    if (!isPlain) {
        // Header Section for real code blocks
        html += '<div class="flex justify-between items-center px-4 py-2 border-b border-[#2a2a2a] bg-[#1a1a1a]">';
        html += '<div class="flex items-center gap-2 text-gray-400 text-xs font-semibold capitalize">' +
                    '<i class="ph ph-code font-bold text-sm"></i> ' +
                    '<span>' + escapeHtml(displayName) + '</span>' +
                '</div>';

        html += '<div class="flex items-center gap-2.5">' +
                    '<button class="copy-btn text-gray-400 hover:text-gray-200 transition-colors flex items-center justify-center p-1.5 rounded hover:bg-[#2a2a2a]" title="Copy code">' +
                        '<i class="ph ph-copy text-[1.1rem]"></i>' +
                    '</button>' +
                    '<button class="run-btn flex items-center gap-1.5 border border-[#3a3a3a] rounded-full px-3 py-1 text-xs font-medium text-gray-300 hover:bg-[#2a2a2a] hover:border-gray-400 transition-all">' +
                        '<i class="ph-fill ph-play text-[10px]"></i> Run' +
                    '</button>' +
                '</div></div>';
    }

    var escapedCode = escapeHtml(rawCode);
    html += '<div class="p-4 code-scroll overflow-x-auto">' +
                '<pre class="!bg-transparent !p-0 !m-0"><code class="' + langClass + ' !bg-transparent text-[0.85rem]">' + escapedCode + '</code></pre>' +
            '</div>' +
        '</div>';

    return html;
};

marked.setOptions({
    renderer: renderer,
    gfm: true,        // tables, task lists, strikethrough, autolinks — needed for uploaded files
    breaks: false,    // standard markdown: single \n = soft break (true injected stray <br> in lists)
    pedantic: false
});

function renderMarkdown(content, fileOrResolver) {
    if (typeof fileOrResolver === 'function') { mdImageResolver = fileOrResolver; mdCurrentFile = null; }
    else if (fileOrResolver && typeof fileOrResolver === 'object') { mdImageResolver = __resolverForFile(fileOrResolver); mdCurrentFile = fileOrResolver; }
    else { mdImageResolver = null; mdCurrentFile = null; }
    __headingCounts = {};
    try {
        var clean = normalizeMarkdown(content);
        document.getElementById('markdown-content').innerHTML = marked.parse(clean);
        // Fix raw-HTML <img> tags inside markdown (renderer.image can't see them)
        try {
            var imgs = document.querySelectorAll('#markdown-content img');
            for (var i = 0; i < imgs.length; i++) {
                var orig = imgs[i].getAttribute('src');
                var fixed = __resolveImgSrc(orig);
                if (fixed && fixed !== orig) imgs[i].setAttribute('src', fixed);
                if (!imgs[i].hasAttribute('loading')) imgs[i].setAttribute('loading', 'lazy');
                if (!imgs[i].hasAttribute('referrerpolicy')) imgs[i].setAttribute('referrerpolicy', 'no-referrer');
            }
        } catch (e) { /* non-fatal */ }
        // Cross-file link with #anchor: scroll once target content arrives
        try {
            if (mdPendingNav.fileId && mdCurrentFile && mdCurrentFile.id === mdPendingNav.fileId && mdPendingNav.anchor) {
                var anc = mdPendingNav.anchor;
                mdPendingNav = { fileId: null, anchor: '' };
                setTimeout(function() {
                    if (!__scrollToPreviewAnchor(anc)) __previewStatus('Heading not found: #' + anc);
                }, 60);
            } else if (mdPendingNav.fileId && mdCurrentFile && mdCurrentFile.id === mdPendingNav.fileId) {
                mdPendingNav = { fileId: null, anchor: '' };
            }
        } catch (e) { /* non-fatal */ }
    } catch (err) {
        console.error('Markdown parse failed:', err);
        document.getElementById('markdown-content').innerHTML =
            '<p style="color:#f87171">Could not render this markdown file.</p><pre style="white-space:pre-wrap;color:#999">' +
            escapeHtml(String(content || '').slice(0, 2000)) + '</pre>';
    }
    if (window.Prism) Prism.highlightAll();
    // attachInteractions() is defined in ui.js and is called here;
    // it must be loaded before renderMarkdown is invoked (see index.html order + main.js).
    if (typeof attachInteractions === 'function') attachInteractions();
}
