# M6 evidence replay

原始运行：`/home/hmli/code/mini-harness/runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b`。本目录只做离线分析，不调用provider，不改写原始run。

```sh
node --import tsx reports/evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics.mjs runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b /tmp/m6-recomputed-metrics
node reports/evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/counter.mjs runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b /tmp/m6-recomputed-metrics
npm run eval:verify -- --run runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b
```

原始run必须与Git材料一起保留/交付；报告Git本身不包含完整run。新复算目录用于比较数值，路径元数据可不同。本次保存metrics与counter命令均退出0，counter matchingDerived=true。`cause-review.json`是全36次人工审阅分类，不是自动因果判定。

`index.json`记录全部原始文件相对run路径、大小、SHA-256，以及报告、脚本、派生材料相对项目路径。index自身不自哈希。`verify.json`保存独立只读验收命令和退出码。trace按固定排序取h01 r1、m01 r1、b01 r1，各保留全部事件seq、任务、读写/错误及终止，并附外部判定与快照路径。

脱敏：原始日志不记录API Key或HTTP Authorization头；证据只保留自建任务、模型内容、文件操作、模型标识/用量。未读取或复制.env。未删除事件或篡改seq；本机绝对路径为复核位置，非密钥。原始日志及三个全区间trace的任务/源码未进一步改写。索引不包含.env或仓库外文件。
