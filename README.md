# 墨贴

Markdown → 微信公众号富文本排版工具，当前版本 **1.1.0**。纯静态网页，运行库随包提供，可以离线编辑、预览和导出。界面默认主色 `#1c8feb`，文章预览隐藏纵向滚动条，代码块保留横向滚动条，支持滚轮、触控和键盘阅读。

**日常操作请阅读 [使用说明](docs/使用说明.md)**。本文集中说明项目运行、开发、验证和文件结构。

## 运行

直接双击 `index.html` 即可使用。推荐通过 localhost 或 HTTPS 地址复制富文本。

使用 Node.js 24.15 或更新版本时，在本目录运行：

```sh
npm start
```

终端显示实际访问地址，默认 `http://127.0.0.1:4180`。网页运行和启动静态服务器无需先安装 npm 依赖。GitHub Pages 发布见 [部署说明](docs/DEPLOY.md)。

## 功能与边界

| 功能 | 当前行为 |
| --- | --- |
| 常用 Markdown / GFM | 标题、正文强调、引用、任务和嵌套列表、表格、行内代码与代码块 |
| 排版侧栏 | 九种文章样式、四种代码主题、自定义主题色、字号、行距、段落间距、代码换行、首标题与图注开关 |
| 文章大纲 | 根据转换结果生成，点击滚动到预览中的标题 |
| 预览 | 电脑正文固定 677 px；手机模拟 375 px 屏幕、343 px 正文；窄电脑面板可横向查看，文章由外层统一纵向滚动 |
| 图片 | 光标处粘贴、文件选择、拖入；单张路径替换；PNG / JPG / WebP / GIF |
| 外链 | 默认转文末注释并去重；保留已有参考编号，修复重复 URL 标签 |
| 复制与导出 | 同一份内联样式 HTML 用于复制、预览、导出；复制同时提供纯文本 |
| 草稿与撤销 | 可选本机 Markdown 草稿，默认关闭；最多 60 步内容历史 |
| 不支持的内容 | 公式、Mermaid 不自动渲染，SVG / 音视频 / 嵌入网页需另行处理 |

**本地图片仅在当前页面内存中**，草稿和 Markdown 不打包图片，带图备份可导出 HTML。预览显示成功不代表公众号已接收，丢图时仍需在公众号上传原图。项目不处理公众号登录、素材上传或自动发文。

复制可能受浏览器权限影响，先尝试标准富文本剪贴板，再回退到选区复制；失败会明确提示。代码采用 `pre.custom > code > span` 结构，滚动放在 `code` 本身；通过 WebKit 盒布局、显式 `<br>`、不间断空格和内联高亮保留原始行，不依赖 `max-content` 宽度，纯文本仍保留原始代码。兼容方式参考 [mdnice](https://github.com/mdnice/markdown-nice/blob/master/src/utils/helper.js) 与 [doocs/md](https://github.com/doocs/md/blob/main/packages/core/src/utils/languages.ts)。默认代码主题按所提供截图使用深灰背景、三色圆点、One Dark 语法配色、13px 等宽字、25.5px 行高、圆角与阴影，无需额外选择；主题与横向滚动样式一起进入复制和导出结果。长行默认在代码块内左右滚动，顶部圆点保持原位。可导入 [代码主题样例](docs/代码主题样例.md) 对照效果。任务勾选符与正文同段，长网址仍可自然折行。

## 1.1.0 更新

- 界面与默认文章主题改为蓝色 `#1c8feb`。迁移旧版默认绿，保留其他已选色；新版设置独立保存，不改动草稿。
- 隐藏预览区的纵向滚动条，代码块显示细横向滚动条并支持键盘焦点；预览增加返回顶部。
- 电脑默认显示 677 px 正文，宽度标签按正文计算，复制和导出采用相同上限；代码默认左右滚动，v1–v3 设置首次迁移到 v4 时也切换为此默认值，保留其他排版设置和草稿。
- 新增 12 / 18 / 24 px 段落间距、图注显示开关和可点击文章大纲；复制与导出同步应用排版选项。
- 文章样式扩充为简洁、书刊、技术、杂志、雅致、清新、水墨、卡片、极简，侧栏显示各版式说明。代码块可独立选择经典深色、清爽浅色、紫夜、午夜蓝，沿用相同横向滚动结构；两类选择均自动保存，并进入复制和导出结果。
- 整理为一份完整 [使用说明](docs/使用说明.md)，入口、开发与验收文档各司其职。

## 开发与测试

仅开发 / 测试需要安装依赖：

```sh
npm ci
npm run check
npm test
npm run example
```

`npm run example` 更新 `docs/示例文章.md` 与 `docs/示例排版.html`。当前 **51 项测试通过**，包括 30 项转换测试和 21 项界面逻辑测试。九种文章样式、四种代码主题的组合、主题切换与保存、设置迁移、大纲定位、图注移除、段落间距与复制一致性均有回归覆盖。原始记录见 [验证记录](docs/验证记录.md)。

真实浏览器验收与截图：

```sh
npx playwright install chromium
npm run test:browser
```

可用 `CHROME_PATH` 指定浏览器。脚本检查 PC / 手机布局、隐藏滚动条与滚动能力、大纲、图片、导入导出和危险内容，并生成真实页面截图。剪贴板检查使用接口替身，不会修改系统剪贴板或登录公众号。

已通过真实 Chrome 布局与滚动验收，记录见 [browser-checks.json](docs/browser-checks.json)，截图位于 [screenshots](docs/screenshots/README.md)。系统剪贴板与公众号实际粘贴仍待复测，步骤见 [截图与公众号验收](docs/截图与公众号验收.md)。

## 目录与实现

```text
index.html                 网页入口
src/renderer.js            解析、清理、内联样式、图片与外链转换
src/app.js                 编辑、预览、大纲、剪贴板、图片管理、草稿
src/styles.css             简洁蓝色界面、响应式布局、滚动样式
src/sample.js              初始示例
vendor/                    随包运行库及许可
assets/                    图标与示例流程图
docs/使用说明.md           完整日常使用说明
docs/DEPLOY.md             GitHub Pages 部署
docs/验证记录.md           测试结果和实际验证范围
docs/截图与公众号验收.md   浏览器、公众号、截图操作
tests/                     转换与界面测试
tools/                     浏览器检查和示例导出
serve.cjs                  无额外依赖的本地服务器
```

转换流程为 Marked 解析 → DOMPurify 清理 → 图片 / 链接 / 代码处理 → 内联样式。同一份结果用于预览、复制和导出。大纲导航及键盘焦点属性只加到预览 DOM，不写入复制结果。

正文在浏览器本地处理，不上传到项目服务器；远程图片仍会请求图片源站。没有运行时 CDN、分析统计或远程字体。导入上限 2 MB，正文上限 30 万字符；单图上限 5 MB，一次最多 20 张。超过 8 MB 富文本时提示压缩，此阈值是工具提醒，不是公众号官方限制。

第三方库来源与许可见 [THIRD_PARTY.md](THIRD_PARTY.md)。相关技术依据：[Clipboard.write()](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write)、[Marked](https://marked.js.org/using_pro)、[DOMPurify](https://github.com/cure53/DOMPurify)、[微信图文图片上传接口](https://developers.weixin.qq.com/doc/service/api/material/permanent/api_uploadimage.html)。
