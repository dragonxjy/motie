const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
for (const file of ['vendor/marked.umd.js', 'vendor/purify.min.js', 'vendor/highlight.min.js', 'src/renderer.js', 'src/sample.js', 'assets/sample-image.js']) {
  dom.window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
}
const assets = new Map([['motie-sample-cover.png', { dataUrl: dom.window.MOTIE_SAMPLE_IMAGE, name: '排版流程示意图.png', kind: 'local' }]]);
const result = dom.window.Motie.render(dom.window.MOTIE_SAMPLE, {}, assets);
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs/示例文章.md'), dom.window.MOTIE_SAMPLE.replace('motie-sample-cover.png', '../assets/article-workflow.png') + '\n');
fs.writeFileSync(path.join(root, 'docs/示例排版.html'), dom.window.Motie.exportDocument(result));
console.log(JSON.stringify({ title: result.title, stats: result.stats, codeLanguages: result.codeLanguages, highlightedLanguages: dom.window.hljs.listLanguages(), files: ['docs/示例文章.md', 'docs/示例排版.html'] }, null, 2));
dom.window.close();
