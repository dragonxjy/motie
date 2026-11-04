(function () {
  'use strict';
  const { render, exportDocument, normalizeSettings, defaults, themes, themeDescriptions, codeThemes, articleWidths, safeUrl } = window.Motie;
  const $ = selector => document.querySelector(selector);
  const input = $('#markdown-input');
  const previewContent = $('#preview-content');
  const assets = new Map();
  const sampleKey = 'motie-sample-cover.png';
  const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = name => `<i data-lucide="${name}"></i>`;
  const settingsKey = 'motie.settings.v4', previousSettingsKey = 'motie.settings.v3', olderSettingsKey = 'motie.settings.v2', legacySettingsKey = 'motie.settings.v1', draftKey = 'motie.draft.v1';
  let settings = { ...defaults }, result = null, timer, toastTimer, device = window.innerWidth > 760 ? 'desktop' : 'mobile', copying = false;
  let sourceName = '示例文章', localCounter = 0, replaceKey = null, pendingConfirm = null;
  let history = [], historyIndex = -1, lastHistoryTime = 0, savedSelection = { start: 0, end: 0 }, outlineTargets = [];
  const runtimeWarnings = new Set();

  function addSampleAsset() { assets.set(sampleKey, { dataUrl: window.MOTIE_SAMPLE_IMAGE, name: 'Markdown 到公众号发布流程示意图', kind: 'local' }); }
  addSampleAsset();
  $('#theme-select').replaceChildren(...Object.entries(themes).map(([value, name]) => new Option(name, value)));
  $('#code-theme').replaceChildren(...Object.entries(codeThemes).map(([value, theme]) => new Option(theme.name, value)));
  try {
    const current = localStorage.getItem(settingsKey), previous = localStorage.getItem(previousSettingsKey);
    const older = localStorage.getItem(olderSettingsKey);
    const stored = JSON.parse(current || previous || older || localStorage.getItem(legacySettingsKey) || 'null') || {};
    if (!current) {
      if (!previous && !older && stored.accent?.toLowerCase() === '#18745b') stored.accent = defaults.accent;
      stored.codeWrap = defaults.codeWrap;
    }
    settings = normalizeSettings(stored);
  } catch { /* Settings are optional. */ }
  input.value = window.MOTIE_SAMPLE;
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey) || 'null');
    if (saved && typeof saved.markdown === 'string' && saved.markdown.length <= 300000) { input.value = saved.markdown; sourceName = '本机草稿'; $('#save-draft').checked = true; }
  } catch { /* Continue without a draft. */ }

  function icons(root = document) { window.lucide.createIcons({ root, attrs: { 'stroke-width': 1.6 } }); }
  function notify(message) { const node = $('#toast'); node.textContent = message; node.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { node.hidden = true; }, 4200); }
  function show(id) { const dialog = document.getElementById(id); if (!dialog.open) dialog.showModal(); }
  function saveSettings() { try { localStorage.setItem(settingsKey, JSON.stringify(settings)); } catch { /* Storage may be unavailable. */ } }
  function saveDraft() {
    $('#draft-status').textContent = $('#save-draft').checked ? '正在保存' : '仅本页处理';
    if (!$('#save-draft').checked) return;
    try { localStorage.setItem(draftKey, JSON.stringify({ markdown: input.value, updated: Date.now() })); $('#draft-status').textContent = '草稿已保存在本机'; }
    catch { $('#draft-status').textContent = '草稿未保存'; notify('本机存储不可用或已满，建议下载 Markdown。'); }
  }
  function updateHistory(force = false) {
    const text = input.value;
    if (history[historyIndex] === text) return;
    history = history.slice(0, historyIndex + 1);
    const now = Date.now();
    if (!force && historyIndex > 0 && now - lastHistoryTime < 600) history[historyIndex] = text;
    else { history.push(text); if (history.length > 60) history.shift(); historyIndex = history.length - 1; }
    lastHistoryTime = now; updateHistoryButtons();
  }
  function updateHistoryButtons() { $('#undo-button').disabled = historyIndex <= 0; $('#redo-button').disabled = historyIndex >= history.length - 1; }
  function rememberSelection() { savedSelection = { start: input.selectionStart, end: input.selectionEnd }; }
  function travelHistory(direction) { const next = historyIndex + direction; if (next < 0 || next >= history.length) return; historyIndex = next; input.value = history[next]; updateHistoryButtons(); sourceName = '你的文章'; run(); }
  function replaceText(text, name) { updateHistory(true); input.value = text; sourceName = name || '你的文章'; updateHistory(true); run(); }
  function confirmReplace(title, callback) { $('#confirm-title').textContent = title; $('#confirm-message').textContent = '当前内容可以通过撤销恢复。'; pendingConfirm = callback; show('confirm-dialog'); }
  function installSettings() {
    $('#theme-select').value = settings.theme; $('#accent-color').value = settings.accent;
    $('#article-style-help').textContent = themeDescriptions[settings.theme];
    $('#font-size').value = settings.fontSize;
    if (![...$('#line-height').options].some(option => Number(option.value) === settings.lineHeight)) settings.lineHeight = 1.85;
    $('#line-height').value = String(settings.lineHeight);
    $('#paragraph-spacing').value = String(settings.paragraphSpacing); $('#image-captions').checked = settings.imageCaptions;
    $('#code-theme').value = settings.codeTheme; $('#code-wrap').checked = settings.codeWrap; $('#link-footnotes').checked = settings.linkFootnotes; $('#hide-heading').checked = settings.hideFirstHeading;
    document.querySelectorAll('[data-color]').forEach(button => { const selected = button.dataset.color.toLowerCase() === settings.accent.toLowerCase(); button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
  }
  function updateStats() {
    $('#source-count').textContent = `${input.value.length.toLocaleString()} 字符`; $('#source-name').textContent = sourceName;
    $('#article-count').textContent = `${result?.stats.characters.toLocaleString() || 0} 字`;
    $('#read-time').textContent = `约 ${result?.stats.minutes || 1} 分钟`;
    $('#image-count').textContent = result?.images.length || 0;
    const issues = allWarnings(); $('#warning-badge').textContent = issues.length;
    $('#issue-count').textContent = issues.length ? `${issues.length} 项需复核` : '排版检查';
  }
  function allWarnings() { return [...new Set([...(result?.warnings || []), ...runtimeWarnings])]; }
  function checkPreviewImages() {
    previewContent.querySelectorAll('img').forEach(img => {
      if (!img.complete) return;
      if (!img.naturalWidth) { runtimeWarnings.add('有图片在当前浏览器中无法加载，请检查来源或在图片管理中替换。'); updateStats(); }
    });
  }

  function run() {
    clearTimeout(timer); runtimeWarnings.clear();
    try {
      result = render(input.value, settings, assets);
      previewContent.innerHTML = result.html;
      updateOutline();
      if (!settings.codeWrap) previewContent.querySelectorAll('pre').forEach(pre => {
        const scroller = pre.querySelector('code');
        scroller.classList.add('code-scroll'); scroller.tabIndex = 0;
        scroller.style.setProperty('--code-scrollbar-thumb', codeThemes[settings.codeTheme].scrollbar);
        scroller.setAttribute('aria-label', '代码块，可用方向键横向查看');
      });
      previewContent.querySelectorAll('a').forEach(anchor => anchor.addEventListener('click', event => event.preventDefault()));
      previewContent.querySelectorAll('img').forEach(img => {
        if (img.complete) checkPreviewImages();
        else { img.addEventListener('load', checkPreviewImages, { once: true }); img.addEventListener('error', checkPreviewImages, { once: true }); }
      });
      $('#render-error').hidden = true; $('#preview-empty').hidden = Boolean(input.value.trim());
      $('#copy-button').disabled = !input.value.trim() || copying; $('#html-button').disabled = !input.value.trim();
    } catch (error) {
      result = null; previewContent.replaceChildren();
      updateOutline();
      $('#render-error').textContent = error.message; $('#render-error').hidden = false;
      $('#copy-button').disabled = true; $('#html-button').disabled = true;
    }
    updateStats(); saveDraft();
    if ($('#images-dialog').open) renderImages();
    if ($('#issues-dialog').open) renderIssues();
  }
  function updateOutline() {
    outlineTargets = [...previewContent.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    $('#heading-count').textContent = outlineTargets.length;
    $('#outline-list').replaceChildren();
    if (!outlineTargets.length) {
      const empty = document.createElement('p'); empty.className = 'outline-empty'; empty.textContent = '文章中没有标题。'; $('#outline-list').append(empty); return;
    }
    outlineTargets.forEach((heading, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'outline-item';
      button.dataset.outlineIndex = index; button.style.setProperty('--outline-depth', Math.min(4, Number(heading.tagName[1]) - 1));
      button.title = heading.textContent.trim(); button.textContent = heading.textContent.trim(); $('#outline-list').append(button);
    });
  }
  function jumpToHeading(index) {
    const heading = outlineTargets[index]; if (!heading) return;
    setView('preview');
    const viewport = $('#preview-scroll');
    const top = heading.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop - 18;
    viewport.scrollTop = Math.max(0, top);
    heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true });
  }
  function queueRun() { clearTimeout(timer); timer = setTimeout(run, 200); }
  function setDevice(mode) {
    device = mode; $('.workspace').dataset.previewDevice = mode;
    $('.preview-scroll').style.setProperty('--preview-width', `${articleWidths[mode]}px`);
    $('.preview-scroll').classList.toggle('desktop-preview', mode === 'desktop');
    $('#preview-width').textContent = `${articleWidths[mode]} px`; $('#preview-size').textContent = mode === 'mobile' ? '手机正文' : '公众号电脑正文';
    document.querySelectorAll('[data-device]').forEach(button => { const active = button.dataset.device === mode; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    $('#preview-scroll').scrollLeft = 0;
    updatePreviewWidth();
  }
  function updatePreviewWidth() {
    const viewport = $('#preview-scroll');
    viewport.classList.toggle('has-horizontal-overflow', device === 'desktop' && viewport.scrollWidth > viewport.clientWidth + 1);
    const width = previewContent.getBoundingClientRect().width;
    if (width) $('#preview-width').textContent = `${Math.round(width)} px`;
  }
  function setView(view) {
    $('.workspace').dataset.mobileView = view;
    document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.view === view)));
    $('.workspace').classList.remove('settings-open'); $('[data-action="settings"]').setAttribute('aria-expanded', 'false');
    updatePreviewWidth();
  }
  function download(content, type, filename) {
    const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function filename(ext) { return `${(result?.title || '墨贴文章').replace(/[\\/:*?"<>|]/g, '').slice(0, 60) || '墨贴文章'}.${ext}`; }
  function selectionCopy(html, text) {
    const stage = document.createElement('div'); stage.contentEditable = 'true'; stage.innerHTML = html;
    stage.style.cssText = `position:fixed;left:-10000px;top:0;width:${articleWidths.desktop}px;background:#fff;`; document.body.append(stage);
    const selection = window.getSelection(); const savedRanges = [];
    for (let i = 0; i < (selection?.rangeCount || 0); i++) savedRanges.push(selection.getRangeAt(i).cloneRange());
    const range = document.createRange(); range.selectNodeContents(stage); selection?.removeAllRanges(); selection?.addRange(range);
    let richWritten = false;
    const onCopy = event => { if (!event.clipboardData) return; event.clipboardData.setData('text/html', html); event.clipboardData.setData('text/plain', text); event.preventDefault(); richWritten = true; };
    document.addEventListener('copy', onCopy);
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { /* Browser might forbid legacy copy. */ }
    document.removeEventListener('copy', onCopy); stage.remove(); selection?.removeAllRanges(); savedRanges.forEach(saved => selection?.addRange(saved));
    return copied && richWritten;
  }
  async function copyArticle() {
    if (copying) return;
    run(); if (!result || !input.value.trim()) return;
    const snapshot = result;
    copying = true; $('#copy-button').disabled = true; $('#copy-label').textContent = '复制中…';
    let done = false;
    try {
      if (window.isSecureContext && navigator.clipboard?.write && window.ClipboardItem) {
        const item = new ClipboardItem({ 'text/html': new Blob([snapshot.html], { type: 'text/html' }), 'text/plain': new Blob([snapshot.plainText], { type: 'text/plain' }) });
        await navigator.clipboard.write([item]); done = true;
      }
    } catch { /* A selection-copy fallback remains available. */ }
    if (!done) done = selectionCopy(snapshot.html, snapshot.plainText);
    copying = false; $('#copy-button').disabled = !result || !input.value.trim(); $('#copy-label').textContent = done ? '已复制' : '复制到公众号';
    if (done) notify(snapshot.images.length ? '排版已复制。到公众号正文正常粘贴后，请逐张检查图片。' : '排版已复制，可到公众号正文编辑区正常粘贴。');
    else { notify('浏览器未允许富文本复制。请在 HTTPS / localhost 打开，或导出 HTML 后用浏览器选中正文复制。'); show('help-dialog'); }
    setTimeout(() => { if (!copying) $('#copy-label').textContent = '复制到公众号'; }, 2500);
  }

  async function readMarkdown(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { notify('Markdown 文件超过 2 MB，请拆分后导入。'); return; }
    try {
      const text = await file.text();
      if (text.length > 300000) { notify('文章超过 30 万字符，请拆分后导入。'); return; }
      if (input.value !== window.MOTIE_SAMPLE && input.value.trim()) confirmReplace('导入文件并替换正文？', () => replaceText(text, file.name));
      else replaceText(text, file.name);
    } catch { notify('文件读取失败。'); }
    $('#markdown-file').value = '';
  }
  function readDataURL(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('图片读取失败。')); reader.readAsDataURL(file); }); }
  async function prepareImage(file) {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('仅支持 PNG、JPG、WebP、GIF；SVG 不会作为正文图片插入。');
    if (file.size > 5 * 1024 * 1024) throw new Error('单张图片超过 5 MB，请压缩后再插入。');
    const dataUrl = await readDataURL(file);
    return { dataUrl, name: file.name, kind: 'local', originalFile: file };
  }
  async function insertImages(files, replace = null, position = null) {
    if (!files?.length) return;
    let successful = 0;
    let insertion = position || savedSelection;
    for (const file of [...files].slice(0, 20)) {
      try {
        const asset = await prepareImage(file);
        if (replace) { assets.set(replace, asset); successful++; break; }
        const key = `motie-local-${Date.now()}-${++localCounter}.${file.type.split('/')[1]}`;
        assets.set(key, asset);
        const alt = file.name.replace(/\.[^.]+$/, '').replace(/[\[\]\\\n]/g, ' ');
        const start = Math.min(insertion.start, input.value.length), end = Math.min(insertion.end, input.value.length);
        const before = input.value.slice(0, start), after = input.value.slice(end);
        const prefix = before && !before.endsWith('\n') ? '\n\n' : before.endsWith('\n\n') || !before ? '' : '\n';
        const suffix = after && !after.startsWith('\n') ? '\n\n' : after.startsWith('\n\n') || !after ? '' : '\n';
        const text = `${prefix}![${alt}](${key})${suffix}`;
        input.setRangeText(text, start, end, 'end');
        insertion = { start: start + text.length, end: start + text.length };
        updateHistory(true); successful++;
      } catch (error) { notify(error.message); }
    }
    if (successful) { sourceName = '你的文章'; run(); if (!replace) { input.focus(); input.setSelectionRange(insertion.start, insertion.end); savedSelection = insertion; } notify(replace ? '图片已替换，原始 Markdown 路径保留。' : `已插入 ${successful} 张图片；请确认公众号中的图片。`); }
    $('#image-file').value = ''; $('#replace-file').value = '';
  }
  function renderImages() {
    const images = result?.images || [];
    $('#images-description').textContent = `当前文章共 ${images.length} 张图片`;
    $('#image-list').innerHTML = images.length ? images.map((image, i) => `<div class="image-item"><img src="${escape(image.src || '')}" alt="${escape(image.alt)}"><div class="image-info"><strong>${escape(image.alt)}</strong><code title="${escape(image.original)}">${escape(image.original.startsWith('data:') ? '内嵌图片' : image.original)}</code><small>${image.valid ? image.kind === 'local' ? '本地 / 内嵌 · 需在公众号确认接收' : '外链 · 需确认公众号可抓取' : '路径不可用 · 请替换'}</small><input class="image-url-input" data-image-url="${i}" type="url" placeholder="替换为可访问的 https:// 图片地址" aria-label="图片 ${i + 1} 的新地址"></div><div class="image-controls"><button class="icon-button" data-replace-image="${i}" title="替换本地图片" aria-label="替换本地图片">${icon('image-up')}</button><button class="icon-button" data-apply-url="${i}" title="应用新图片地址" aria-label="应用新图片地址">${icon('check')}</button><button class="icon-button" data-save-image="${i}" title="下载本地原图" aria-label="下载本地原图" ${image.kind === 'local' && image.valid ? '' : 'disabled'}>${icon('download')}</button></div></div>`).join('') : '<p class="context-note">当前正文没有图片，可使用“插入图片”选择本地文件。</p>';
    icons($('#images-dialog'));
  }
  function renderIssues() {
    const warnings = allWarnings();
    $('#issues-list').innerHTML = warnings.length ? warnings.map(warning => `<li>${icon('triangle-alert')}<span>${escape(warning)}</span></li>`).join('') : `<li>${icon('circle-check')}<span>未发现需要额外处理的内容。粘贴后仍请检查公众号最终效果。</span></li>`;
    $('#check-summary').textContent = result ? `正文 ${result.stats.characters} 字 · ${result.stats.headings} 个标题 · ${result.stats.codeBlocks} 个代码块 · ${result.stats.tables} 张表格 · ${result.stats.images} 张图片。样式已写入 HTML 元素，不依赖外部 CSS。` : '请先输入有效内容。';
    icons($('#issues-dialog'));
  }

  input.addEventListener('input', () => { sourceName = '你的文章'; rememberSelection(); updateHistory(); queueRun(); });
  input.addEventListener('click', rememberSelection);
  input.addEventListener('keyup', rememberSelection);
  input.addEventListener('select', rememberSelection);
  input.addEventListener('blur', rememberSelection);
  input.addEventListener('keydown', event => {
    if (event.key === 'Tab') { event.preventDefault(); input.setRangeText('  ', input.selectionStart, input.selectionEnd, 'end'); rememberSelection(); updateHistory(true); queueRun(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); travelHistory(event.shiftKey ? 1 : -1); }
  });
  input.addEventListener('paste', event => {
    const clipboard = event.clipboardData;
    const files = [...(clipboard?.items || [])].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean);
    const images = files.length ? files : [...(clipboard?.files || [])].filter(file => file.type.startsWith('image/'));
    if (!images.length) return;
    event.preventDefault();
    const position = { start: input.selectionStart, end: input.selectionEnd };
    insertImages(images, null, position);
  });
  let dragDepth = 0;
  $('.source-body').addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; $('#drop-hint').hidden = false; });
  $('.source-body').addEventListener('dragover', event => event.preventDefault());
  $('.source-body').addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('#drop-hint').hidden = true; } });
  $('.source-body').addEventListener('drop', event => {
    event.preventDefault(); dragDepth = 0; $('#drop-hint').hidden = true;
    const files = [...event.dataTransfer.files]; const md = files.find(file => /\.(?:md|markdown|txt)$/i.test(file.name));
    if (md) readMarkdown(md); else insertImages(files);
  });
  $('#markdown-file').addEventListener('change', event => readMarkdown(event.target.files[0]));
  $('#image-file').addEventListener('change', event => insertImages(event.target.files));
  $('#replace-file').addEventListener('change', event => { if (replaceKey) insertImages(event.target.files, replaceKey); });
  $('#save-draft').addEventListener('change', () => {
    if (!$('#save-draft').checked) { try { localStorage.removeItem(draftKey); } catch { /* Ignore unavailable storage. */ } $('#draft-status').textContent = '仅本页处理'; notify('已关闭草稿保存，并移除本工具保存的正文草稿。'); }
    else { saveDraft(); notify('仅将 Markdown 保存在本机；本地图片刷新后需重新选择。'); }
  });
  document.addEventListener('change', event => {
    const fields = { 'theme-select': 'theme', 'accent-color': 'accent', 'font-size': 'fontSize', 'line-height': 'lineHeight', 'paragraph-spacing': 'paragraphSpacing', 'image-captions': 'imageCaptions', 'code-theme': 'codeTheme', 'code-wrap': 'codeWrap', 'link-footnotes': 'linkFootnotes', 'hide-heading': 'hideFirstHeading' };
    const key = fields[event.target.id]; if (!key) return;
    settings[key] = event.target.type === 'checkbox' ? event.target.checked : ['fontSize', 'lineHeight', 'paragraphSpacing'].includes(key) ? Number(event.target.value) : event.target.value;
    settings = normalizeSettings(settings); installSettings(); saveSettings(); run();
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.close) document.getElementById(button.dataset.close).close();
    if (button.dataset.device) setDevice(button.dataset.device);
    if (button.dataset.view) setView(button.dataset.view);
    if (button.dataset.color) { settings.accent = button.dataset.color; installSettings(); saveSettings(); run(); }
    if (button.dataset.outlineIndex !== undefined) jumpToHeading(Number(button.dataset.outlineIndex));
    if (button.dataset.replaceImage !== undefined) { replaceKey = result?.images[Number(button.dataset.replaceImage)]?.original; $('#replace-file').click(); }
    if (button.dataset.applyUrl !== undefined) {
      const index = Number(button.dataset.applyUrl), image = result?.images[index], url = safeUrl($(`[data-image-url="${index}"]`).value, true);
      if (!/^https?:/i.test(url)) notify('请输入完整的 HTTP / HTTPS 图片地址。');
      else if (image) { assets.set(image.original, { dataUrl: url, kind: 'remote', name: image.alt }); run(); notify('已更新图片地址，请检查预览。'); }
    }
    if (button.dataset.saveImage !== undefined) { const image = result?.images[Number(button.dataset.saveImage)], asset = image && assets.get(image.original); if (image?.kind === 'local' && image.valid) { const a = document.createElement('a'); a.href = image.src; a.download = asset?.name || 'image.png'; document.body.append(a); a.click(); a.remove(); } }
    const action = button.dataset.action;
    if (action === 'undo') travelHistory(-1);
    if (action === 'redo') travelHistory(1);
    if (action === 'preview-top') { $('#preview-scroll').scrollTop = 0; $('#preview-scroll').focus({ preventScroll: true }); }
    if (action === 'copy') copyArticle();
    if (action === 'source-menu') { $('#source-menu').hidden = !$('#source-menu').hidden; button.setAttribute('aria-expanded', String(!$('#source-menu').hidden)); }
    if (action === 'import') $('#markdown-file').click();
    if (action === 'image') $('#image-file').click();
    if (action === 'sample') confirmReplace('载入示例并替换正文？', () => { addSampleAsset(); replaceText(window.MOTIE_SAMPLE, '示例文章'); });
    if (action === 'clear') confirmReplace('清空当前正文？', () => { replaceText('', '空白文章'); input.focus(); });
    if (action === 'save-md') download(input.value, 'text/markdown;charset=utf-8', filename('md'));
    if (action === 'download-html') { run(); if (result) { download(exportDocument(result), 'text/html;charset=utf-8', filename('html')); notify('已导出带内联样式的 HTML。'); } }
    if (action === 'reset-style') { settings = { ...defaults }; installSettings(); saveSettings(); run(); notify('已恢复默认排版。'); }
    if (action === 'images') { renderImages(); show('images-dialog'); }
    if (action === 'issues') { renderIssues(); show('issues-dialog'); }
    if (action === 'help') show('help-dialog');
    if (action === 'settings') { const open = $('.workspace').classList.toggle('settings-open'); button.setAttribute('aria-expanded', String(open)); }
    if (button.id === 'confirm-button') { $('#confirm-dialog').close(); const callback = pendingConfirm; pendingConfirm = null; callback?.(); }
    if (action && action !== 'source-menu') { $('#source-menu').hidden = true; $('[data-action="source-menu"]').setAttribute('aria-expanded', 'false'); }
  });
  document.addEventListener('click', event => { if (!event.target.closest('.menu-wrap')) { $('#source-menu').hidden = true; $('[data-action="source-menu"]').setAttribute('aria-expanded', 'false'); } });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { $('#source-menu').hidden = true; $('.workspace').classList.remove('settings-open'); $('[data-action="settings"]').setAttribute('aria-expanded', 'false'); }
  });
  window.addEventListener('resize', () => requestAnimationFrame(updatePreviewWidth));
  if (window.ResizeObserver) {
    const previewResizeObserver = new ResizeObserver(() => requestAnimationFrame(updatePreviewWidth));
    previewResizeObserver.observe(previewContent);
    previewResizeObserver.observe($('#preview-scroll'));
  }
  installSettings(); updateHistory(true); icons(); setDevice(device); run();
})();
