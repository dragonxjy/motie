const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const screenshotDir = path.join(root, 'docs/screenshots');
let browser, server, temporary;
const checks = [], errors = [], externalRequests = [];

async function serve() {
  server = spawn(process.execPath, [path.join(root, 'serve.cjs')], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let text = '';
    const timeout = setTimeout(() => reject(new Error('静态预览启动超时')), 10000);
    server.once('error', error => { clearTimeout(timeout); reject(error); });
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`静态预览退出：${code}`)); });
    server.stdout.on('data', chunk => { text += chunk; const url = /http:\/\/127\.0\.0\.1:\d+/.exec(text)?.[0]; if (url) { clearTimeout(timeout); resolve(url); } });
  });
}

(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const base = await serve();
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'motie-check-'));
  await fs.mkdir(screenshotDir, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', deviceScaleFactor: 1.5 });
  context.on('request', request => { const url = request.url(); if (/^https?:/.test(url) && !url.startsWith(base)) externalRequests.push(url); });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  const article = page.locator('#preview-content');
  await article.locator('h1').waitFor();
  await article.locator('img').evaluate(img => img.complete && img.naturalWidth > 0 || new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; }));
  assert.equal(await article.locator('pre').count(), 1);
  assert.equal(await article.locator('table').count(), 1);
  assert.equal(await page.locator('.brand-icon svg').count(), 1);
  assert.equal(await page.locator('#copy-button').isEnabled(), true);
  checks.push('默认示例渲染标题、代码、表格和本地位图，图标与复制按钮正常');
  await page.screenshot({ path: path.join(screenshotDir, '01-workspace.png'), fullPage: true });

  for (const mode of ['mobile', 'desktop']) {
    await page.locator(`[data-device="${mode}"]`).click();
    const available = await page.locator('#preview-scroll').evaluate(node => node.clientWidth - parseFloat(getComputedStyle(node).paddingLeft) - parseFloat(getComputedStyle(node).paddingRight));
    const expectedWidth = Math.min(mode === 'mobile' ? 375 : 680, available);
    assert.ok(Math.abs((await page.locator('#preview-paper').boundingBox()).width - expectedWidth) < 2);
    assert.equal(await article.evaluate(node => node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1), true);
    assert.equal(await page.locator('#preview-scroll').evaluate(node => node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight > node.clientHeight), true);
    assert.equal(await page.locator('#preview-paper').evaluate(node => node.scrollHeight <= node.clientHeight + 1), true);
    assert.equal(await page.locator('#preview-frame').count(), 0);
  }
  checks.push('375px / 680px 为预览宽度上限；正文随面板收缩，内容完整展开，仅外层纵向滚动');
  const viewport = page.locator('#preview-scroll');
  assert.equal(await viewport.evaluate(node => getComputedStyle(node).scrollbarWidth), 'none');
  assert.equal(await viewport.evaluate(node => getComputedStyle(node, '::-webkit-scrollbar').display), 'none');
  await viewport.hover(); await page.mouse.wheel(0, 400);
  await page.waitForFunction(() => document.getElementById('preview-scroll').scrollTop > 0);
  await viewport.focus(); await page.keyboard.press('Control+Home'); await page.keyboard.press('Home');
  await page.locator('[data-action="preview-top"]').click();
  assert.equal(await viewport.evaluate(node => node.scrollTop), 0);
  await page.locator('.outline-section summary').click();
  await page.locator('[data-outline-index="1"]').click();
  assert.ok(await viewport.evaluate(node => node.scrollTop > 0));
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'H2');
  await page.locator('[data-action="preview-top"]').click();
  await page.locator('#paragraph-spacing').selectOption('24');
  assert.equal(await article.locator('p').first().evaluate(node => getComputedStyle(node).marginBottom), '24px');
  await page.locator('#image-captions').uncheck();
  assert.equal(await article.locator('figcaption').count(), 0);
  await page.locator('#image-captions').check();
  await page.locator('#paragraph-spacing').selectOption('18');
  checks.push('预览隐藏滚动条仍可滚动，大纲定位、返回顶部、段落间距与图注开关可用');

  await page.locator('#theme-select').selectOption('technical');
  await page.locator('#font-size').fill('18'); await page.locator('#font-size').dispatchEvent('change');
  await article.locator('pre').scrollIntoViewIfNeeded();
  assert.equal(await article.locator('pre').evaluate(node => getComputedStyle(node).whiteSpace), 'pre-wrap');
  await page.screenshot({ path: path.join(screenshotDir, '02-code-and-table.png'), fullPage: true });
  checks.push('主题、字号和代码换行同步到预览');

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: async items => {
      const item = items[0];
      window.__clipboard = { html: await (await item.getType('text/html')).text(), text: await (await item.getType('text/plain')).text() };
    } } });
  });
  await page.locator('#copy-button').click();
  await page.waitForFunction(() => window.__clipboard?.html);
  const copied = await page.evaluate(() => window.__clipboard);
  assert.match(copied.html, /style=/); assert.match(copied.html, /<pre/); assert.match(copied.html, /<table/);
  assert.match(copied.text, /参考链接/);
  checks.push('复制按钮向富文本接口提交 text/html 与 text/plain（接口替身，未修改系统剪贴板）');

  await page.locator('[data-action="images"]').click();
  await page.locator('#images-dialog').waitFor();
  assert.equal(await page.locator('#image-list .image-item').count(), 1);
  await page.screenshot({ path: path.join(screenshotDir, '03-image-manager.png'), fullPage: true });
  await page.locator('[data-close="images-dialog"]').click();
  await page.locator('#markdown-input').fill('# 导入检查\n\n原始内容');
  await page.locator('#markdown-file').setInputFiles({ name: 'article.md', mimeType: 'text/markdown', buffer: Buffer.from('# 文件标题\n\n## 文件正文') });
  await page.locator('#confirm-button').click();
  await article.locator('h1').filter({ hasText: '文件标题' }).waitFor();
  await page.locator('#image-file').setInputFiles({ name: 'workflow.png', mimeType: 'image/png', buffer: await fs.readFile(path.join(root, 'assets/article-workflow.png')) });
  await article.locator('img').waitFor();
  checks.push('导入 Markdown 需要确认替换，本地图片可插入并显示');

  const hostile = '# 安全测试\n\n<img src="javascript:alert(1)" onerror="window.XSS=1"><script>window.XSS=1</script>\n\n正常正文';
  await page.locator('#markdown-input').fill(hostile);
  await article.locator('h1').filter({ hasText: '安全测试' }).waitFor();
  assert.equal(await article.locator('[onerror],script').count(), 0);
  assert.equal(await page.evaluate(() => window.XSS), undefined);
  checks.push('不可信脚本、事件和危险图片地址被清理');

  await page.locator('[data-action="source-menu"]').click(); await page.locator('[data-action="sample"]').click(); await page.locator('#confirm-button').click();
  await article.locator('h1').filter({ hasText: 'Markdown 文章发布前检查' }).waitFor();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#html-button').click()]);
  const output = path.join(temporary, 'article.html'); await download.saveAs(output);
  const exported = await fs.readFile(output, 'utf8');
  assert.match(exported, /name="viewport"/); assert.match(exported, /data:image\/png/);
  checks.push('导出独立 HTML 包含 viewport、内联样式与本地位图');

  const filePage = await context.newPage(); filePage.on('pageerror', error => errors.push(error.message));
  await filePage.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await filePage.locator('#preview-content h1').waitFor();
  assert.equal(await filePage.locator('#copy-button').isEnabled(), true);
  await filePage.close();
  checks.push('file:// 双击入口可编辑与生成预览，无模块跨域问题');

  const projectPage = await context.newPage();
  await projectPage.route(`${base}/motie/**`, async route => {
    const relative = new URL(route.request().url()).pathname.replace(/^\/motie\//, '') || 'index.html';
    const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
    try { await route.fulfill({ contentType: mime[path.extname(relative)] || 'application/octet-stream', body: await fs.readFile(path.join(root, relative)) }); }
    catch { await route.fulfill({ status: 404, body: 'Not found' }); }
  });
  await projectPage.goto(`${base}/motie/`); await projectPage.locator('#preview-content h1').waitFor(); await projectPage.close();
  checks.push('模拟 GitHub Pages 项目子路径下的静态资源加载正常');

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'zh-CN' });
  const phone = await mobile.newPage(); phone.on('pageerror', error => errors.push(error.message));
  await phone.goto(base, { waitUntil: 'networkidle' }); await phone.locator('[data-view="preview"]').click();
  await phone.locator('#preview-content h1').waitFor();
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await phone.screenshot({ path: path.join(screenshotDir, '04-mobile.png'), fullPage: true });
  await phone.locator('[data-action="settings"]').click(); assert.equal(await phone.locator('#settings-panel').isVisible(), true);
  await phone.locator('.outline-section summary').click();
  await phone.locator('[data-outline-index="1"]').click();
  assert.equal(await phone.locator('#settings-panel').isVisible(), false);
  assert.equal(await phone.locator('#preview-content').isVisible(), true);
  assert.ok(await phone.locator('#preview-scroll').evaluate(node => node.scrollTop > 0));
  assert.equal(await phone.locator('#preview-scroll').evaluate(node => getComputedStyle(node).scrollbarWidth), 'none');
  checks.push('390px 手机编辑/预览/排版切换及大纲跳转可用，预览滚动条隐藏，页面没有整体横向溢出');
  await mobile.close();

  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  const evidence = { timestamp: new Date().toISOString(), browser: browser.version(), checks, errors, externalRequests, screenshotFiles: ['01-workspace.png', '02-code-and-table.png', '03-image-manager.png', '04-mobile.png'], wechatVerified: false, actualClipboardVerified: false };
  await fs.writeFile(path.join(root, 'docs/browser-checks.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
  if (temporary) await fs.rm(temporary, { recursive: true, force: true });
});
