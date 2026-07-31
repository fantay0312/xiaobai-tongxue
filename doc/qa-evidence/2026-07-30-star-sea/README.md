# 2026-07-30 学问星海 QA 证据

本目录保存 PR #7 对应的桌面、手机和同输入参考对照图，替代原记录中的本机绝对路径。

- PR head：`404a9084aa11dbcc1c4851f8b2d5f29143824616`
- squash commit：`c93169e315be0659a0c5ba6d6db7a524f56fb5b1`
- 两个提交的 Git tree：`72a25750fdd9a47ad1de1467a961449267319105`
- GitGuardian check run：[`90830122651`](https://github.com/fantay0312/xiaobai-tongxue/commit/404a9084aa11dbcc1c4851f8b2d5f29143824616/checks)，结论 `success`，完成于 `2026-07-30T09:17:29Z`
- 发布 release：`20260730T092256Z-c93169e-star-sea`
- 发布 tar SHA-256：`b6944e329bb8605fc6f6f4dfce6bfc09f4f0a1c8250fde58a9f948f46767a4da`

文件级校验见 [`sha256sum.txt`](sha256sum.txt)。GitGuardian 记录对应上述 PR head；该 head 与 squash commit 的 tree 完全相同，因此代码内容等价。原本地秘密扫描命令/报告及用于 226 个公网资源逐项比对的完整 manifest 都没有提交到 Git，现无法从 fresh checkout 诚实恢复；因此历史记录只保留可核验的 tar 摘要、提交树、检查运行和视觉证据，不把缺失的扫描报告或 manifest 描述为可复现证据。
