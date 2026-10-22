(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.Motie = factory(root.marked, root.DOMPurify, root.hljs, root.document);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (marked, purifier, hljs, document) {
  'use strict';
  const MAX_LENGTH = 300000;
  const defaults = Object.freeze({ theme: 'clean', accent: '#1c8feb', fontSize: 16, lineHeight: 1.85, paragraphSpacing: 18, imageCaptions: true, codeWrap: true, linkFootnotes: true, hideFirstHeading: false });
  const themes = Object.freeze({ clean: '简洁', editorial: '书刊', technical: '技术' });
  const escape = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const blockTags = ['p', 'section', 'article', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'blockquote', 'ul', 'ol', 'table', 'figure', 'hr'];
  const allowedTags = [...blockTags, 'span', 'br', 'strong', 'b', 'em', 'i', 'del', 's', 'u', 'code', 'a', 'img', 'li', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'figcaption', 'sup', 'sub', 'kbd', 'mark'];
  const palettes = {
    light: { keyword: '#a32956', built_in: '#925400', type: '#925400', literal: '#0d5db8', number: '#0d5db8', regexp: '#0b665b', string: '#0b665b', subst: '#313a46', symbol: '#8250b4', class: '#925400', function: '#8250b4', title: '#8250b4', params: '#313a46', comment: '#6b7787', quote: '#6b7787', doctag: '#a32956', meta: '#916000', attr: '#0d5db8', attribute: '#0d5db8', tag: '#a32956', name: '#a32956', selector: '#18745b', property: '#0d5db8', variable: '#925400', operator: '#505d6c', punctuation: '#505d6c', deletion: '#b42318', addition: '#18745b', bullet: '#0d5db8' }
  };

  function normalizeSettings(value = {}) {
    const color = /^#[0-9a-f]{6}$/i.test(value.accent || '') ? value.accent : defaults.accent;
    const spacing = [12, 18, 24].includes(Number(value.paragraphSpacing)) ? Number(value.paragraphSpacing) : defaults.paragraphSpacing;
    return { theme: Object.hasOwn(themes, value.theme) ? value.theme : defaults.theme, accent: color, fontSize: Math.min(20, Math.max(13, Number(value.fontSize) || defaults.fontSize)), lineHeight: Math.min(2.2, Math.max(1.5, Number(value.lineHeight) || defaults.lineHeight)), paragraphSpacing: spacing, imageCaptions: value.imageCaptions !== false, codeWrap: value.codeWrap !== false, linkFootnotes: value.linkFootnotes !== false, hideFirstHeading: value.hideFirstHeading === true };
  }

  function safeUrl(value, image = false) {
    const url = String(value || '').trim();
    if (/^https?:\/\//i.test(url)) {
      try { const parsed = new URL(url); return parsed.username || parsed.password ? '' : parsed.href; } catch { return ''; }
    }
    if (!image && /^mailto:[^\s<>]+$/i.test(url)) return url;
    if (!image && /^#[\w\-\u3400-\u9fff]+$/u.test(url)) return url;
    if (image && /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(url)) return url;
    return '';
  }

  function linkUrl(value) {
    // Older reference output could be auto-linked as one duplicated URL.
    const duplicate = String(value || '').trim().match(/^(https?:\/\/.+?)(?:：|%EF%BC%9A)(https?:\/\/.+)$/i);
    if (duplicate && safeUrl(duplicate[1]) && safeUrl(duplicate[1]) === safeUrl(duplicate[2])) return safeUrl(duplicate[1]);
    return safeUrl(value);
  }

  function normalizeLists(holder) {
    holder.querySelectorAll('li').forEach(li => {
      // Put the marker and the first sentence in the same paragraph before copy.
      let paragraph = li.querySelector(':scope > p');
      if (!paragraph || li.firstElementChild !== paragraph) {
        paragraph = document.createElement('p');
        while (li.firstChild && !(li.firstChild.nodeType === 1 && blockTags.includes(li.firstChild.tagName.toLowerCase()))) paragraph.append(li.firstChild);
        if (paragraph.textContent.trim() || paragraph.querySelector('img')) li.prepend(paragraph);
      }
      if (paragraph.parentNode !== li) return;
      const marker = paragraph.querySelector('[data-task]');
      if (marker) {
        marker.replaceWith(`${marker.textContent.trim()}\u00a0`);
        li.setAttribute('data-task-item', 'true');
      } else if (/^[☑☐]$/.test(paragraph.textContent.trim())) {
        const next = paragraph.nextElementSibling;
        if (next?.tagName === 'P') { next.prepend(`${paragraph.textContent.trim()}\u00a0`); paragraph.remove(); li.setAttribute('data-task-item', 'true'); }
      } else if (/^[☑☐](?:\s|$)/.test(paragraph.textContent)) li.setAttribute('data-task-item', 'true');
    });
    holder.querySelectorAll('ul').forEach(list => {
      if ([...list.children].length && [...list.children].every(li => li.hasAttribute('data-task-item'))) list.setAttribute('data-task-list', 'true');
    });
  }

  function preserveCodeWhitespace(holder) {
    const sources = [];
    holder.querySelectorAll('pre').forEach(pre => {
      const readable = pre.cloneNode(true);
      readable.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
      sources.push(readable.textContent);
      const walker = document.createTreeWalker(pre, 4); // Text nodes only; never replace inside HTML attributes.
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      let column = 0;
      nodes.forEach(node => {
        const fragment = document.createDocumentFragment();
        const lines = node.textContent.replace(/\r\n?/g, '\n').split('\n');
        lines.forEach((line, index) => {
          if (index) { fragment.append(document.createElement('br')); column = 0; }
          let text = '';
          for (const char of line) {
            if (char === '\t') { const count = 2 - column % 2; text += '\u00a0'.repeat(count); column += count; }
            else { text += char === ' ' ? '\u00a0' : char; column++; }
          }
          if (text) fragment.append(text);
        });
        node.replaceWith(fragment);
      });
    });
    return sources;
  }

  function render(markdown, rawSettings = {}, assets = new Map()) {
    if (typeof markdown !== 'string') throw new Error('Markdown 内容必须是文本。');
    if (markdown.length > MAX_LENGTH) throw new Error('文章超过 30 万字符，请拆分后排版。');
    const settings = normalizeSettings(rawSettings);
    const warnings = [];
    const images = [];
    const refs = [];
    const parser = new marked.Marked({ gfm: true, breaks: true, async: false });
    const codeMeta = [];
    parser.use({ renderer: {
      code({ text, lang }) {
        const language = (lang || '').trim().split(/\s/)[0].toLowerCase();
        const known = language && hljs.getLanguage(language);
        let highlighted = escape(text);
        if (known) {
          try { highlighted = hljs.highlight(text, { language, ignoreIllegals: true }).value; } catch { /* Plain text remains readable. */ }
        }
        if (language === 'mermaid') warnings.push('Mermaid 图表保留为代码；发布时请先导出图片再插入。');
        codeMeta.push(language || 'text');
        return `<section data-code-block="true"><p data-code-label="true">${escape(language || 'text')}</p><pre><code>${highlighted}</code></pre></section>\n`;
      },
      checkbox({ checked }) { return `<span data-task="true">${checked ? '&#9745;' : '&#9744;'} </span>`; }
    } });
    const raw = parser.parse(markdown);
    const holder = document.createElement('section');
    holder.innerHTML = purifier.sanitize(raw, {
      ALLOWED_TAGS: allowedTags,
      ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'align', 'start', 'colspan', 'rowspan', 'data-code-block', 'data-code-label', 'data-task'],
      ALLOW_DATA_ATTR: false,
      ADD_DATA_URI_TAGS: ['img'],
      KEEP_CONTENT: true
    });
    if (/<\s*(?:script|iframe|video|audio|form|input|object|embed|svg)\b/i.test(markdown)) warnings.push('脚本、表单、音视频、SVG 等不属于兼容正文的内容已移除；需要时请在公众号编辑器中插入。');

    normalizeLists(holder);
    const codeSources = preserveCodeWhitespace(holder);

    holder.querySelectorAll('img').forEach((img, index) => {
      const original = img.getAttribute('src') || '';
      const asset = assets.get(original);
      const src = safeUrl(asset?.dataUrl || original, true);
      const isLocal = asset ? asset.kind !== 'remote' : /^data:/i.test(original);
      const entry = { index, original, alt: img.getAttribute('alt') || asset?.name || `图片 ${index + 1}`, kind: isLocal ? 'local' : 'remote', src, valid: Boolean(src) };
      images.push(entry);
      if (!src) {
        const placeholder = document.createElement('span');
        placeholder.setAttribute('data-image-error', 'true');
        placeholder.textContent = `[图片待替换：${entry.alt}]`;
        img.replaceWith(placeholder);
        warnings.push(`图片「${entry.alt}」不是可用的 HTTPS/HTTP 或内嵌图片，请在图片面板替换。`);
        return;
      }
      img.setAttribute('src', src);
      img.setAttribute('referrerpolicy', 'no-referrer');
      img.removeAttribute('title');
      const figure = document.createElement('figure');
      img.replaceWith(figure); figure.append(img);
      if (settings.imageCaptions && img.getAttribute('alt')) { const caption = document.createElement('figcaption'); caption.textContent = img.getAttribute('alt'); figure.append(caption); }
    });

    const existingReferences = new Map();
    let nextReference = 1;
    holder.querySelectorAll('p').forEach(paragraph => {
      const number = paragraph.textContent.match(/^\s*\[(\d+)\]\s*/)?.[1];
      const anchors = paragraph.querySelectorAll('a');
      if (!number || anchors.length !== 1) return;
      const url = linkUrl(anchors[0].getAttribute('href'));
      if (!/^https?:/i.test(url)) return;
      paragraph.setAttribute('data-reference-item', 'true');
      if (!existingReferences.has(url)) existingReferences.set(url, Number(number));
      nextReference = Math.max(nextReference, Number(number) + 1);
    });
    holder.querySelectorAll('a').forEach(anchor => {
      const url = linkUrl(anchor.getAttribute('href'));
      const span = document.createElement('span');
      if (!url) { anchor.replaceWith(...anchor.childNodes); return; }
      const label = anchor.textContent.trim();
      const urlLabel = linkUrl(label) === url;
      if (urlLabel && !anchor.querySelector('img')) anchor.textContent = url;
      const paragraph = anchor.closest('p');
      const existingReference = paragraph?.hasAttribute('data-reference-item');
      if (settings.linkFootnotes && !existingReference && /^https?:/i.test(url) && new URL(url).hostname !== 'mp.weixin.qq.com') {
        let number = existingReferences.get(url) || refs.find(ref => ref.url === url)?.number;
        if (!number) { number = nextReference++; refs.push({ number, url, text: urlLabel ? '' : label }); }
        span.setAttribute('data-link', 'true'); span.append(...anchor.childNodes);
        const sup = document.createElement('sup'); sup.textContent = `[${number}]`; span.append(sup); anchor.replaceWith(span);
      } else {
        anchor.setAttribute('href', url); anchor.setAttribute('target', '_blank'); anchor.setAttribute('rel', 'noopener noreferrer');
      }
    });

    holder.querySelectorAll('p').forEach(p => {
      if (!p.querySelector('figure')) return;
      const pieces = document.createDocumentFragment();
      let paragraph = document.createElement('p');
      for (const child of [...p.childNodes]) {
        if (child.nodeType === 1 && child.tagName === 'FIGURE') {
          if (paragraph.childNodes.length) pieces.append(paragraph);
          pieces.append(child); paragraph = document.createElement('p');
        } else paragraph.append(child);
      }
      if (paragraph.childNodes.length) pieces.append(paragraph);
      p.replaceWith(pieces);
    });
    if (!settings.imageCaptions) holder.querySelectorAll('figcaption').forEach(caption => caption.remove());
    const firstH1 = holder.querySelector('h1');
    const title = firstH1?.textContent.trim() || holder.querySelector('h2,h3')?.textContent.trim() || '未命名文章';
    if (settings.hideFirstHeading && firstH1) firstH1.remove();
    if (refs.length) {
      const section = document.createElement('section'); section.setAttribute('data-references', 'true');
      const heading = document.createElement('h3'); heading.textContent = '参考链接'; section.append(heading);
      refs.forEach(ref => {
        const p = document.createElement('p'); p.setAttribute('data-reference-item', 'true');
        p.append(`[${ref.number}] ${ref.text ? `${ref.text}: ` : ''}`);
        const anchor = document.createElement('a'); anchor.href = ref.url; anchor.textContent = ref.url;
        anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; p.append(anchor); section.append(p);
      });
      holder.append(section);
    }
    if (images.some(img => img.kind === 'local')) warnings.push('本地/内嵌图片可预览和导出；公众号可能不接收 data 图片，粘贴后请检查，必要时在公众号上传原图。');
    if (images.some(img => img.kind === 'remote' && img.valid)) warnings.push('外链图片的抓取由公众号处理；防盗链或登录图片可能失败，粘贴后请逐张检查。');
    if (!settings.linkFootnotes && holder.querySelector('a')) warnings.push('已保留原始超链接；公众号是否允许点击取决于账号与平台规则。');
    if (/\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)/.test(markdown)) warnings.push('数学公式目前保留为原文；需要公式排版时，请先转为图片。');

    applyStyles(holder, settings);
    const rawText = holder.textContent || '';
    const characters = rawText.replace(/\s/g, '').length;
    const plainText = toPlainText(holder, codeSources);
    const html = holder.outerHTML;
    const byteSize = new TextEncoder().encode(html).length;
    if (byteSize > 8 * 1024 * 1024) warnings.push('富文本超过 8 MB，剪贴板或编辑器可能拒绝；建议压缩图片或分段复制。');
    return { html, plainText, title, settings, images, warnings: [...new Set(warnings)], stats: { characters, headings: holder.querySelectorAll('h1,h2,h3,h4,h5,h6').length, codeBlocks: holder.querySelectorAll('pre').length, tables: holder.querySelectorAll('table').length, images: images.length, minutes: Math.max(1, Math.ceil(characters / 450)), bytes: byteSize }, codeLanguages: codeMeta };
  }

  function applyStyles(holder, s) {
    const accent = s.accent;
    const serif = s.theme === 'editorial';
    const font = serif ? 'Georgia,"Songti SC","SimSun",serif' : '-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",Arial,sans-serif';
    const mono = 'Menlo,Consolas,"Liberation Mono",monospace';
    const bodyColor = '#30343b';
    const base = `box-sizing:border-box;max-width:100%;overflow-wrap:anywhere;word-break:break-word;`;
    function style(el, text) { el.setAttribute('style', base + text); }
    holder.querySelectorAll('*').forEach(el => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'p') style(el, `margin:0 0 ${s.paragraphSpacing}px;font-size:${s.fontSize}px;line-height:${s.lineHeight};color:${bodyColor};`);
      else if (/^h[1-6]$/.test(tag)) {
        const level = Number(tag[1]); const size = [0, 24, 20, 18, 17, 16, 16][level];
        const headingStyle = s.theme === 'technical' && level === 2 ? `padding:7px 12px;border-left:3px solid ${accent};background:#f4f6f8;` : serif && level === 2 ? `padding-bottom:9px;border-bottom:1px solid #d9dee3;` : `padding:0;`;
        style(el, `margin:${level === 1 ? '0 0 26px' : '30px 0 16px'};font-size:${size}px;font-weight:700;line-height:1.5;color:${level <= 2 ? accent : '#252a30'};${headingStyle}`);
      } else if (tag === 'blockquote') style(el, `margin:22px 0;padding:14px 16px;border-left:3px solid ${accent};background:#f5f7f8;color:#59636e;font-size:${s.fontSize - 1}px;`);
      else if (tag === 'ul' || tag === 'ol') style(el, `margin:14px 0 20px;padding-left:25px;color:${bodyColor};list-style-type:${tag === 'ul' ? 'disc' : 'decimal'};`);
      else if (tag === 'li') style(el, `margin:7px 0;padding:0 0 0 2px;font-size:${s.fontSize}px;line-height:${s.lineHeight};`);
      else if (tag === 'strong' || tag === 'b') style(el, `font-weight:700;color:${accent};`);
      else if (tag === 'em' || tag === 'i') style(el, 'font-style:italic;');
      else if (tag === 'del' || tag === 's') style(el, 'text-decoration:line-through;color:#7d8490;');
      else if (tag === 'u') style(el, 'text-decoration:underline;');
      else if (tag === 'a' || el.hasAttribute('data-link')) style(el, `color:${accent};text-decoration:underline;text-underline-offset:3px;`);
      else if (tag === 'sup') style(el, `font-size:11px;vertical-align:super;color:${accent};padding-left:2px;`);
      else if (tag === 'sub') style(el, 'font-size:11px;vertical-align:sub;');
      else if (tag === 'hr') style(el, 'border:0;border-top:1px solid #e1e5e8;margin:30px 0;');
      else if (tag === 'pre') style(el, `margin:0;padding:14px 16px;background:#f4f6f8;border:1px solid #e3e7ec;border-radius:4px;overflow-x:${s.codeWrap ? 'visible' : 'auto'};font-family:${mono};font-size:13px;line-height:1.75;white-space:${s.codeWrap ? 'pre-wrap' : 'pre'};word-break:${s.codeWrap ? 'break-all' : 'normal'};overflow-wrap:${s.codeWrap ? 'anywhere' : 'normal'};tab-size:2;color:#313a46;`);
      else if (tag === 'code') style(el, el.closest('pre') ? `display:block;padding:0;margin:0;background:transparent;color:#313a46;font-family:${mono};font-size:13px;line-height:1.75;white-space:inherit;word-break:inherit;overflow-wrap:inherit;` : `font-family:${mono};font-size:${s.fontSize - 2}px;padding:2px 5px;border-radius:3px;background:#f0f3f5;color:#ba4c37;white-space:normal;`);
      else if (tag === 'table') style(el, `border-collapse:collapse;table-layout:fixed;width:100%;margin:20px 0;font-size:${Math.max(12, s.fontSize - 2)}px;line-height:1.7;color:${bodyColor};`);
      else if (tag === 'th' || tag === 'td') style(el, `border:1px solid #dce2e7;padding:9px 10px;text-align:${['left', 'right', 'center'].includes(el.getAttribute('align')) ? el.getAttribute('align') : 'left'};vertical-align:top;${tag === 'th' ? `font-weight:700;background:#f0f4f5;color:${accent};` : 'background:#fff;'}`);
      else if (tag === 'img') style(el, 'display:block;width:auto;max-width:100%;height:auto;margin:0 auto;object-fit:contain;');
      else if (tag === 'figure') style(el, 'margin:24px 0;padding:0;');
      else if (tag === 'figcaption') style(el, 'margin:9px 0 0;text-align:center;font-size:12px;line-height:1.6;color:#808894;');
      else if (tag === 'kbd') style(el, `padding:2px 5px;border:1px solid #d9dee4;border-radius:3px;background:#f7f8fa;font-family:${mono};font-size:13px;`);
      else if (tag === 'mark') style(el, 'background:#fff1b7;color:#3b3730;padding:1px 3px;');
      else style(el, '');
      if (el.hasAttribute('data-code-block')) style(el, 'margin:22px 0;padding:0;');
      if (el.hasAttribute('data-code-label')) style(el, `margin:0;padding:6px 12px;font-family:${mono};font-size:11px;line-height:1.5;background:#e8edf1;color:#64707e;border-radius:4px 4px 0 0;`);
      if (el.hasAttribute('data-image-error')) style(el, 'display:block;margin:20px 0;padding:14px;border:1px dashed #cfb27d;font-size:13px;color:#9a702b;background:#fffbf4;');
      if (el.hasAttribute('data-task')) style(el, `font-family:${font};color:${accent};padding-right:4px;`);
      if (el.hasAttribute('data-task-list')) style(el, `margin:14px 0 20px;padding-left:0;list-style-type:none;color:${bodyColor};`);
      if (el.hasAttribute('data-task-item')) style(el, `margin:7px 0;padding:0;list-style-type:none;font-size:${s.fontSize}px;line-height:${s.lineHeight};`);
      if (el.hasAttribute('data-reference-item')) style(el, `margin:0 0 9px;padding:0;font-size:${Math.max(12, s.fontSize - 2)}px;line-height:1.8;color:#59636e;`);
      if (el.hasAttribute('data-references')) style(el, 'margin:32px 0 0;padding:0;border-top:1px solid #e1e5e8;');
      if (tag === 'span' && el.closest('pre')) {
        const classes = (el.getAttribute('class') || '').split(/\s+/);
        let color = '#313a46';
        for (const cls of classes) { const key = cls.replace(/^hljs-/, '').split('_')[0]; if (palettes.light[key]) { color = palettes.light[key]; break; } }
        style(el, `display:inline;white-space:inherit;word-break:inherit;overflow-wrap:inherit;color:${color};${classes.includes('hljs-comment') ? 'font-style:italic;' : ''}`);
      }
      if (tag === 'a' || tag === 'sup' || el.hasAttribute('data-link')) el.style.display = 'inline';
      for (const attr of [...el.attributes]) {
        if (['class', 'align'].includes(attr.name) || attr.name.startsWith('data-')) el.removeAttribute(attr.name);
      }
    });
    holder.querySelectorAll('blockquote p:last-child,li p:last-child').forEach(el => { el.style.marginBottom = '0'; });
    style(holder, `width:100%;margin:0 auto;padding:0;background:#ffffff;color:${bodyColor};font-family:${font};font-size:${s.fontSize}px;line-height:${s.lineHeight};text-align:left;letter-spacing:0;`);
  }

  function toPlainText(holder, codeSources) {
    const copy = holder.cloneNode(true);
    let codeMarker = '\u0000motie-code-';
    while (copy.textContent.includes(codeMarker)) codeMarker += '-';
    copy.querySelectorAll('pre').forEach((pre, index) => { pre.textContent = `${codeMarker}${index}\u0000`; });
    copy.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
    copy.querySelectorAll('img').forEach(el => el.replaceWith(`[图片：${el.getAttribute('alt') || '图片'}]`));
    copy.querySelectorAll('td,th').forEach(el => el.append('\t'));
    copy.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,pre,blockquote,tr,figcaption').forEach(el => el.append('\n\n'));
    const text = (copy.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
    return text.replace(new RegExp(`${codeMarker}(\\d+)\u0000`, 'g'), (_, index) => codeSources[Number(index)]);
  }

  function exportDocument(result) {
    return `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(result.title)}</title></head><body style="margin:0;padding:24px 18px;background:#fff;"><main style="display:flow-root;max-width:720px;margin:0 auto">${result.html}</main></body></html>`;
  }

  return Object.freeze({ defaults, themes, MAX_LENGTH, normalizeSettings, safeUrl, render, exportDocument });
});
