const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', url: 'https://motie.example/' });
for (const file of ['vendor/marked.umd.js', 'vendor/purify.min.js', 'vendor/highlight.min.js', 'src/renderer.js', 'src/sample.js', 'assets/sample-image.js']) dom.window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
const api = dom.window.Motie;
const render = (text, settings, assets) => api.render(text, settings, assets);
const parsed = result => { const node = dom.window.document.createElement('div'); node.innerHTML = result.html; return node; };
const codeText = pre => { const node = pre.cloneNode(true); node.querySelectorAll('br').forEach(br => br.replaceWith('\n')); return node.textContent.replace(/\u00a0/g, ' '); };
after(() => dom.window.close());

test('常见 Markdown 结构全部生成内联样式，不依赖类名或样式表', () => {
  const result = render('# 标题\n\n正文 **重点** 和 *强调* `代码`。\n\n> 引用\n\n- 第一项\n- 第二项\n\n---');
  const doc = parsed(result);
  assert.equal(result.title, '标题');
  for (const selector of ['h1', 'p', 'strong', 'em', 'code', 'blockquote', 'ul', 'li', 'hr']) assert.ok(doc.querySelector(selector)?.getAttribute('style'), selector);
  assert.equal(doc.querySelectorAll('[class],style,link,script').length, 0);
  assert.ok(doc.querySelector('section').style.width === '100%');
  assert.equal(doc.querySelector('section').style.maxWidth, '677px');
});

test('代码高亮保留原始缩进、换行和内联颜色', () => {
  const code = 'const html = "<button>";\n  console.log(html);';
  const result = render('```javascript\n' + code + '\n```');
  const pre = parsed(result).querySelector('pre');
  const scroller = pre.querySelector('code');
  assert.equal(codeText(pre), code);
  assert.equal(pre.style.whiteSpace, 'nowrap');
  assert.equal(pre.style.overflow, 'hidden');
  assert.equal(scroller.style.overflowX, 'auto');
  assert.equal(scroller.style.overflowWrap, 'normal');
  assert.equal(scroller.style.wordBreak, 'normal');
  assert.equal(scroller.style.whiteSpace, 'nowrap');
  assert.ok(pre.querySelector('span[style*="color"]'));
  for (const node of pre.querySelectorAll('code,span')) {
    assert.equal(node.style.whiteSpace, 'nowrap');
    assert.equal(node.style.wordBreak, 'normal');
    assert.equal(node.style.overflowWrap, 'normal');
  }
  assert.equal(pre.querySelector('button'), null);
});

test('默认代码主题在所有文章样式中内联输出，颜色与防折行不依赖外部 CSS', () => {
  const source = '// 中文注释与 JSX\nfunction Counter() {\n  const label = "计数";\n  console.log(label);\n  return <div>{label}</div>;\n}';
  for (const theme of Object.keys(api.themes)) {
    const result = render('```jsx\n' + source + '\n```', { theme, accent: '#a3453e', fontSize: 20 });
    const doc = parsed(result);
    const pre = doc.querySelector('pre'), code = pre.querySelector('code'), scroller = pre.querySelector('code');
    const panel = pre.parentElement, toolbar = pre.previousElementSibling;
    assert.equal(codeText(pre), source);
    assert.equal(result.plainText, source, '三色圆点不污染纯文本代码');
    assert.equal(scroller.children.length, 1, '工具栏位于滚动区域之外');
    assert.equal(panel.style.backgroundColor, 'rgb(40, 44, 52)');
    assert.equal(panel.style.borderRadius, '5px');
    assert.ok(panel.style.boxShadow);
    assert.equal(toolbar.getAttribute('aria-hidden'), 'true');
    assert.deepEqual([...toolbar.children].map(dot => dot.style.backgroundColor), ['rgb(255, 95, 86)', 'rgb(255, 189, 46)', 'rgb(39, 201, 63)']);
    for (const dot of toolbar.children) {
      assert.equal(dot.style.borderRadius, '50%');
      assert.equal(dot.style.width, '10px');
      assert.equal(dot.style.height, '10px');
    }
    assert.equal(pre.style.backgroundColor, 'rgb(40, 44, 52)');
    assert.equal(scroller.style.padding, '8px 16px 20px');
    assert.equal(pre.style.fontSize, '13px');
    assert.equal(pre.style.lineHeight, '25.5px');
    assert.match(pre.style.fontFamily, /Menlo/);
    assert.equal(scroller.style.display, '-webkit-box');
    for (const node of [pre, code, ...code.querySelectorAll('span')]) {
      assert.equal(node.style.getPropertyPriority('white-space'), 'important');
      assert.equal(node.style.whiteSpace, 'nowrap');
      assert.equal(node.style.wordBreak, 'normal');
      assert.equal(node.style.overflowWrap, 'normal');
    }
    const color = text => [...code.querySelectorAll('span')].find(node => node.textContent.replace(/\u00a0/g, ' ') === text)?.style.color;
    assert.equal(color('function'), 'rgb(198, 120, 221)');
    assert.equal(color('Counter'), 'rgb(97, 175, 239)');
    assert.equal(color('console'), 'rgb(230, 192, 123)');
    assert.equal(color('log'), 'rgb(97, 175, 239)');
    assert.equal(color('"计数"'), 'rgb(152, 195, 121)');
    assert.equal(color('// 中文注释与 JSX'), 'rgb(92, 99, 112)');
    assert.equal([...code.querySelectorAll('span')].find(node => node.textContent.replace(/\u00a0/g, ' ') === '// 中文注释与 JSX').style.fontStyle, 'italic');
    assert.equal(doc.querySelector('[class]:not(pre.custom),style,link'), null);
  }
});

test('四种代码主题的配色进入复制和导出，所有主题保留同一滚动结构与原文', () => {
  const source = 'const url = "https://example.com/' + 'articles/'.repeat(30) + '";\n  // 保留缩进与空行\n\n  console.log(url);';
  const markdown = '```javascript\n' + source + '\n```';
  const fixtures = [
    ['one-dark', 'rgb(40, 44, 52)', 'rgb(198, 120, 221)'],
    ['light', 'rgb(246, 248, 250)', 'rgb(207, 34, 46)'],
    ['purple', 'rgb(40, 42, 54)', 'rgb(255, 121, 198)'],
    ['night-blue', 'rgb(15, 23, 42)', 'rgb(196, 181, 253)']
  ];
  for (const [codeTheme, background, keyword] of fixtures) {
    for (const theme of Object.keys(api.themes)) {
      const result = render(markdown, { codeTheme, theme });
      const doc = parsed(result), pre = doc.querySelector('pre'), code = pre.querySelector('code');
      assert.equal(result.plainText, source);
      assert.equal(codeText(pre), source);
      assert.equal(pre.className, 'custom');
      assert.equal(code.children.length, 1);
      assert.equal(code.style.display, '-webkit-box');
      assert.equal(code.style.overflowX, 'auto');
      assert.equal(code.style.whiteSpace, 'nowrap');
      assert.equal(code.style.wordBreak, 'normal');
      assert.equal(code.querySelectorAll('br').length, 3);
      for (const node of [pre.parentElement, pre.previousElementSibling, pre, code]) assert.equal(node.style.backgroundColor, background);
      assert.equal([...code.querySelectorAll('span')].find(node => node.textContent === 'const').style.color, keyword);
      assert.equal(pre.previousElementSibling.children.length, 3);
      const exported = new dom.window.DOMParser().parseFromString(api.exportDocument(result), 'text/html');
      assert.equal(exported.querySelector('pre').outerHTML, pre.outerHTML);
      assert.equal(exported.querySelector('link,style,script'), null);
    }
  }
});

test('未知语言与原始 pre 都采用兼容滚动结构，纯文本内容保持一致', () => {
  for (const markdown of ['```unknown-lang\na < b\n```', '<pre>a &lt; b</pre>', '<pre><code>a &lt; b</code></pre>']) {
    const result = render(markdown);
    const pre = parsed(result).querySelector('pre');
    const scroller = pre.querySelector('code');
    assert.equal(codeText(pre), 'a < b');
    assert.equal(result.plainText, 'a < b');
    assert.equal(pre.className, 'custom');
    assert.equal(pre.style.whiteSpace, 'nowrap');
    assert.equal(scroller.style.display, '-webkit-box');
    assert.equal(scroller.style.overflowX, 'auto');
    assert.equal(scroller.children.length, 1);
    assert.equal(scroller.firstElementChild.style.display, 'block');
  }
});

test('代码换行需显式开启，高亮与未知语言都保留原始内容且可恢复横向滚动', () => {
  const source = 'const message = "这是一行含中文、空格和长路径的代码 /api/v1/articles/details";\n  console.log(message);';
  for (const language of ['javascript', 'unknown-lang']) {
    const markdown = '```' + language + '\n' + source + '\n```';
    const wrapped = parsed(render(markdown, { codeWrap: true })).querySelector('pre');
    assert.equal(codeText(wrapped), source);
    for (const node of [wrapped, ...wrapped.querySelectorAll('code,span')]) {
      assert.equal(node.style.whiteSpace, 'pre-wrap');
      assert.equal(node.style.overflowWrap, 'anywhere');
    }
    assert.equal(wrapped.querySelector('code').style.maxWidth, '100%');
    const scrolling = parsed(render(markdown, { codeWrap: false })).querySelector('pre');
    const scroller = scrolling.querySelector('code');
    assert.equal(codeText(scrolling), source);
    assert.equal(scroller.style.overflowX, 'auto');
    assert.equal(scroller.style.overflowWrap, 'normal');
    assert.equal(scroller.style.wordBreak, 'normal');
    assert.equal(scrolling.querySelector('code').style.maxWidth, '100%');
    assert.ok(render(markdown).plainText.includes(source));
  }
});

test('表格固定为正文宽度，并支持对齐和单元格换行', () => {
  const doc = parsed(render('| 甲 | 乙 |\n| :--- | ---: |\n| 内容 | 42 |'));
  assert.equal(doc.querySelector('table').style.tableLayout, 'fixed');
  assert.equal(doc.querySelector('table').style.width, '100%');
  assert.equal(doc.querySelectorAll('th')[1].style.textAlign, 'right');
  assert.equal(doc.querySelector('td').style.overflowWrap, 'anywhere');
});

test('嵌套列表、任务列表保留语义，不生成可交互复选框', () => {
  const doc = parsed(render('1. 第一项\n   - 子项\n2. 第二项\n\n- [x] 已完成\n- [ ] 待办'));
  assert.ok(doc.querySelector('ol ul'));
  assert.equal(doc.querySelectorAll('input').length, 0);
  assert.match(doc.textContent, /☑/);
  assert.match(doc.textContent, /☐/);
});

test('外链转文末注释，相同链接去重，公众号链接保留', () => {
  const result = render('[甲](https://example.com/a) 和 [乙](https://example.com/a)\n\n[公众号](https://mp.weixin.qq.com/s/example)');
  const doc = parsed(result);
  assert.equal(doc.querySelectorAll('sup').length, 2);
  assert.equal(doc.querySelectorAll('a').length, 2);
  assert.equal((doc.textContent.match(/https:\/\/example.com\/a/g) || []).length, 1);
  assert.match(doc.textContent, /参考链接/);
});

test('关闭链接注释保留安全链接，并给出平台兼容提示', () => {
  const result = render('[网站](https://example.com)', { linkFootnotes: false });
  assert.equal(parsed(result).querySelector('a').getAttribute('href'), 'https://example.com/');
  assert.ok(result.warnings.some(w => w.includes('超链接')));
});

test('图片按正文宽度展示，有图注，figure 不嵌在 p 内', () => {
  const result = render('前文 ![图注](https://example.com/a.png) 后文');
  const doc = parsed(result);
  assert.equal(doc.querySelector('img').style.maxWidth, '100%');
  assert.equal(doc.querySelector('figcaption').textContent, '图注');
  assert.equal(doc.querySelector('p figure'), null);
  assert.equal(result.images[0].kind, 'remote');
  assert.ok(result.warnings.some(w => w.includes('防盗链')));
});

test('本地文件映射到内嵌图片，替换为外链后分类更新', () => {
  const png = dom.window.MOTIE_SAMPLE_IMAGE;
  const assets = new Map([['a.png', { dataUrl: png, name: '示例', kind: 'local' }]]);
  const local = render('![图](a.png)', {}, assets);
  assert.equal(local.images[0].kind, 'local');
  assert.match(parsed(local).querySelector('img').getAttribute('src'), /^data:image\/png/);
  assets.set('a.png', { dataUrl: 'https://example.com/b.jpg', kind: 'remote' });
  assert.equal(render('![图](a.png)', {}, assets).images[0].kind, 'remote');
});

test('相对路径和 SVG data 图片转为明确占位，不加载本地路径', () => {
  for (const text of ['![图](./private/file.png)', '<img src="data:image/svg+xml;base64,PHN2Zz4=">']) {
    const result = render(text);
    assert.equal(parsed(result).querySelectorAll('img').length, 0);
    assert.ok(result.warnings.length);
    assert.match(result.plainText, /图片待替换/);
  }
});

test('不可信 HTML 移除脚本、事件、危险链接与外部样式', () => {
  const result = render('<script>window.hacked=1</script><iframe src="https://evil.example"></iframe><p style="background:url(https://evil.example/pixel)">正文<a href="javascript:alert(1)">链接</a><img src="https://example.com/a.png" onerror="alert(1)"></p>');
  const doc = parsed(result);
  assert.equal(doc.querySelectorAll('script,iframe,[onerror],style,link').length, 0);
  assert.ok(!/javascript:|evil\.example|background:\s*url/.test(result.html));
  assert.equal(dom.window.hacked, undefined);
});

test('隐藏一级标题只影响正文，仍返回独立文章标题', () => {
  const result = render('# 标题\n\n## 章节\n\n内容', { hideFirstHeading: true });
  assert.equal(result.title, '标题');
  assert.equal(parsed(result).querySelector('h1'), null);
  assert.equal(parsed(result).querySelector('h2').textContent, '章节');
});

test('主题、主题色、字号和行距生效，同时校验设置输入', () => {
  const result = render('## 标题\n\n内容', { theme: 'technical', accent: '#315aa6', fontSize: 18, lineHeight: 2 });
  const doc = parsed(result);
  assert.ok(doc.querySelector('h2').style.borderLeft.includes('3px'));
  assert.equal(doc.querySelector('p').style.fontSize, '18px');
  assert.equal(doc.querySelector('p').style.lineHeight, '2');
  const invalid = api.normalizeSettings({ accent: 'red;position:fixed', fontSize: 99, theme: '__proto__', codeTheme: '__proto__' });
  assert.equal(invalid.fontSize, 20);
  assert.equal(invalid.accent, '#1c8feb');
  assert.equal(invalid.theme, 'clean');
  assert.equal(invalid.codeTheme, 'one-dark');
  assert.equal(api.normalizeSettings({}).codeTheme, 'one-dark');
});

test('九种文章样式各有标题与引用排版，复制和导出内联，切换文章样式保持代码主题', () => {
  const markdown = '# 标题\n\n正文 **重点**。\n\n## 小节\n\n> 引用\n\n---\n\n```javascript\nconst count = 1;\n```';
  const signatures = new Set();
  let codeHtml;
  assert.equal(Object.keys(api.themes).length, 9);
  for (const theme of Object.keys(api.themes)) {
    const result = render(markdown, { theme, codeTheme: 'light', accent: '#a3453e', paragraphSpacing: 24 });
    const doc = parsed(result);
    assert.equal(result.settings.theme, theme);
    assert.equal(result.settings.codeTheme, 'light');
    assert.equal(doc.querySelector('p').style.marginBottom, '24px');
    assert.equal(doc.querySelector('pre code').style.backgroundColor, 'rgb(246, 248, 250)');
    assert.equal(doc.querySelector('pre code').style.display, '-webkit-box');
    assert.equal(doc.querySelector('pre code').style.whiteSpace, 'nowrap');
    assert.equal(doc.querySelector('[class]:not(pre.custom),link,style,script'), null);
    signatures.add(['h1', 'h2', 'blockquote', 'hr'].map(tag => doc.querySelector(tag).getAttribute('style')).join('|'));
    const pre = doc.querySelector('pre').outerHTML;
    if (codeHtml) assert.equal(pre, codeHtml, '文章样式不改变代码配色或滚动布局');
    codeHtml = pre;
    const exported = new dom.window.DOMParser().parseFromString(api.exportDocument(result), 'text/html');
    for (const tag of ['h1', 'h2', 'blockquote', 'hr', 'pre']) assert.equal(exported.querySelector(tag).outerHTML, doc.querySelector(tag).outerHTML);
  }
  assert.equal(signatures.size, 9, '每种文章样式都有独立的版式');
});

test('导出的独立 HTML 包含 viewport，无外部 CSS/JS，支持跨宽度复用', () => {
  const result = render('# 文章\n\n正文');
  const html = api.exportDocument(result);
  assert.match(html, /name="viewport"/);
  assert.match(html, /width=device-width/);
  assert.ok(!/<script|<link/.test(html));
  const exported = new dom.window.DOMParser().parseFromString(html, 'text/html');
  assert.equal(exported.querySelector('main').style.maxWidth, '677px');
  assert.equal(exported.querySelector('main > section').style.maxWidth, '677px');
  assert.equal(exported.body.style.paddingLeft, '16px');
});

test('纯文本剪贴板保留段落与代码换行，空输入也可渲染', () => {
  const result = render('# 标题\n\n第一段\n\n第二段\n\n```\na\n  b\n```');
  assert.match(result.plainText, /第一段\n\n第二段/);
  assert.match(result.plainText, /a\n  b/);
  assert.equal(render('').stats.characters, 0);
});

test('Mermaid 与数学公式给出明确边界，超长内容拒绝', () => {
  const result = render('```mermaid\ngraph LR; A-->B\n```\n\n$$x^2$$');
  assert.ok(result.warnings.some(w => w.includes('Mermaid')));
  assert.ok(result.warnings.some(w => w.includes('数学')));
  assert.throws(() => render('a'.repeat(300001)), /30 万/);
});

test('内置示例包含真实位图、表格、代码与注释，可完全离线渲染', () => {
  const assets = new Map([['motie-sample-cover.png', { dataUrl: dom.window.MOTIE_SAMPLE_IMAGE, kind: 'local' }]]);
  const result = render(dom.window.MOTIE_SAMPLE, {}, assets);
  assert.equal(result.stats.codeBlocks, 1);
  assert.equal(result.stats.tables, 1);
  assert.equal(result.stats.images, 1);
  assert.equal(result.images[0].valid, true);
  assert.match(result.plainText, /参考链接/);
});

test('函数参数与缩进在移除 white-space 样式后仍由内容保留，纯文本保留原始制表符', () => {
  const code = 'function request(path, { method = "GET", timeout = 5000 } = {}) {\n\tconst params = {\n\t  page: 1,\n\t  query: "<a>&b",\n\t};\n\n\treturn send(path, params);\n}';
  const result = render('```javascript\n' + code + '\n```');
  const pre = parsed(result).querySelector('pre');
  assert.equal(pre.querySelectorAll('br').length, 7);
  assert.equal(pre.querySelectorAll('p,div,section').length, 0);
  assert.equal(pre.querySelector('code > span').style.display, 'block');
  for (const span of pre.querySelectorAll('code > span span')) assert.equal(span.style.display, 'inline');
  pre.querySelectorAll('[style]').forEach(el => el.removeAttribute('style'));
  const expected = code.replace(/^\t/gm, '  ');
  assert.equal(codeText(pre), expected);
  assert.ok(pre.textContent.includes('\u00a0\u00a0const\u00a0params'));
  assert.ok(result.plainText.includes(code));
});

test('未知语言和代码中的任务标记也保留显式换行，不被当成正文列表', () => {
  const code = 'example --name="a b"\n    --timeout=1000\n\n\n- [x] literal';
  const result = render('```unknown-lang\n' + code + '\n```');
  const pre = parsed(result).querySelector('pre');
  assert.equal(codeText(pre), code);
  assert.equal(pre.querySelectorAll('br').length, 4);
  assert.equal(pre.querySelector('li'), null);
  assert.ok(result.plainText.includes(code));
});

test('紧凑、松散与嵌套任务列表都将勾选符和正文放在同一段，避免粘贴后拆行', () => {
  for (const gap of ['\n', '\n\n']) {
    const doc = parsed(render('- [x] 确认 **标题**、引用、列表的层级' + gap + '- [ ] 检查代码和表格在手机上的宽度\n  - [x] 嵌套事项'));
    const items = [...doc.querySelectorAll('li')];
    assert.equal(items.length, 3);
    for (const li of items) {
      const paragraph = li.querySelector(':scope > p');
      assert.match(paragraph.textContent, /^[☑☐]\s+\S/);
      assert.equal(paragraph.firstChild.nodeType, 3);
      assert.equal(li.style.listStyleType, 'none');
      assert.equal(paragraph.querySelector('span'), null);
    }
    assert.ok(items[0].querySelector('strong'));
    assert.ok(items[1].querySelector('ul'));
  }
});

test('已被拆成两段的 Unicode 勾选列表可以恢复，正常多段内容不被合并', () => {
  const doc = parsed(render('- ☑\n\n  确认标题、引用、列表的层级\n\n  补充说明保持为另一段。\n\n- ☐\n\n  发送一次真实的手机预览'));
  const items = doc.querySelectorAll('li');
  assert.match(items[0].querySelector('p').textContent, /^☑\s+确认标题/);
  assert.equal(items[0].querySelectorAll('p').length, 2);
  assert.equal(items[0].querySelectorAll('p')[1].textContent, '补充说明保持为另一段。');
  assert.match(items[1].querySelector('p').textContent, /^☐\s+发送/);
});

test('参考式、自动链接和长 URL 都生成单段参考条目，URL 标签不重复', () => {
  const url = 'https://example.com/docs?foo=one&bar=two#part';
  const result = render('[参考式][docs] 与 [另一个标签][docs]\n\n' + url + '\n\n[docs]: ' + url);
  const doc = parsed(result);
  const reference = doc.querySelector('section > section > p');
  assert.equal(doc.querySelectorAll('sup').length, 3);
  assert.equal(doc.querySelectorAll('a').length, 1);
  assert.equal(reference.querySelector('a').getAttribute('href'), url);
  assert.equal(reference.querySelector('a').style.display, 'inline');
  assert.equal(reference.querySelectorAll('p,br,div').length, 0);
  assert.equal(reference.textContent, '[1] 参考式: ' + url);
  const bare = parsed(render('https://cn.vuejs.org/'));
  assert.equal(bare.querySelector('section > section > p').textContent, '[1] https://cn.vuejs.org/');
});

test('用户已有的 12 条参考资料保持原编号，并修复 URL 与自身拼接的旧格式', () => {
  const urls = ['https://dragonxjy.github.io/xjy_admin', 'https://gitee.com/dragon-xjy/xjy_admin', 'https://cn.vuejs.org/', 'https://element-plus.org/zh-CN/', 'https://cn.vite.dev/', 'https://pinia.vuejs.org/zh/', 'https://echarts.apache.org/zh/index.html', 'https://vueuse.org/', 'https://animate.style/', 'https://www.wangeditor.com/', 'https://github.com/nuysoft/Mock/wiki/Getting-Started', 'https://unocss.dev/'];
  const markdown = '## 参考链接\n\n' + urls.map((url, index) => {
    if (index < 2) return `[${index + 1}] xjy_admin：[${url}](${url})`;
    if (index > 9) return `[${index + 1}] 文档：[${url}](${url})`;
    return `[${index + 1}] [${url}：${url}](${url}：${url})`;
  }).join('\n\n');
  const doc = parsed(render(markdown));
  assert.equal(doc.querySelectorAll('sup').length, 0);
  assert.equal(doc.querySelectorAll('h2,h3').length, 1);
  assert.equal(doc.querySelectorAll('a').length, 12);
  [...doc.querySelectorAll('a')].forEach((a, index) => {
    assert.equal(a.getAttribute('href'), urls[index]);
    assert.equal(a.textContent, urls[index]);
    assert.equal(a.style.display, 'inline');
    assert.match(a.parentNode.textContent, new RegExp('^\\[' + (index + 1) + '\\]'));
    assert.equal(a.parentNode.querySelector('br'), null);
  });
  const mixed = parsed(render('[已有](https://cn.vuejs.org/) 与 [新增](https://example.com/new)\n\n' + markdown));
  assert.deepEqual([...mixed.querySelectorAll('sup')].map(sup => sup.textContent), ['[3]', '[13]']);
  assert.equal(mixed.querySelectorAll('a').length, 13);
  assert.equal([...mixed.querySelectorAll('a')].at(-1).parentNode.textContent, '[13] 新增: https://example.com/new');
});

test('预览使用净化后的文章片段，独立 HTML 导出仍可以正常整页阅读', () => {
  const result = render('# 长文章\n\n' + '正文\n\n'.repeat(100));
  const preview = dom.window.document.createElement('div');
  preview.innerHTML = result.html;
  const exported = new dom.window.DOMParser().parseFromString(api.exportDocument(result), 'text/html');
  assert.equal(preview.querySelectorAll('p').length, 100);
  assert.equal(preview.querySelector('iframe'), null);
  assert.equal(preview.querySelector('script,style,[onload]'), null);
  assert.equal(exported.documentElement.style.overflow, '');
  assert.equal(exported.body.style.overflow, '');
  assert.equal(exported.querySelectorAll('p').length, 100);
});


test('段落间距可调，引用末段和任务清单仍保持紧凑，非法值回到默认', () => {
  for (const gap of [12, 18, 24]) {
    const doc = parsed(render('第一段\n\n第二段\n\n> 引用\n\n- [x] 事项', { paragraphSpacing: gap }));
    assert.equal(doc.querySelector('p').style.marginBottom, `${gap}px`);
    assert.equal(doc.querySelector('blockquote p').style.marginBottom, '0px');
    assert.equal(doc.querySelector('li p').style.marginBottom, '0px');
  }
  for (const value of [-1, 0, 1000, '24px', '18;display:none']) {
    assert.equal(api.normalizeSettings({ paragraphSpacing: value }).paragraphSpacing, 18);
  }
});

test('关闭图注会从预览和导出 HTML 移除说明元素，图片替代文本与源地址保留', () => {
  const markdown = '![图注](https://example.com/a.png)\n\n<figure><img alt="第二张" src="https://example.com/b.png"><figcaption>原 HTML 图注</figcaption></figure>';
  const result = render(markdown, { imageCaptions: false });
  const doc = parsed(result);
  assert.equal(doc.querySelector('figcaption'), null);
  assert.equal(doc.querySelectorAll('img').length, 2);
  assert.equal(doc.querySelector('img').getAttribute('alt'), '图注');
  assert.equal(doc.querySelector('img').getAttribute('src'), 'https://example.com/a.png');
  assert.doesNotMatch(api.exportDocument(result), /<figcaption/);
  assert.ok(result.plainText.includes('[图片：图注]'));
  assert.equal(parsed(render(markdown)).querySelector('figcaption').textContent, '图注');
});
