# Gloss 阅读器

基于 `Nutlope/gloss`，上游版本见 `UPSTREAM_COMMIT`。原组件、CSS、交互、插画和字体保留；中文文案、账号、服务器模型与存储为小白适配。

此目录是独立构建的 iframe 前端，隔离父应用的全局样式和 React 版本。运行命令统一使用 `mise run dev/build/check`。构建输出 `app/dist/reader/`，随主站发布。

原始 PDF 与阅读资料仍按账号和部署路径隔离。服务端密钥不进入此构建或浏览器。
