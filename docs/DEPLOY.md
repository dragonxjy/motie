# GitHub Pages 部署

本项目是静态网页，不依赖 Python、数据库、API Key 或构建服务。所有引用使用相对路径，适合 GitHub Pages 的项目子路径。

日常操作见 [使用说明](使用说明.md)。本文只说明静态托管和上线后复核。

## 用网页上传

1. 在 GitHub 新建用于公开预览的仓库，例如 `motie`。
2. 进入本项目的 `motie` 文件夹，上传**里面的内容**到仓库根目录。根目录应直接看到 `index.html`、`src/`、`assets/` 和 `vendor/`，不要额外套一层 `motie/`。
3. `.nojekyll` 是空文件，也可一起提交。若网页上传没有选到隐藏文件，不影响当前普通 HTML / JS / CSS 文件的使用。
4. 打开仓库 **Settings → Pages**，选择 **Deploy from a branch**，分支选 `main`，目录选 `/ (root)`，保存。
5. 等待 GitHub 完成部署，使用 Pages 页面显示的真实 HTTPS 地址。

地址通常形如 `https://你的用户名.github.io/motie/`，这是格式示例，尚未替你创建仓库或生成真实在线链接。账号权限和仓库设置会影响可用选项，以 GitHub 页面为准。

## 用 Git 提交

以下命令在 `motie` 文件夹内执行；把仓库地址替换成你自己已经创建的真实仓库地址：

```sh
git init
git add .
git commit -m "Add Motie Markdown formatter"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/motie.git
git push -u origin main
```

仓库已有提交时，按其现有 Git 流程操作，不要用强制推送覆盖历史。无需提交 `node_modules`，也不必在 GitHub 执行 `npm install` 才能打开网页。

## 上线后复核

打开真实 Pages 地址，编辑一段文字，确认预览变化、图标和内嵌示例图均正常。点击复制，再在一个空白公众号草稿中正常粘贴。检查正文标题、代码缩进、表格和图片，并发送手机预览。

若只显示仓库 README，通常是 `index.html` 未放到所选发布目录。若样式或脚本 404，检查目录层级、文件名大小写和 `vendor/` 是否完整。网页刚更新而内容未变化时，可以强制刷新，或等待部署完成后再试。

浏览器复制失败时，确认使用 HTTPS、页面获得焦点，并检查浏览器的剪贴板权限。也可以导出 HTML，在浏览器打开后选中正文复制。

项目没有自动发布到 GitHub，也没有访问你的 GitHub 或公众号账号。

参考：[GitHub 官方：配置发布源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。
