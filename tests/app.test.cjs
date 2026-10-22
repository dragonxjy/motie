const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.resolve(__dirname, '..');
const scripts = ['vendor/marked.umd.js', 'vendor/purify.min.js', 'vendor/highlight.min.js', 'vendor/lucide.min.js', 'src/renderer.js', 'src/sample.js', 'assets/sample-image.js', 'src/app.js'];
const windows = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function createApp(storage = {}) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace('<link rel="stylesheet" href="./src/styles.css">', () => `<style>${fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8')}</style>`);
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://motie.example/', pretendToBeVisual: true, virtualConsole: console });
  const window = dom.window;
  windows.push(window);
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  window.URL.createObjectURL = () => 'blob:test-download';
  window.URL.revokeObjectURL = () => {};
  Object.entries(storage).forEach(([key, value]) => window.localStorage.setItem(key, value));
  for (const file of scripts) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  const $ = selector => window.document.querySelector(selector);
  const click = selector => $(selector).click();
  const change = (selector, value) => { const el = $(selector); if (el.type === 'checkbox') el.checked = value; else el.value = value; el.dispatchEvent(new window.Event('change', { bubbles: true })); };
  const fill = async text => { $('#markdown-input').value = text; $('#markdown-input').dispatchEvent(new window.Event('input', { bubbles: true })); await sleep(230); };
  const preview = () => $('#preview-content').innerHTML;
  return { window, $, click, change, fill, preview, errors };
}
after(() => windows.forEach(window => window.close()));

test('初次载入示例，工具图标、统计与预览可用，草稿默认不保存', () => {
  const app = createApp();
  assert.match(app.preview(), /Markdown 文章发布前检查/);
  assert.match(app.preview(), /<pre/);
  assert.ok(app.$('.brand-icon svg'));
  assert.equal(app.$('#image-count').textContent, '1');
  assert.equal(app.$('#save-draft').checked, false);
  assert.equal(app.window.localStorage.getItem('motie.draft.v1'), null);
  assert.equal(app.$('#copy-button').disabled, false);
  assert.deepEqual(app.errors, []);
});

test('编辑后实时更新，复制操作读取尚在防抖中的最新正文', async () => {
  const app = createApp();
  let written;
  Object.defineProperty(app.window, 'isSecureContext', { value: true });
  app.window.ClipboardItem = class { constructor(data) { this.data = data; } };
  Object.defineProperty(app.window.navigator, 'clipboard', { value: { write: async items => { written = items[0].data; } } });
  app.$('#markdown-input').value = '# 最新标题\n\n```js\nconst x = 1;\n```';
  app.$('#markdown-input').dispatchEvent(new app.window.Event('input', { bubbles: true }));
  app.click('#copy-button');
  await sleep(20);
  assert.equal(written['text/html'].type, 'text/html');
  assert.equal(written['text/plain'].type, 'text/plain');
  assert.ok(written['text/html'].size > 100);
  assert.match(app.preview(), /最新标题/);
  assert.equal(app.$('#copy-label').textContent, '已复制');
});

test('旧剪贴板回退写入 text/html 和 text/plain，不以纯文本冒充成功', async () => {
  const app = createApp();
  const data = {};
  app.window.document.execCommand = command => {
    assert.equal(command, 'copy');
    const event = new app.window.Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData: (type, text) => { data[type] = text; } } });
    app.window.document.dispatchEvent(event); return true;
  };
  app.click('#copy-button'); await sleep(10);
  assert.match(data['text/html'], /style=/);
  assert.match(data['text/plain'], /Markdown 文章发布前检查/);
  assert.equal(app.$('#copy-label').textContent, '已复制');
  assert.equal(app.$('[contenteditable]'), null);
});

test('浏览器拒绝复制时显示说明，不显示已复制', async () => {
  const app = createApp();
  app.window.document.execCommand = () => false;
  app.click('#copy-button'); await sleep(10);
  assert.equal(app.$('#copy-label').textContent, '复制到公众号');
  assert.equal(app.$('#help-dialog').open, true);
  assert.match(app.$('#toast').textContent, /未允许/);
});

test('排版控件更新预览，设置持久化仅含排版参数', () => {
  const app = createApp();
  app.change('#font-size', '18'); app.change('#theme-select', 'technical'); app.change('#code-wrap', false);
  assert.match(app.preview(), /font-size:18px/);
  assert.match(app.preview(), /border-left:3px/);
  const settings = JSON.parse(app.window.localStorage.getItem('motie.settings.v2'));
  assert.equal(settings.codeWrap, false);
  assert.equal(settings.fontSize, 18);
  assert.equal(settings.markdown, undefined);
  assert.equal(app.window.localStorage.getItem('motie.draft.v1'), null);
});

test('草稿明确开启后保存，关闭后移除；恢复草稿不冒充本地图片已恢复', async () => {
  const app = createApp();
  await app.fill('# 自己的文章');
  app.change('#save-draft', true);
  const draft = app.window.localStorage.getItem('motie.draft.v1');
  assert.equal(JSON.parse(draft).markdown, '# 自己的文章');
  const restored = createApp({ 'motie.draft.v1': draft });
  assert.equal(restored.$('#markdown-input').value, '# 自己的文章');
  assert.equal(restored.$('#save-draft').checked, true);
  app.change('#save-draft', false);
  assert.equal(app.window.localStorage.getItem('motie.draft.v1'), null);
});

test('撤销、重做与清空确认可恢复用户内容', async () => {
  const app = createApp();
  const sample = app.$('#markdown-input').value;
  await app.fill('# 改动');
  app.click('#undo-button'); assert.equal(app.$('#markdown-input').value, sample);
  app.click('#redo-button'); assert.equal(app.$('#markdown-input').value, '# 改动');
  app.click('[data-action="clear"]'); assert.equal(app.$('#confirm-dialog').open, true);
  assert.equal(app.$('#markdown-input').value, '# 改动');
  app.click('#confirm-button'); assert.equal(app.$('#markdown-input').value, '');
  assert.equal(app.$('#copy-button').disabled, true);
  app.click('#undo-button'); assert.equal(app.$('#markdown-input').value, '# 改动');
});

test('手机视图切换、电脑宽度和排版面板状态正确', () => {
  const app = createApp();
  app.click('[data-view="preview"]');
  assert.equal(app.$('.workspace').dataset.mobileView, 'preview');
  assert.equal(app.$('#preview-tab').getAttribute('aria-selected'), 'true');
  app.click('[data-device="desktop"]');
  assert.ok(app.$('.preview-scroll').classList.contains('desktop-preview'));
  app.click('[data-action="settings"]'); assert.ok(app.$('.workspace').classList.contains('settings-open'));
  app.window.document.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(!app.$('.workspace').classList.contains('settings-open'));
});

test('图片面板能将相对路径替换为远程图片，检查面板同步', async () => {
  const app = createApp();
  await app.fill('![本地图](./missing.png)'); app.click('[data-action="images"]');
  assert.equal(app.$('#images-dialog').open, true);
  assert.match(app.$('#image-list').textContent, /路径不可用/);
  app.$('[data-image-url="0"]').value = 'https://example.com/real.png';
  app.click('[data-apply-url="0"]');
  assert.match(app.preview(), /https:\/\/example.com\/real.png/);
  assert.match(app.$('#image-list').textContent, /外链/);
  app.click('[data-action="issues"]');
  assert.equal(app.$('#issues-dialog').open, true);
  assert.match(app.$('#issues-list').textContent, /防盗链/);
});

test('过大正文使旧预览和复制失效，修正后恢复', async () => {
  const app = createApp();
  await app.fill('x'.repeat(300001));
  assert.equal(app.$('#copy-button').disabled, true);
  assert.equal(app.$('#render-error').hidden, false);
  assert.ok(!app.preview().includes('Markdown 文章发布前检查'));
  await app.fill('# 修正');
  assert.equal(app.$('#copy-button').disabled, false);
  assert.equal(app.$('#render-error').hidden, true);
});

test('实际复制载荷保留参数换行、任务同段和可识别参考地址', async () => {
  const app = createApp();
  const data = {};
  app.window.document.execCommand = () => {
    const event = new app.window.Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData: (type, text) => { data[type] = text; } } });
    app.window.document.dispatchEvent(event); return true;
  };
  const code = 'function load(id, options = {}) {\n  return request(id, options);\n}';
  app.$('#markdown-input').value = '- [x] 确认标题、引用、列表的层级\n\n```js\n' + code + '\n```\n\nhttps://cn.vuejs.org/';
  app.click('#copy-button'); await sleep(10);
  const doc = new app.window.DOMParser().parseFromString(data['text/html'], 'text/html');
  assert.match(doc.querySelector('li > p').textContent, /^☑\s+确认/);
  assert.equal(doc.querySelector('pre').querySelectorAll('br').length, 2);
  assert.ok(data['text/plain'].includes(code));
  assert.equal(doc.querySelector('a').getAttribute('href'), 'https://cn.vuejs.org/');
  assert.equal(doc.querySelector('a').parentNode.textContent, '[1] https://cn.vuejs.org/');
  assert.equal(app.$('#preview-frame'), null);
});

test('预览正文在外层画布内渲染，页面没有嵌套滚动视口', () => {
  const app = createApp();
  assert.equal(app.$('#preview-paper').contains(app.$('#preview-content')), true);
  assert.equal(app.$('#preview-paper').querySelector('iframe'), null);
  assert.equal(app.$('#preview-scroll').tabIndex, 0);
  assert.equal(app.window.getComputedStyle(app.$('#preview-scroll')).scrollbarWidth, 'none');
  app.$('#preview-scroll').scrollTop = 180;
  app.click('[data-action="preview-top"]');
  assert.equal(app.$('#preview-scroll').scrollTop, 0);
  assert.equal(app.window.document.activeElement, app.$('#preview-scroll'));
  const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
  assert.match(css, /\.preview-scroll\{overflow-x:hidden;overflow-y:auto/);
  assert.match(css, /\.preview-paper\{[^}]*max-width:100%/);
  assert.equal(/#preview-(?:content|paper)[^{]*\{[^}]*overflow-y\s*:\s*(?:auto|scroll)/.test(css), false);
});

test('从剪贴板 items 粘贴图片时，在光标位置插入 Markdown 图片并更新预览', async () => {
  const app = createApp();
  const input = app.$('#markdown-input');
  const png = Buffer.from(app.window.MOTIE_SAMPLE_IMAGE.split(',')[1], 'base64');
  const file = new app.window.File([new Uint8Array(png)], 'screen capture.png', { type: 'image/png' });
  input.value = '# 文章\n\n正文\n\n结尾';
  input.focus();
  const cursor = input.value.indexOf('结尾');
  input.setSelectionRange(cursor, cursor);
  const event = new app.window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }], files: [] } });
  input.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  await sleep(40);
  assert.match(input.value, /正文\n\n!\[screen capture\]\(motie-local-/);
  assert.match(input.value, /\n\n结尾$/);
  assert.match(app.preview(), /data:image\/png;base64/);
  assert.equal(app.$('#image-count').textContent, '1');
});

test('剪贴板只有 files 时也可粘贴图片，并替换光标选中的 Markdown', async () => {
  const app = createApp();
  const input = app.$('#markdown-input');
  const png = Buffer.from(app.window.MOTIE_SAMPLE_IMAGE.split(',')[1], 'base64');
  const file = new app.window.File([new Uint8Array(png)], 'diagram.png', { type: 'image/png' });
  input.value = '# 文章\n\n旧占位\n\n结尾';
  input.focus();
  const start = input.value.indexOf('旧占位'), end = start + '旧占位'.length;
  input.setSelectionRange(start, end);
  const event = new app.window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { items: [], files: [file] } });
  input.dispatchEvent(event);
  await sleep(40);
  assert.doesNotMatch(input.value, /旧占位/);
  assert.match(input.value, /!\[diagram\]\(motie-local-/);
  assert.match(input.value, /\n\n结尾$/);
  assert.equal(app.$('#image-count').textContent, '1');
});


test('旧默认绿迁移为蓝色，旧自选色和新版自选色保持，草稿不受设置迁移影响', () => {
  const migrated = createApp({ 'motie.settings.v1': JSON.stringify({ accent: '#18745b', fontSize: 18 }) });
  assert.equal(migrated.$('#accent-color').value, '#1c8feb');
  assert.equal(migrated.$('#font-size').value, '18');
  const custom = createApp({ 'motie.settings.v1': JSON.stringify({ accent: '#76508e' }) });
  assert.equal(custom.$('#accent-color').value, '#76508e');
  const current = createApp({
    'motie.settings.v1': JSON.stringify({ accent: '#315aa6' }),
    'motie.settings.v2': JSON.stringify({ accent: '#18745b', paragraphSpacing: 24, imageCaptions: false }),
    'motie.draft.v1': JSON.stringify({ markdown: '# 迁移前草稿' })
  });
  assert.equal(current.$('#accent-color').value, '#18745b');
  assert.equal(current.$('#paragraph-spacing').value, '24');
  assert.equal(current.$('#image-captions').checked, false);
  assert.equal(current.$('#markdown-input').value, '# 迁移前草稿');
});

test('段落间距和图注开关同时作用于复制并在重新打开后恢复', async () => {
  const app = createApp();
  await app.fill('# 文章\n\n第一段\n\n第二段\n\n![架构说明](https://example.com/a.png)');
  app.change('#paragraph-spacing', '24'); app.change('#image-captions', false);
  assert.equal(app.$('#preview-content p').style.marginBottom, '24px');
  assert.equal(app.$('#preview-content figcaption'), null);
  const payload = {};
  app.window.document.execCommand = () => {
    const event = new app.window.Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData: (type, text) => { payload[type] = text; } } });
    app.window.document.dispatchEvent(event); return true;
  };
  app.click('#copy-button'); await sleep(10);
  const doc = new app.window.DOMParser().parseFromString(payload['text/html'], 'text/html');
  assert.equal(doc.querySelector('p').style.marginBottom, '24px');
  assert.equal(doc.querySelector('figcaption'), null);
  assert.equal(doc.querySelector('img').getAttribute('alt'), '架构说明');
  assert.equal(doc.querySelector('[data-outline-index], [tabindex]'), null);
  const stored = app.window.localStorage.getItem('motie.settings.v2');
  const restored = createApp({ 'motie.settings.v2': stored });
  assert.equal(restored.$('#paragraph-spacing').value, '24');
  assert.equal(restored.$('#image-captions').checked, false);
  app.click('[data-action="reset-style"]');
  assert.equal(app.$('#paragraph-spacing').value, '18');
  assert.equal(app.$('#image-captions').checked, true);
  assert.equal(app.$('#accent-color').value, '#1c8feb');
});

test('大纲识别层级、重名和转义文本，跳转只滚动预览，手机切至正文', async () => {
  const app = createApp();
  await app.fill('# 总标题\n\n## 重名\n\n### &lt;img src=x onerror=alert(1)&gt;\n\n## 重名\n\n# 第二个一级标题');
  assert.equal(app.$('#heading-count').textContent, '5');
  assert.equal(app.$('#outline-list img'), null);
  assert.match(app.$('[data-outline-index="2"]').textContent, /<img/);
  app.change('#hide-heading', true);
  assert.equal(app.$('#heading-count').textContent, '4');
  assert.equal(app.$('[data-outline-index="3"]').textContent, '第二个一级标题');
  const viewport = app.$('#preview-scroll'), heading = app.$('#preview-content h1');
  viewport.scrollTop = 40;
  viewport.getBoundingClientRect = () => ({ top: 80 });
  heading.getBoundingClientRect = () => ({ top: 260 });
  app.click('[data-action="settings"]');
  app.click('[data-outline-index="3"]');
  assert.equal(viewport.scrollTop, 202);
  assert.equal(app.window.document.activeElement, heading);
  assert.equal(app.$('.workspace').dataset.mobileView, 'preview');
  assert.ok(!app.$('.workspace').classList.contains('settings-open'));
  assert.deepEqual(app.errors, []);
});

test('大纲随新正文和空输入更新，不留下旧标题；关闭代码换行后仍可键盘聚焦', async () => {
  const app = createApp();
  await app.fill('# 旧标题\n\n## 旧章节');
  await app.fill('普通正文，没有标题。');
  assert.equal(app.$('#heading-count').textContent, '0');
  assert.equal(app.$('[data-outline-index]'), null);
  assert.match(app.$('#outline-list').textContent, /没有标题/);
  await app.fill('```js\nconst longLine = "one two three";\n```');
  app.change('#code-wrap', false);
  assert.equal(app.$('#preview-content pre').tabIndex, 0);
  await app.fill('');
  assert.equal(app.$('#heading-count').textContent, '0');
  assert.equal(app.$('[data-outline-index]'), null);
});
