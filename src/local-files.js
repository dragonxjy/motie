(function (root) {
  'use strict';
  const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  const extensions = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

  function imageType(file) {
    if (imageTypes.has(file.type)) return file.type;
    if (file.type && file.type !== 'application/octet-stream') return '';
    const extension = file.name.split('.').pop().toLowerCase();
    return Object.hasOwn(extensions, extension) ? extensions[extension] : '';
  }
  function isMarkdown(file) { return /\.(?:md|markdown|txt)$/i.test(file.name); }
  function normalizePath(value, decode = false) {
    let path = String(value);
    if (decode) { try { path = decodeURIComponent(path); } catch { /* Keep malformed percent escapes literal. */ } }
    const parts = [];
    for (const part of path.normalize('NFC').replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..' && parts.length && parts.at(-1) !== '..') parts.pop();
      else parts.push(part);
    }
    return parts.join('/');
  }
  function isLocalReference(value) {
    return Boolean(value) && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value);
  }
  function fromFiles(files) {
    return [...(files || [])].map(file => ({ file, path: normalizePath(file.webkitRelativePath || file.name) }));
  }
  function createLibrary() {
    const records = new Map();
    return {
      get size() { return [...records.values()].reduce((total, group) => total + group.length, 0); },
      add(files) {
        const batch = new Map();
        for (const record of files) {
          if (!imageType(record.file)) continue;
          const path = normalizePath(record.path);
          if (!batch.has(path)) batch.set(path, []);
          if (!batch.get(path).some(item => item.file === record.file)) batch.get(path).push({ ...record, path });
        }
        for (const [path, group] of batch) records.set(path, group);
      },
      find(reference, markdownPath = '') {
        if (!isLocalReference(reference)) return { status: 'external' };
        const path = normalizePath(reference.split(/[?#]/)[0], true);
        if (!path) return { status: 'missing' };
        const base = normalizePath(markdownPath).split('/').slice(0, -1).join('/');
        const target = normalizePath(base && !/^[\\/]/.test(reference) ? `${base}/${path}` : path);
        // The Markdown file's directory takes precedence over filename fallbacks.
        if (records.has(target)) {
          const group = records.get(target);
          return group.length === 1 ? { status: 'matched', record: group[0] } : { status: 'ambiguous', records: group };
        }
        if (records.has(path)) {
          const group = records.get(path);
          return group.length === 1 ? { status: 'matched', record: group[0] } : { status: 'ambiguous', records: group };
        }
        let candidates = [], best = 0;
        for (const record of [...records.values()].flat()) {
          let score = 0;
          for (const expected of new Set([target, path])) {
            if (record.path === expected || record.path.endsWith(`/${expected}`) || expected.endsWith(`/${record.path}`)) {
              score = Math.max(score, Math.min(record.path.split('/').length, expected.split('/').length));
            }
          }
          if (!score && record.path.split('/').at(-1) === path.split('/').at(-1)) score = 1;
          if (score > best) { best = score; candidates = [record]; }
          else if (score && score === best) candidates.push(record);
        }
        if (candidates.length === 1) return { status: 'matched', record: candidates[0] };
        return { status: candidates.length ? 'ambiguous' : 'missing', records: candidates };
      }
    };
  }

  async function collectTransfer(transfer) {
    // Capture every handle while the paste/drop event still grants access.
    const items = [...(transfer?.items || [])].filter(item => item.kind === 'file').map(item => ({
      entry: item.webkitGetAsEntry?.() || item.getAsEntry?.(), file: item.getAsFile?.()
    }));
    const fallback = fromFiles(transfer?.files);
    const records = [], errors = [];
    let hasDirectory = false;
    async function visit(entry, prefix = '') {
      const path = `${prefix}${entry.name}`;
      if (entry.isFile) {
        if (!isMarkdown(entry) && !/\.(?:png|jpe?g|webp|gif)$/i.test(entry.name)) return;
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        records.push({ file, path: normalizePath(path) });
      } else if (entry.isDirectory) {
        hasDirectory = true;
        const reader = entry.createReader();
        // Chromium returns directory contents in batches, often 100 at a time.
        for (;;) {
          const entries = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
          if (!entries.length) break;
          for (const child of entries) {
            try { await visit(child, `${path}/`); }
            catch { errors.push(`无法读取 ${path}/${child.name}`); }
          }
        }
      }
    }
    for (const item of items) {
      try {
        if (item.entry?.isFile && item.file) records.push(...fromFiles([item.file]));
        else if (item.entry) await visit(item.entry);
        else if (item.file) records.push(...fromFiles([item.file]));
      } catch {
        if (item.file) records.push(...fromFiles([item.file]));
        else errors.push('文件夹读取失败，请使用“导入文件夹”重新选择。');
      }
    }
    // Some clipboard implementations only expose FileList, without items.
    if (!records.length && !hasDirectory) records.push(...fallback);
    return { records, hasDirectory, errors };
  }

  root.MotieLocalFiles = { imageType, isMarkdown, isLocalReference, fromFiles, createLibrary, collectTransfer };
})(window);
