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
  const viewport = page.locator('#preview-scroll');
  await article.locator('h1').waitFor();
  await article.locator('img').evaluate(img => img.complete && img.naturalWidth > 0 || new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; }));
  assert.equal(await article.locator('pre').count(), 1);
  assert.equal(await article.locator('table').count(), 1);
  assert.equal(await page.locator('.brand-icon svg').count(), 1);
  assert.equal(await page.locator('#copy-button').isEnabled(), true);
  assert.equal(await page.locator('[data-device="desktop"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#code-wrap').isChecked(), false);
  checks.push('默认示例渲染标题、代码、表格和本地位图，图标与复制按钮正常');
  await page.screenshot({ path: path.join(screenshotDir, '01-workspace.png'), fullPage: true });

  for (const mode of ['mobile', 'desktop']) {
    await page.locator(`[data-device="${mode}"]`).click();
    const available = await page.locator('#preview-scroll').evaluate(node => node.clientWidth - parseFloat(getComputedStyle(node).paddingLeft) - parseFloat(getComputedStyle(node).paddingRight));
    const expectedWidth = mode === 'mobile' ? Math.min(343, available - 32) : 677;
    assert.ok(Math.abs((await article.boundingBox()).width - expectedWidth) < 1);
    assert.ok(Math.abs((await page.locator('#preview-paper').boundingBox()).width - expectedWidth - 32) < 1);
    await page.waitForFunction(width => document.getElementById('preview-width').textContent === `${Math.round(width)} px`, expectedWidth);
    assert.equal(await article.evaluate(node => node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1), true);
    assert.equal(await page.locator('#preview-scroll').evaluate(node => node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight > node.clientHeight), true);
    assert.equal(await page.locator('#preview-paper').evaluate(node => node.scrollHeight <= node.clientHeight + 1), true);
    assert.equal(await page.locator('#preview-frame').count(), 0);
  }
  checks.push('手机模拟 375px 屏幕、343px 正文；电脑正文为 677px，宽度标签不含纸张留白');
  for (const width of [1280, 1024, 800]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(Math.abs((await article.boundingBox()).width - 677) < 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await article.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
    await page.waitForFunction(() => {
      const node = document.getElementById('preview-scroll');
      return node.classList.contains('has-horizontal-overflow') === (node.scrollWidth > node.clientWidth + 1);
    });
    const overflowState = await viewport.evaluate(node => ({ hasOverflow: node.classList.contains('has-horizontal-overflow'), scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, overflowX: getComputedStyle(node).overflowX, paperWidth: document.getElementById('preview-paper').getBoundingClientRect().width }));
    assert.equal(overflowState.hasOverflow, width <= 800, `${width}px preview: ${JSON.stringify(overflowState)}`);
    if (width <= 800) {
      const scrollbarWidth = await viewport.evaluate(node => getComputedStyle(node).scrollbarWidth);
      assert.equal(scrollbarWidth, 'thin');
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(() => {
    const node = document.getElementById('preview-scroll');
    return node.classList.contains('has-horizontal-overflow') === (node.scrollWidth > node.clientWidth + 1);
  });
  checks.push('1280 / 1024 / 800px 窗口下电脑正文保持 677px，窄预览区显示可拖动的横向滚动条，页面无整体横向溢出');
  const wideScrollbar = await viewport.evaluate(node => ({ hasOverflow: node.classList.contains('has-horizontal-overflow'), width: getComputedStyle(node).scrollbarWidth, webkit: getComputedStyle(node, '::-webkit-scrollbar').display }));
  assert.equal(wideScrollbar.width, wideScrollbar.hasOverflow ? 'thin' : 'none');
  assert.equal(wideScrollbar.webkit, wideScrollbar.hasOverflow ? 'block' : 'none');
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
  const longCode = 'const request = fetch("https://example.com/' + 'articles/long-path/'.repeat(16) + '", { method: "POST" });\n  // 中文注释也应保留原始行，长行通过左右滑动查看。\n  console.log(request);';
  const regressionMarkdown = (await page.locator('#markdown-input').inputValue()) + '\n\n## 横向代码回归\n\n```javascript\n' + longCode + '\n```';
  await page.locator('[data-device="mobile"]').click();
  await page.locator('#markdown-input').fill(regressionMarkdown);
  await article.locator('pre').nth(1).waitFor();
  const longBlock = article.locator('pre').nth(1);
  const longScroller = longBlock.locator('code');
  await longBlock.scrollIntoViewIfNeeded();
  assert.equal(await longBlock.evaluate(node => getComputedStyle(node).whiteSpace), 'nowrap');
  assert.equal(await longScroller.evaluate(node => node.scrollWidth > node.clientWidth), true);
  const noWrapHeight = (await longScroller.boundingBox()).height;
  const visibleCodeLines = await longScroller.evaluate(node => {
    const css = getComputedStyle(node);
    return (node.getBoundingClientRect().height - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom)) / parseFloat(css.lineHeight);
  });
  assert.equal(visibleCodeLines, 3, '代码高度对应原始三行，没有额外折行');
  await longScroller.hover(); await page.mouse.wheel(420, 0);
  await page.waitForFunction(() => document.querySelectorAll('#preview-content pre')[1].querySelector('code').scrollLeft > 0);
  assert.equal(await viewport.evaluate(node => node.scrollLeft), 0);
  await longScroller.evaluate(node => { node.scrollLeft = 0; });
  await longScroller.focus(); await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelectorAll('#preview-content pre')[1].querySelector('code').scrollLeft > 0);
  assert.equal(await article.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  await page.locator('#code-wrap').check();
  assert.equal(await longScroller.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  assert.ok((await longScroller.boundingBox()).height > noWrapHeight);
  await page.locator('#code-wrap').uncheck();
  assert.equal(await longScroller.evaluate(node => node.scrollWidth > node.clientWidth), true);
  await longBlock.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(screenshotDir, '02-code-and-table.png'), fullPage: true });
  checks.push('长代码默认保持原始三行，触控板横向滚轮与左右方向键可独立滚动；换行开关可来回切换，不撑宽文章');

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
  assert.ok(copied.text.includes(longCode));
  const copyStyles = await page.evaluate(html => {
    const holder = document.createElement('div'); holder.innerHTML = html;
    const pre = holder.querySelectorAll('pre')[1];
    const scroller = pre.querySelector('code');
    return { maxWidth: holder.firstElementChild.style.maxWidth, whiteSpace: pre.style.whiteSpace, overflow: pre.style.overflow, overflowX: scroller.style.overflowX, wordBreak: scroller.style.wordBreak, overflowWrap: scroller.style.overflowWrap, interactive: Boolean(holder.querySelector('[tabindex]')) };
  }, copied.html);
  assert.deepEqual(copyStyles, { maxWidth: '677px', whiteSpace: 'nowrap', overflow: 'hidden', overflowX: 'auto', wordBreak: 'normal', overflowWrap: 'normal', interactive: false });
  await page.locator('[data-device="desktop"]').click();
  await page.evaluate(() => { window.__clipboard = null; });
  await page.locator('#copy-button').click();
  await page.waitForFunction(html => window.__clipboard?.html === html, copied.html);
  checks.push('手机 / 电脑模式复制相同的富文本，默认代码主题和横向滚动均内联，纯文本保留代码原文（接口替身）');

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
  const exportedPage = await context.newPage();
  await exportedPage.goto(pathToFileURL(output).href);
  assert.ok(Math.abs((await exportedPage.locator('main > section').boundingBox()).width - 677) < 1);
  assert.equal(await exportedPage.locator('pre').evaluate(node => getComputedStyle(node).whiteSpace), 'nowrap');
  await exportedPage.setViewportSize({ width: 375, height: 844 });
  assert.ok(Math.abs((await exportedPage.locator('main > section').boundingBox()).width - 343) < 1);
  assert.equal(await exportedPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await exportedPage.close();
  checks.push('导出 HTML 的电脑 / 手机正文宽度与预览一致，代码滚动内联样式与本地位图保留');

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
  assert.ok(Math.abs((await phone.locator('#preview-content').boundingBox()).width - 343) < 1);
  await phone.screenshot({ path: path.join(screenshotDir, '04-mobile.png'), fullPage: true });
  await phone.locator('[data-action="settings"]').click(); assert.equal(await phone.locator('#settings-panel').isVisible(), true);
  await phone.locator('.outline-section summary').click();
  await phone.locator('[data-outline-index="1"]').click();
  assert.equal(await phone.locator('#settings-panel').isVisible(), false);
  assert.equal(await phone.locator('#preview-content').isVisible(), true);
  assert.ok(await phone.locator('#preview-scroll').evaluate(node => node.scrollTop > 0));
  assert.equal(await phone.locator('#preview-scroll').evaluate(node => getComputedStyle(node).scrollbarWidth), 'none');
  checks.push('390px 手机视口的正文保持 343px；编辑/预览/排版切换及大纲跳转可用，页面没有整体横向溢出');
  await phone.locator('[data-view="source"]').click();
  await phone.locator('#markdown-input').fill('# 滑动代码检查\n\n```javascript\n' + longCode + '\n```');
  await phone.locator('[data-view="preview"]').click();
  await phone.locator('#preview-content h1').filter({ hasText: '滑动代码检查' }).waitFor();
  const phoneCodeScroller = phone.locator('#preview-content .code-scroll');
  await phoneCodeScroller.scrollIntoViewIfNeeded();
  const box = await phoneCodeScroller.boundingBox();
  const touch = await mobile.newCDPSession(phone);
  const startX = box.x + box.width - 25, y = box.y + box.height / 2;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y }] });
  for (let step = 1; step <= 8; step++) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: startX - (box.width - 50) * step / 8, y }] });
    await phone.waitForTimeout(20);
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await phone.waitForFunction(() => document.querySelector('#preview-content .code-scroll').scrollLeft > 0);
  assert.equal(await phone.locator('#preview-scroll').evaluate(node => node.scrollLeft), 0);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await phone.screenshot({ path: path.join(screenshotDir, '05-mobile-code-scroll.png'), fullPage: true });
  checks.push('手机触摸手势可左右滑动长代码，正文与页面保持原宽度');

  // Reinsert exactly the clipboard HTML into a page with no Motie styles or scripts.
  const pasted = await mobile.newPage();
  await pasted.route('**/*', route => route.abort());
  await pasted.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:16px"><article id="pasted"></article></body></html>');
  await pasted.locator('#pasted').evaluate((node, html) => { node.innerHTML = html; }, copied.html);
  // Target editors commonly apply their own wrapping rules. Inline priorities must win.
  await pasted.addStyleTag({ content: 'pre, code, span { white-space: pre-wrap !important; word-break: break-all !important; overflow-wrap: anywhere !important; }' });
  const pastedCode = pasted.locator('#pasted pre').nth(1);
  const pastedScroller = pastedCode.locator('code');
  await pastedScroller.scrollIntoViewIfNeeded();
  assert.deepEqual(await pastedScroller.evaluate(node => {
    const css = getComputedStyle(node);
    return { background: css.backgroundColor, fontSize: css.fontSize, lineHeight: css.lineHeight, radius: css.borderRadius, padding: css.padding, whiteSpace: css.whiteSpace, wordBreak: css.wordBreak, overflowWrap: css.overflowWrap, height: node.getBoundingClientRect().height };
  }), { background: 'rgb(40, 44, 52)', fontSize: '13px', lineHeight: '25.5px', radius: '0px 0px 5px 5px', padding: '8px 16px 20px', whiteSpace: 'nowrap', wordBreak: 'normal', overflowWrap: 'normal', height: 104.5 });
  assert.equal(await pastedScroller.evaluate(node => node.scrollWidth > node.clientWidth), true);
  assert.equal(await pastedCode.locator('span').filter({ hasText: /^const$/ }).first().evaluate(node => getComputedStyle(node).color), 'rgb(198, 120, 221)');
  const pastedPanel = pastedCode.locator('xpath=..');
  assert.equal(await pastedPanel.evaluate(node => getComputedStyle(node).borderRadius), '5px');
  assert.deepEqual(await pastedPanel.locator('[aria-hidden="true"] > span').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor)), ['rgb(255, 95, 86)', 'rgb(255, 189, 46)', 'rgb(39, 201, 63)']);
  const toolbarX = await pastedPanel.locator('[aria-hidden="true"]').evaluate(node => node.getBoundingClientRect().x);
  const pastedBox = await pastedScroller.boundingBox();
  const pastedTouch = await mobile.newCDPSession(pasted);
  const pastedStartX = pastedBox.x + pastedBox.width - 25, pastedY = pastedBox.y + 60;
  await pastedTouch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pastedStartX, y: pastedY }] });
  for (let step = 1; step <= 8; step++) {
    await pastedTouch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pastedStartX - (pastedBox.width - 50) * step / 8, y: pastedY }] });
    await pasted.waitForTimeout(20);
  }
  await pastedTouch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await pasted.waitForFunction(() => document.querySelectorAll('#pasted pre')[1].querySelector('code').scrollLeft > 0);
  assert.equal(await pastedPanel.locator('[aria-hidden="true"]').evaluate(node => node.getBoundingClientRect().x), toolbarX, '滑动代码时三色圆点保持原位');
  assert.equal(await pasted.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await pasted.screenshot({ path: path.join(screenshotDir, '06-copied-code-theme.png'), fullPage: true });
  checks.push('复制 HTML 在无墨贴 CSS/JS 的手机页面保留深色主题与三色圆点，覆盖强制换行规则并可触摸横向滑动，圆点保持原位');

  // Approximate an editor round trip: remove priorities and unsupported intrinsic sizing.
  // This is deliberately a regression fixture, not a claim to reproduce WeChat's sanitizer.
  await pasted.evaluate(() => {
    document.querySelectorAll('style').forEach(node => node.remove());
    document.querySelectorAll('#pasted [style]').forEach(node => {
      for (const property of [...node.style]) {
        const value = node.style.getPropertyValue(property);
        if (/max-content|fit-content/.test(value)) node.style.removeProperty(property);
        else node.style.setProperty(property, value, '');
      }
    });
  });
  await pasted.addStyleTag({ content: 'pre, code, span { white-space: pre-wrap; word-wrap: break-word; word-break: break-all; max-width: 100%; }' });
  assert.equal(await pastedCode.getAttribute('class'), 'custom');
  assert.equal(await pastedScroller.evaluate(node => getComputedStyle(node).display), '-webkit-box');
  assert.equal(await pastedScroller.locator(':scope > span').count(), 1, 'WebKit 容器只有一个正文子元素，换行与高亮顺序不会按横向子项重排');
  assert.equal(await pastedScroller.evaluate(node => node.scrollWidth > node.clientWidth), true);
  assert.equal(await pastedScroller.evaluate(node => node.getBoundingClientRect().height), 104.5, '去除 CSS 优先级后仍然是原始三行');
  await pastedScroller.evaluate(node => { node.scrollLeft = 0; });
  await pastedTouch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pastedStartX, y: pastedY }] });
  for (let step = 1; step <= 8; step++) {
    await pastedTouch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pastedStartX - (pastedBox.width - 50) * step / 8, y: pastedY }] });
    await pasted.waitForTimeout(20);
  }
  await pastedTouch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await pasted.waitForFunction(() => document.querySelectorAll('#pasted pre')[1].querySelector('code').scrollLeft > 0);
  assert.equal(await pasted.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  checks.push('复制 HTML 去除 !important 与内在宽度后，pre.custom、WebKit 单子元素结构保持三行并可触摸滑动（清洗回归样例）');

  // Every palette must preserve the proven layout through UI selection, copy and export.
  await page.locator('#markdown-input').fill(regressionMarkdown);
  await article.locator('pre').nth(1).waitFor();
  await page.locator('[data-device="mobile"]').click();
  for (const [codeTheme, background] of [['one-dark', 'rgb(40, 44, 52)'], ['light', 'rgb(246, 248, 250)'], ['purple', 'rgb(40, 42, 54)'], ['night-blue', 'rgb(15, 23, 42)']]) {
    await page.locator('#code-theme').selectOption(codeTheme);
    assert.equal(await page.locator('#code-wrap').isChecked(), false);
    assert.equal(await longScroller.evaluate(node => getComputedStyle(node).backgroundColor), background);
    assert.equal(await longScroller.evaluate(node => node.scrollWidth > node.clientWidth), true);
    assert.equal(await longScroller.evaluate(node => node.getBoundingClientRect().height), noWrapHeight);
    if (codeTheme === 'light') {
      await longBlock.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(screenshotDir, '08-code-theme-switch.png'), fullPage: true });
    }
    await page.evaluate(() => { window.__clipboard = null; });
    await page.locator('#copy-button').click();
    await page.waitForFunction(() => window.__clipboard?.html);
    const themeClipboard = await page.evaluate(() => window.__clipboard);
    assert.ok(themeClipboard.text.includes(longCode));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('motie.settings.v4')).codeTheme), codeTheme);
    const [themeDownload] = await Promise.all([page.waitForEvent('download'), page.locator('#html-button').click()]);
    const themeOutput = path.join(temporary, `${codeTheme}.html`); await themeDownload.saveAs(themeOutput);
    for (const [kind, html] of [['clipboard', themeClipboard.html], ['export', await fs.readFile(themeOutput, 'utf8')]]) {
      await pasted.setContent(kind === 'clipboard' ? '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:16px">' + html + '</body></html>' : html);
      // Also exercise the compatibility structure after priorities have been stripped.
      await pasted.evaluate(() => document.querySelectorAll('[style]').forEach(node => {
        for (const property of [...node.style]) node.style.setProperty(property, node.style.getPropertyValue(property), '');
      }));
      await pasted.addStyleTag({ content: 'pre,code,span { white-space:pre-wrap;word-break:break-all;overflow-wrap:anywhere;max-width:100%; }' });
      const scroller = pasted.locator('pre').nth(1).locator('code');
      await scroller.scrollIntoViewIfNeeded();
      assert.equal(await pasted.locator('pre').nth(1).getAttribute('class'), 'custom');
      assert.equal(await scroller.evaluate(node => getComputedStyle(node).backgroundColor), background);
      assert.equal(await scroller.evaluate(node => getComputedStyle(node).display), '-webkit-box');
      assert.equal(await scroller.evaluate(node => node.getBoundingClientRect().height), noWrapHeight, `${codeTheme} ${kind}: original three lines`);
      assert.equal(await scroller.evaluate(node => node.scrollWidth > node.clientWidth), true);
      assert.equal(await scroller.locator(':scope > span').count(), 1);
      assert.equal(await pasted.locator('pre').nth(1).locator('xpath=..').locator('[aria-hidden] > span').count(), 3);
      const bounds = await scroller.boundingBox();
      const fromX = bounds.x + bounds.width - 25, atY = bounds.y + bounds.height / 2;
      await pastedTouch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y: atY }] });
      for (let step = 1; step <= 8; step++) {
        await pastedTouch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fromX - (bounds.width - 50) * step / 8, y: atY }] });
        await pasted.waitForTimeout(20);
      }
      await pastedTouch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await pasted.waitForFunction(() => document.querySelectorAll('pre')[1].querySelector('code').scrollLeft > 0);
      assert.equal(await pasted.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
  }
  // Reopening restores the theme without needing to save a Markdown draft.
  const settingsPage = await context.newPage();
  await settingsPage.goto(base, { waitUntil: 'networkidle' });
  assert.equal(await settingsPage.locator('#code-theme').inputValue(), 'night-blue');
  assert.equal(await settingsPage.locator('#code-wrap').isChecked(), false);
  await settingsPage.close();
  await page.locator('#code-theme').selectOption('one-dark');
  await phone.locator('[data-action="settings"]').click();
  await phone.locator('#code-theme').selectOption('light');
  await phone.locator('[data-view="preview"]').click();
  assert.equal(await phoneCodeScroller.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(246, 248, 250)');
  assert.equal(await phoneCodeScroller.evaluate(node => node.scrollWidth > node.clientWidth), true);
  checks.push('侧栏四种代码主题即时切换并保存；各主题的复制和导出在独立手机页面清洗优先级后仍保留原始三行、三色圆点及原生触摸横向滑动，手机侧栏也可切换');

  const articleVariants = await page.locator('#theme-select option').evaluateAll(nodes => nodes.map(node => ({ value: node.value, name: node.textContent })));
  assert.equal(articleVariants.length, 9);
  const baselineCode = await longBlock.evaluate(node => node.outerHTML);
  for (const { value } of articleVariants) {
    await page.locator('#theme-select').selectOption(value);
    assert.equal(await page.locator('#article-style-help').textContent(), await page.evaluate(theme => window.Motie.themeDescriptions[theme], value));
    assert.equal(await longBlock.evaluate(node => node.outerHTML), baselineCode, '文章样式不会修改代码主题与滚动结构');
    assert.equal(await longScroller.evaluate(node => node.scrollWidth > node.clientWidth), true);
    assert.equal(await article.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
    assert.equal(await page.locator('#code-wrap').isChecked(), false);
  }
  const storedStylePage = await context.newPage();
  await storedStylePage.goto(base, { waitUntil: 'networkidle' });
  assert.equal(await storedStylePage.locator('#theme-select').inputValue(), 'minimal');
  await storedStylePage.close();
  await page.locator('#theme-select').selectOption('technical');
  await phone.locator('[data-action="settings"]').click();
  await phone.locator('#theme-select').selectOption('card');
  assert.equal(await phone.locator('#code-theme').inputValue(), 'light');
  await phone.locator('[data-view="preview"]').click();
  assert.equal(await phoneCodeScroller.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(246, 248, 250)');
  assert.equal(await phoneCodeScroller.evaluate(node => node.scrollWidth > node.clientWidth), true);
  checks.push('九种文章样式含不同标题与引用，桌面和手机侧栏均可切换并保存；切换文章样式保留代码配色、原始行数及横向滚动，正文不溢出');

  // Standalone overview of the actual rendered article styles for visual review.
  const overviewContext = await browser.newContext({ viewport: { width: 1200, height: 1600 }, deviceScaleFactor: 1, locale: 'zh-CN' });
  const overview = await overviewContext.newPage();
  const overviewMarkdown = '# 写作，让表达更清晰\n\n文字记录想法，排版让阅读更从容。**保留内容的重点**，也为读者留出呼吸的空间。\n\n## 从一个好标题开始\n\n> 在阅读与思考之间，找到自己的节奏。\n\n- 清楚表达每一个观点\n- 用结构串联文章内容\n\n---\n\n```js\nconst message = "你好，世界";\nconsole.log(message);\n```';
  const overviewItems = await page.evaluate(markdown => Object.entries(window.Motie.themes).map(([theme, name]) => ({ name, html: window.Motie.render(markdown, { theme }).html })), overviewMarkdown);
  await overview.setContent('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#edf1f5;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.tile{min-width:0;padding:18px;background:white;border:1px solid #dfe5eb;border-radius:10px}.label{font-size:13px;color:#657383;border-bottom:1px solid #edf0f3;padding-bottom:14px;margin-bottom:24px}</style></head><body><div class="grid"></div></body></html>');
  await overview.locator('.grid').evaluate((node, items) => items.forEach(item => {
    const tile = document.createElement('div'); tile.className = 'tile';
    const label = document.createElement('div'); label.className = 'label'; label.textContent = item.name;
    const content = document.createElement('div'); content.innerHTML = item.html;
    tile.append(label, content); node.append(tile);
  }), overviewItems);
  await overview.screenshot({ path: path.join(screenshotDir, '09-article-styles.png'), fullPage: true });
  await overviewContext.close();
  await mobile.close();

  // Use the React snippet from the supplied article to review the screenshot's theme.
  const themeExample = await fs.readFile(path.join(root, 'docs/代码主题样例.md'), 'utf8');
  await page.locator('#markdown-input').fill(themeExample);
  await page.evaluate(() => { window.__clipboard = null; });
  await page.locator('#copy-button').click();
  await page.waitForFunction(() => window.__clipboard?.html);
  const themeCopy = await page.evaluate(() => window.__clipboard);
  const proofContext = await browser.newContext({ viewport: { width: 606, height: 1000 }, deviceScaleFactor: 1, locale: 'zh-CN' });
  const proof = await proofContext.newPage();
  await proof.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:24px"><article id="pasted"></article></body></html>');
  await proof.locator('#pasted').evaluate((node, html) => { node.innerHTML = html; }, themeCopy.html);
  const proofPanel = proof.locator('pre').locator('xpath=..');
  assert.equal((await proofPanel.boundingBox()).width, 558);
  const proofBounds = await proofPanel.boundingBox();
  await proof.screenshot({ path: path.join(screenshotDir, '07-dark-code-theme.png'), clip: { x: proofBounds.x - 12, y: proofBounds.y - 12, width: proofBounds.width + 24, height: proofBounds.height + 24 } });
  await proofContext.close();

  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  const evidence = { timestamp: new Date().toISOString(), browser: browser.version(), checks, errors, externalRequests, screenshotFiles: ['01-workspace.png', '02-code-and-table.png', '03-image-manager.png', '04-mobile.png', '05-mobile-code-scroll.png', '06-copied-code-theme.png', '07-dark-code-theme.png', '08-code-theme-switch.png', '09-article-styles.png'], wechatVerified: false, actualClipboardVerified: false };
  await fs.writeFile(path.join(root, 'docs/browser-checks.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
  if (temporary) await fs.rm(temporary, { recursive: true, force: true });
});
