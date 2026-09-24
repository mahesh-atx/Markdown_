// Shared helpers: normalization, escaping, language aliases.
// No dependencies. Loaded first.

function normalizeMarkdown(content) {
    var text = (typeof content === 'string') ? content : String(content || '');
    // Strip UTF-8 BOM (breaks "# Heading" detection on uploaded files)
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    // Normalize line endings
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // Strip YAML frontmatter (--- ... ---) which otherwise renders as stray <hr>/<p>
    if (text.indexOf('---\n') === 0) {
        var closeIdx = text.indexOf('\n---', 4);
        if (closeIdx !== -1) {
            var after = text.indexOf('\n', closeIdx + 4);
            if (after !== -1) text = text.slice(after + 1);
        }
    }
    return text;
}

function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Map common aliases / capitalizations from uploaded files to Prism languages
var LANG_ALIASES = {
    'py': 'python', 'python3': 'python', 'gyp': 'python',
    'js': 'javascript', 'jsx': 'javascript', 'mjs': 'javascript', 'cjs': 'javascript',
    'ts': 'typescript', 'tsx': 'typescript',
    'sh': 'bash', 'shell': 'bash', 'zsh': 'bash', 'console': 'bash', 'terminal': 'bash', 'powershell': 'powershell', 'ps1': 'powershell',
    'yml': 'yaml', 'html': 'markup', 'xml': 'markup', 'vue': 'markup',
    'c++': 'cpp', 'h': 'c', 'hpp': 'cpp',
    'md': 'markdown', 'markdown': 'markdown',
    'txt': 'none', 'text': 'none', 'plain': 'none', 'output': 'none', 'result': 'none', 'console-output': 'none'
};

function normalizeLang(raw) {
    if (!raw) return '';
    // marked may give "python title=..." — take first token, lowercase
    var first = String(raw).trim().split(/\s+/)[0].toLowerCase();
    return LANG_ALIASES[first] || first;
}

function prettyLangName(lang) {
    if (!lang || lang === 'none') return '';
    var pretty = { python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript', bash: 'Bash', markup: 'HTML', cpp: 'C++' };
    if (pretty[lang]) return pretty[lang];
    return lang.charAt(0).toUpperCase() + lang.slice(1);
}
