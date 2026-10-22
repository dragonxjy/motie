# 第三方组件

项目运行时直接引用 `vendor/` 内的文件，无 CDN 网络依赖。以下版本来自组件自身声明 / 发行包，许可证随对应文件保留。

| 组件 | 版本 | 用途 | 来源 | 许可文件 |
| --- | --- | --- | --- | --- |
| Marked | 17.0.5 | GFM Markdown 解析 | [markedjs/marked](https://github.com/markedjs/marked) | `vendor/marked-LICENSE.md` |
| DOMPurify | 3.4.17 | HTML 清理 | [cure53/DOMPurify](https://github.com/cure53/DOMPurify) | `vendor/DOMPurify-LICENSE`、`DOMPurify-LICENSE-MPL` |
| highlight.js CDN build | 11.12.0 | 常见语言代码高亮 | [highlightjs/cdn-release](https://github.com/highlightjs/cdn-release) | `vendor/highlight-LICENSE` |
| Lucide | 1.8.0 | 界面图标 | [lucide-icons/lucide](https://github.com/lucide-icons/lucide) | `vendor/lucide-LICENSE` |

测试开发依赖为 jsdom 30.1.3、Playwright 1.62.1，以 `package-lock.json` 锁定；使用网页不需要下载它们。项目没有将开发依赖的 `node_modules` 放入分发包。

`assets/article-workflow.svg` 是本项目编写的排版流程示意图，PNG 是它的位图版本；`assets/sample-image.js` 保存该 PNG 的内嵌副本，供双击离线运行示例。它们不是 TRAE 或公众号的真实使用截图。
