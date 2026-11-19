const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/local-files.js'), 'utf8'), sandbox);
const { createLibrary, collectTransfer, fromFiles, imageType } = sandbox.window.MotieLocalFiles;
const image = (name, type = 'image/png') => ({ name, type });
const record = path => ({ path, file: image(path.split('/').at(-1)) });

test('按 Markdown 所在目录匹配 ../ 图片，优先正确目录中的同名原图', () => {
  const library = createLibrary();
  library.add([record('文章/first/images/cover.png'), record('文章/second/images/cover.png')]);
  const match = library.find('../images/cover.png', '文章/second/posts/article.md');
  assert.equal(match.status, 'matched');
  assert.equal(match.record.path, '文章/second/images/cover.png');
});

test('支持中文、空格、百分号编码、查询参数、反斜线和 Unicode 文件名归一化', () => {
  const library = createLibrary();
  library.add([record('导出/图片/架构 图.png'), record('导出/图片/图#1.png'), record('导出/images/cafe\u0301.png')]);
  assert.equal(library.find('./%E5%9B%BE%E7%89%87/%E6%9E%B6%E6%9E%84%20%E5%9B%BE.png?v=1#caption').record.path, '导出/图片/架构 图.png');
  assert.equal(library.find('.\\图片\\架构 图.png').status, 'matched');
  assert.equal(library.find('图片/图%231.png').record.file.name, '图#1.png');
  assert.equal(library.find('images/caf%C3%A9.png').status, 'matched');
  assert.equal(library.find('图%XX.png').status, 'missing');
});

test('按路径后缀或唯一文件名回退，多个同名图片不猜测', () => {
  const library = createLibrary();
  library.add([record('导出/images/cover.png'), record('导出/other/cover.png'), record('single.png')]);
  assert.equal(library.find('images/cover.png').record.path, '导出/images/cover.png');
  assert.equal(library.find('cover.png').status, 'ambiguous');
  assert.equal(library.find('missing/path/single.png').record.path, 'single.png');
  assert.equal(library.find('none.png').status, 'missing');
});

test('同批选择的同名扁平文件保留歧义，重新导入单个原图后可以匹配', () => {
  const library = createLibrary();
  library.add(fromFiles([image('cover.png'), image('cover.png')]));
  assert.equal(library.size, 2);
  assert.equal(library.find('cover.png').status, 'ambiguous');
  library.add(fromFiles([image('cover.png')]));
  assert.equal(library.find('cover.png').status, 'matched');
});

test('先导入文章目录再单独选择图片子目录，精确引用优先于旧目录的后缀匹配', () => {
  const library = createLibrary();
  library.add([record('文章/images/cover.png'), record('文章/other/cover.png')]);
  library.add([record('images/cover.png')]);
  assert.equal(library.find('./images/cover.png', '文章/posts/article.md').record.path, 'images/cover.png');
  assert.equal(library.find('../images/cover.png', '文章/posts/article.md').record.path, '文章/images/cover.png');
});

test('只匹配本地引用，远程地址与非图片文件不进入图片库', () => {
  const library = createLibrary();
  library.add([record('cover.png'), { path: 'unsafe.svg', file: image('unsafe.svg', 'image/svg+xml') }]);
  for (const url of ['https://example.com/cover.png', '//example.com/cover.png', 'data:image/png;base64,AA==', 'javascript:cover.png']) assert.equal(library.find(url).status, 'external');
  assert.equal(library.size, 1);
  assert.equal(imageType(image('photo.JPG', '')), 'image/jpeg');
  assert.equal(imageType(image('photo.png', 'text/html')), '');
});

test('粘贴或拖入目录时读取所有批次、子目录，并在异步读取前保存传输句柄', async () => {
  let available = true, reads = 0;
  const fileEntry = name => ({ name, isFile: true, file: resolve => queueMicrotask(() => resolve(image(name))) });
  const nested = { name: 'nested', isDirectory: true, createReader() {
    let done = false;
    return { readEntries(resolve) { resolve(done ? [] : [fileEntry('nested.png')]); done = true; } };
  } };
  const directory = { name: 'images', isDirectory: true, createReader() {
    const batches = [Array.from({ length: 100 }, (_, i) => fileEntry(`${i}.png`)), [fileEntry('last.png'), nested], []];
    return { readEntries(resolve) { reads++; queueMicrotask(() => resolve(batches.shift())); } };
  } };
  const items = [directory, fileEntry('cover.png')].map(entry => ({ kind: 'file', webkitGetAsEntry() { assert.equal(available, true); return entry; } }));
  const collected = collectTransfer({ items, files: [] });
  available = false;
  const result = await collected;
  assert.equal(reads, 3);
  assert.equal(result.records.length, 103);
  assert.equal(result.hasDirectory, true);
  assert.ok(result.records.some(record => record.path === 'images/nested/nested.png'));
  assert.ok(result.records.some(record => record.path === 'cover.png'));
  assert.equal(result.errors.length, 0);
});

test('一个文件读取失败不会丢失同目录的其他图片，FileList 可单独回退', async () => {
  const good = image('good.png');
  const directory = { name: 'images', isDirectory: true, createReader() {
    let done = false;
    return { readEntries(resolve) {
      resolve(done ? [] : [
        { name: 'broken.png', isFile: true, file: (_, reject) => reject(new Error('unavailable')) },
        { name: 'good.png', isFile: true, file: resolve => resolve(good) }
      ]); done = true;
    } };
  } };
  const result = await collectTransfer({ items: [{ kind: 'file', getAsEntry: () => directory }] });
  assert.equal(result.errors.length, 1);
  assert.equal(result.records[0].file, good);
  const fallback = await collectTransfer({ files: [good] });
  assert.equal(fallback.records[0].file, good);
});
