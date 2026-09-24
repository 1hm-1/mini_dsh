# Benchmark v1

正式题库只包含 [v1.json](v1.json) 列出的 S8/H4 共 12 题。每个任务包包含公开需求、初始 workspace、公开测试、外部 acceptance、参考补丁和 TaskSpec。模型工作区只复制 workspace；acceptance、参考补丁及其他实验输出不进入工作区。

任务 hash 由现有 `eval/assets.ts` 对整个任务包的实际字节计算，包括公开需求、测试和补丁。manifest 不保存自引用 commit；真实冻结 SHA 记录在 [进度](../docs/progress.md) 的 M5.4 中。题库版本、上下文窗口和预算不会按 full 的收益调整。

## 离线复核

在项目根目录运行，Node 24 + 已安装的开发依赖即可，不需要 API Key：

```sh
# 输出目录必须尚不存在；不覆盖原始证据，也不重写 manifest
node --import tsx benchmark/preflight.mjs /tmp/mini-harness-v1-preflight-new
# Git 工作树须干净；只读核对 12 题、manifest 和冻结提交
node --import tsx benchmark/check-freeze.mjs
# B02 独立扩展检查（产生明确标记为 mock 的报告）
node --import tsx benchmark/check-extension.mjs /tmp/mini-harness-extension-new
```

preflight 逐题确认初始 acceptance 有真实断言失败、参考补丁不越过 writable、修复后公开及隐藏测试全部通过。它不证明真实模型能解题，也不保证 H 题产生压缩压力。参考解答只是可行解，不限制模型采取其他满足公开需求的实现。

## 证据

- `evidence/preflight-v1/index.json`：12 题的 hash、文件/测试数量、原始日志与 preflight JSON 的相对路径、字节数和 SHA-256。
- `evidence/freeze-check.json`：真实冻结提交、manifest SHA-256和只读Git/资产核验结果。
- `evidence/engineering/npm-check.txt`：本次 TypeScript 检查与 249 项工程测试的完整输出。
- `evidence/extension-v2/index.json`：第 13 题的两个离线 mock 运行，prompt 相差一个字节；各自 manifest/result 保存不同 taskHash，report 通过不同 runId 关联。这个目录名是检查尝试编号，不是 benchmark-v2。
- `evidence/extension-v1/`：保留首轮扩展检查；其 mock attempt 和 verify 已通过，但检查脚本错误地要求 Markdown 正文直接包含 taskHash，断言失败。修正为核对 report 的 runId 和关联 manifest/result 后，以全新目录重跑，没有删除或覆盖首轮结果。

原始 preflight JSON、测试日志和 mock manifest 保留生成时的绝对路径及临时检查目录；未为美化路径改写原始字节。索引提供相对路径和原始文件 hash，方便搬迁后审计；运行现有 verify 复核 mock 报告仍需其记录的原任务路径。跨目录重跑时使用全新输出路径。

这些都是题库/工程证据，未调用真实 provider，不能填入 M6 或 M9 的成绩表。下一门槛是完成真实 baseline、失败分析和独立分析提交，之后才能实现 C/O。
