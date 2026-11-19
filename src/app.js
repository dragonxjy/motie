(function () {
  'use strict';
  const { render, exportDocument, normalizeSettings, defaults, themes, themeDescriptions, codeThemes, articleWidths, safeUrl } = window.Motie;
  const { imageType, isMarkdown, isLocalReference, fromFiles, createLibrary, collectTransfer } = window.MotieLocalFiles;
  const $ = selector => document.querySelector(selector);
  const input = $('#markdown-input');
  const previewContent = $('#preview-content');
  const assets = new Map();
  const localFiles = createLibrary();
  let resolvedAssets = new Map(), markdownPath = '', renderRevision = 0, pendingImport = null, imageResolution = Promise.resolve();
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
    if (history[historyIndex]?.text === text && history[historyIndex]?.path === markdownPath) return;
    history = history.slice(0, historyIndex + 1);
    const now = Date.now();
    const entry = { text, path: markdownPath };
    if (!force && historyIndex > 0 && now - lastHistoryTime < 600) history[historyIndex] = entry;
    else { history.push(entry); if (history.length > 60) history.shift(); historyIndex = history.length - 1; }
    lastHistoryTime = now; updateHistoryButtons();
  }
  function updateHistoryButtons() { $('#undo-button').disabled = historyIndex <= 0; $('#redo-button').disabled = historyIndex >= history.length - 1; }
  function rememberSelection() { savedSelection = { start: input.selectionStart, end: input.selectionEnd }; }
  function travelHistory(direction) { const next = historyIndex + direction; if (next < 0 || next >= history.length) return; historyIndex = next; input.value = history[next].text; markdownPath = history[next].path; updateHistoryButtons(); sourceName = '你的文章'; run(); }
  function replaceText(text, name, path = '') { updateHistory(true); input.value = text; markdownPath = path; sourceName = name || '你的文章'; updateHistory(true); run(); }
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
  function allWarnings() {
    const fileWarnings = (result?.images || []).filter(image => !image.valid).flatMap(image => {
      const match = localFiles.find(image.original, markdownPath);
      if (match.record?.error) return [`图片「${image.alt}」：${match.record.error}`];
      if (match.status === 'ambiguous') return [`图片「${image.alt}」有多个同名原图，请在图片管理中选择对应文件。`];
      return [];
    });
    return [...new Set([...(result?.warnings || []), ...fileWarnings, ...runtimeWarnings])];
  }
  function checkPreviewImages() {
    previewContent.querySelectorAll('img').forEach(img => {
      if (!img.complete) return;
      if (!img.naturalWidth) { runtimeWarnings.add('有图片在当前浏览器中无法加载，请检查来源或在图片管理中替换。'); updateStats(); }
    });
  }

  function run() {
    const revision = ++renderRevision;
    clearTimeout(timer); runtimeWarnings.clear();
    try {
      const articleAssets = new Map(assets);
      for (const [original, record] of resolvedAssets) {
        if (!assets.has(original) && localFiles.find(original, markdownPath).record === record) articleAssets.set(original, record.asset);
      }
      result = render(input.value, settings, articleAssets);
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
    updateLocalStatus();
    if (result) imageResolution = resolveLocalImages(result.images, revision);
  }

  function updateLocalStatus() {
    const images = result?.images || [];
    const unresolved = images.filter(image => !image.valid && isLocalReference(image.original));
    const ambiguous = unresolved.filter(image => localFiles.find(image.original, markdownPath).status === 'ambiguous');
    const loading = unresolved.filter(image => {
      const record = localFiles.find(image.original, markdownPath).record;
      return record && !record.error;
    });
    const failed = unresolved.filter(image => localFiles.find(image.original, markdownPath).record?.error);
    const matched = images.filter(image => image.valid && resolvedAssets.has(image.original)).length;
    const status = $('#local-image-status');
    status.textContent = loading.length ? `正在加载 ${loading.length} 张引用图片…`
      : failed.length ? `${failed.length} 张图片无法加载，查看图片管理`
      : ambiguous.length ? `${ambiguous.length} 张图片重名，需在图片管理中选择`
      : unresolved.length ? `${matched ? `${matched} 张已匹配 · ` : ''}${unresolved.length} 张图片待补齐`
      : matched ? `${matched} 张引用图片已匹配`
      : localFiles.size ? `已载入 ${localFiles.size} 张图片，可粘贴 Markdown`
      : '粘贴 Markdown，再导入配套图片';
    status.title = unresolved.map(image => image.original).join('\n') || status.textContent;
    status.classList.toggle('needs-images', unresolved.length > loading.length);
    $('#copy-button').disabled = !result || !input.value.trim() || copying || loading.length > 0;
    $('#html-button').disabled = !result || !input.value.trim() || loading.length > 0;
  }
  async function resolveLocalImages(images, revision) {
    const resolved = new Map();
    for (const original of new Set(images.map(image => image.original))) {
      if (assets.has(original)) continue;
      const record = localFiles.find(original, markdownPath).record;
      if (!record || record.error) continue;
      try {
        record.pending ||= prepareImage(record.file).then(asset => { record.asset = asset; return asset; });
        await record.pending;
        if (revision !== renderRevision) return;
        resolved.set(original, record);
      } catch (error) {
        record.error = error.message;
        if (revision !== renderRevision) return;
      }
    }
    if (revision !== renderRevision) return;
    const changed = resolved.size !== resolvedAssets.size || [...resolved].some(([key, record]) => resolvedAssets.get(key) !== record);
    resolvedAssets = resolved;
    if (changed) { run(); return imageResolution; }
    else { updateLocalStatus(); updateStats(); if ($('#images-dialog').open) renderImages(); if ($('#issues-dialog').open) renderIssues(); }
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
    run();
    if ($('#copy-button').disabled && result && input.value.trim()) await imageResolution;
    if (!result || !input.value.trim()) return;
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
  async function downloadHtml() {
    run();
    if ($('#html-button').disabled && result && input.value.trim()) await imageResolution;
    if (result) { download(exportDocument(result), 'text/html;charset=utf-8', filename('html')); notify('已导出带内联样式的 HTML。'); }
  }

  async function readMarkdown(file, path = file?.name) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { notify('Markdown 文件超过 2 MB，请拆分后导入。'); return; }
    try {
      const text = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('文件读取失败。')); reader.readAsText(file); });
      if (text.length > 300000) { notify('文章超过 30 万字符，请拆分后导入。'); return; }
      if (input.value !== window.MOTIE_SAMPLE && input.value.trim()) confirmReplace('导入文件并替换正文？', () => replaceText(text, file.name, path));
      else replaceText(text, file.name, path);
    } catch { notify('文件读取失败。'); }
    $('#markdown-file').value = '';
  }
  async function importFiles(records, { matchOnly = false, position = null, text = '' } = {}) {
    const images = records.filter(record => imageType(record.file));
    const markdown = records.filter(record => isMarkdown(record.file));
    localFiles.add(images);
    if (markdown.length && !matchOnly) {
      run();
      if (markdown.length === 1) await readMarkdown(markdown[0].file, markdown[0].path);
      else {
        pendingImport = markdown;
        $('#import-description').textContent = `发现 ${markdown.length} 份正文，选择要打开的 Markdown。配套图片已载入。`;
        $('#markdown-choices').replaceChildren(...markdown.map((record, index) => {
          const button = document.createElement('button'); button.className = 'markdown-choice'; button.dataset.importMarkdown = index;
          button.textContent = record.path; return button;
        }));
        show('import-dialog');
      }
      return;
    }
    if (text) {
      updateHistory(true);
      const start = Math.min(position.start, input.value.length), end = Math.min(position.end, input.value.length);
      input.setRangeText(text, start, end, 'end');
      sourceName = '你的文章'; rememberSelection(); updateHistory(true);
    }
    run();
    const used = new Set((result?.images || []).flatMap(image => {
      const match = localFiles.find(image.original, markdownPath);
      return match.record ? [match.record.file] : (match.records || []).map(record => record.file);
    }));
    const unused = images.filter(record => !used.has(record.file));
    if (!matchOnly && !text && unused.length) await insertImages(unused.map(record => record.file), null, position);
    else if (images.length) notify(`已载入 ${images.length} 张图片，按 Markdown 引用自动匹配。`);
    else if (!text) notify('未找到 Markdown 或 PNG、JPG、WebP、GIF 图片，请选择包含原图的文件夹。');
  }
  async function importTransfer(transfer, { position, text = '' } = {}) {
    try {
      const { records, hasDirectory, errors } = await collectTransfer(transfer);
      if (!records.length) {
        if (text && !/^file:\/\//i.test(text.trim())) await importFiles([], { position, text });
        else notify('浏览器未提供文件内容，请点击“导入文件夹”或拖入文件夹。');
      } else await importFiles(records, { position, text: /^file:\/\//i.test(text.trim()) ? '' : text, matchOnly: hasDirectory && !records.some(record => isMarkdown(record.file)) });
      if (errors.length) notify(`${errors.length} 项读取失败，请重新选择文件夹或在图片管理中补图。`);
    } catch { notify('文件读取失败，请使用“导入文件夹”重新选择。'); }
  }
  function readDataURL(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('图片读取失败。')); reader.readAsDataURL(file); }); }
  async function prepareImage(file) {
    const type = imageType(file);
    if (!type) throw new Error('仅支持 PNG、JPG、WebP、GIF；SVG 不会作为正文图片插入。');
    if (file.size > 5 * 1024 * 1024) throw new Error('单张图片超过 5 MB，请压缩后再插入。');
    const dataUrl = await readDataURL(file.type === type ? file : new Blob([file], { type }));
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
        const key = `motie-local-${Date.now()}-${++localCounter}.${imageType(file).split('/')[1]}`;
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
    $('#images-description').textContent = `当前文章共 ${images.length} 张图片，${images.filter(image => !image.valid).length} 张待补齐`;
    $('#image-list').innerHTML = images.length ? images.map((image, i) => {
      const match = localFiles.find(image.original, markdownPath);
      const status = image.valid ? image.kind === 'local' ? '本地 / 内嵌 · 需在公众号确认接收' : '外链 · 需确认公众号可抓取'
        : match.record?.error || (match.status === 'ambiguous' ? '存在同名图片，请手动选择对应原图' : '导入配套图片文件夹，或手动替换');
      return `<div class="image-item">${image.src ? `<img src="${escape(image.src)}" alt="${escape(image.alt)}">` : `<span class="image-placeholder" aria-hidden="true">${icon('image-off')}</span>`}<div class="image-info"><strong>${escape(image.alt)}</strong><code title="${escape(image.original)}">${escape(image.original.startsWith('data:') ? '内嵌图片' : image.original)}</code><small>${escape(status)}</small><input class="image-url-input" data-image-url="${i}" type="url" placeholder="替换为可访问的 https:// 图片地址" aria-label="图片 ${i + 1} 的新地址"></div><div class="image-controls"><button class="icon-button" data-replace-image="${i}" title="替换本地图片" aria-label="替换本地图片">${icon('image-up')}</button><button class="icon-button" data-apply-url="${i}" title="应用新图片地址" aria-label="应用新图片地址">${icon('check')}</button><button class="icon-button" data-save-image="${i}" title="下载本地原图" aria-label="下载本地原图" ${image.kind === 'local' && image.valid ? '' : 'disabled'}>${icon('download')}</button></div></div>`;
    }).join('') : '<p class="context-note">可先粘贴 Markdown，再导入配套图片文件夹自动匹配。</p>';
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
    if (![...(clipboard?.items || [])].some(item => item.kind === 'file') && !clipboard?.files?.length) return;
    event.preventDefault();
    const position = { start: input.selectionStart, end: input.selectionEnd };
    importTransfer(clipboard, { position, text: clipboard.getData?.('text/plain') || '' });
  });
  let dragDepth = 0;
  $('.source-body').addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; $('#drop-hint').hidden = false; });
  $('.source-body').addEventListener('dragover', event => event.preventDefault());
  $('.source-body').addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('#drop-hint').hidden = true; } });
  $('.source-body').addEventListener('drop', event => {
    event.preventDefault(); dragDepth = 0; $('#drop-hint').hidden = true;
    const position = { start: input.selectionStart, end: input.selectionEnd };
    const text = event.dataTransfer?.getData?.('text/plain') || '';
    if (!event.dataTransfer?.files?.length && ![...(event.dataTransfer?.items || [])].some(item => item.kind === 'file')) {
      if (text) importFiles([], { position, text });
    } else importTransfer(event.dataTransfer, { position, text });
  });
  $('#markdown-file').addEventListener('change', event => { const records = fromFiles(event.target.files); event.target.value = ''; importFiles(records); });
  $('#folder-file').addEventListener('change', event => { const records = fromFiles(event.target.files); event.target.value = ''; if (records.length) importFiles(records, { matchOnly: !records.some(record => isMarkdown(record.file)) }); });
  $('#match-image-file').addEventListener('change', event => { const records = fromFiles(event.target.files); event.target.value = ''; if (records.length) importFiles(records, { matchOnly: true }); });
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
    if (button.dataset.importMarkdown !== undefined) {
      const record = pendingImport?.[Number(button.dataset.importMarkdown)];
      pendingImport = null; $('#import-dialog').close();
      if (record) readMarkdown(record.file, record.path);
    }
    if (button.dataset.replaceImage !== undefined) { replaceKey = result?.images[Number(button.dataset.replaceImage)]?.original; $('#replace-file').click(); }
    if (button.dataset.applyUrl !== undefined) {
      const index = Number(button.dataset.applyUrl), image = result?.images[index], url = safeUrl($(`[data-image-url="${index}"]`).value, true);
      if (!/^https?:/i.test(url)) notify('请输入完整的 HTTP / HTTPS 图片地址。');
      else if (image) { assets.set(image.original, { dataUrl: url, kind: 'remote', name: image.alt }); run(); notify('已更新图片地址，请检查预览。'); }
    }
    if (button.dataset.saveImage !== undefined) { const image = result?.images[Number(button.dataset.saveImage)], asset = image && (assets.get(image.original) || resolvedAssets.get(image.original)?.asset); if (image?.kind === 'local' && image.valid) { const a = document.createElement('a'); a.href = image.src; a.download = asset?.name || 'image.png'; document.body.append(a); a.click(); a.remove(); } }
    const action = button.dataset.action;
    if (action === 'undo') travelHistory(-1);
    if (action === 'redo') travelHistory(1);
    if (action === 'preview-top') { $('#preview-scroll').scrollTop = 0; $('#preview-scroll').focus({ preventScroll: true }); }
    if (action === 'copy') copyArticle();
    if (action === 'source-menu') { $('#source-menu').hidden = !$('#source-menu').hidden; button.setAttribute('aria-expanded', String(!$('#source-menu').hidden)); }
    if (action === 'import') $('#markdown-file').click();
    if (action === 'folder') $('#folder-file').click();
    if (action === 'match-images') $('#match-image-file').click();
    if (action === 'image') $('#image-file').click();
    if (action === 'sample') confirmReplace('载入示例并替换正文？', () => { addSampleAsset(); replaceText(window.MOTIE_SAMPLE, '示例文章'); });
    if (action === 'clear') confirmReplace('清空当前正文？', () => { replaceText('', '空白文章'); input.focus(); });
    if (action === 'save-md') download(input.value, 'text/markdown;charset=utf-8', filename('md'));
    if (action === 'download-html') downloadHtml();
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
