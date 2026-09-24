# M6 真实 Baseline 数值报告

- baselineRunId: `2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b`; phase: `baseline-diagnostic`; provider: `http`.
- baselineImplementationCommit: `8d848c165546727585878e3b6b6613b647087781`; dirty: `false`.
- benchmarkCommit: `9fd463f618edfe25e8a683a62b7f540f3e644f90`; benchmark/hash: `benchmark/v1.json`, `d3d3321d3347017e58be60215e00a7ceb8e75fee5d4d77a2c07b0677160165a2`.
- 配置：[baseline-deepseek.json](../experiments/baseline-deepseek.json)；12题 × baseline × 3次，全部36次保留，无重跑/挑选。实际模型 `deepseek-flash`，全部fingerprint为 `aeb56401ca74e127821c4f9126dcb669`。
- endpoint `https://api.deepseek.com/chat/completions`；temperature=0，thinking.type=disabled，max_tokens=4096。每attempt共用16次模型请求、24次工具调用、120000ms、128000输入字符；上下文窗口8192、触发比例0.75、保留4轮。
- 独立 `eval:verify`：退出0，passed=true/errors=[]；[命令输出](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/verify.json)。[证据索引](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/index.json)；原始目录 `runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/` 保留于本地，未推送远程。

## 评分与成本

主评分要求正常completed、完整性及两层测试均通过。functionalPass只表示两层测试通过，不替代主评分。所有36次完整性检查通过；7次功能通过但tool_limit仍计失败。

| 组 | 主成功率 | 功能通过数 | worker尝试 | 成功响应 | 总模型请求 | O/summary | 已派发工具 | 工具错误 | 输入token | 输出token | usage完整率 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S | 20/24 (83.33%) | 20 | 129 | 129 | 129 | 0 / 0 | 148 | 0 | 212350 | 31002 | 100% |
| H | 3/12 (25.00%) | 10 | 99 | 97 | 99 | 0 / 0 | 262 | 13 | 403057 | 44031 | 100% |
| overall | 23/36 (63.89%) | 30 | 228 | 226 | 228 | 0 / 0 | 410 | 13 | 615407 | 75033 | 100% |

228次请求均已派发。226次成功响应，另2次有usage的finish=length响应被运行时判为model_error。工具意图417次，实际派发410次，7次因额度耗尽未执行；13次工具错误只统计已派发调用。总token 690440，缺失usage为0；费用金额未估算。

| 组 | Agent均值ms | 中位ms | 峰值ms | 公开检查中位/总ms | 隐藏检查中位/总ms |
| --- | --- | --- | --- | --- | --- |
| S | 6913.93 | 6237.46 | 15086.84 | 40.53 / 1003.80 | 42.76 / 1059.31 |
| H | 15846.19 | 15837.22 | 35085.84 | 45.18 / 548.48 | 46.96 / 583.06 |
| overall | 9891.35 | 7565.46 | 35085.84 | 42.05 / 1552.28 | 44.21 / 1642.37 |

Agent耗时与外部验收耗时分别计量；全部检查耗时有记录。

## 全部36次trace摘要

每行链接派生明细（含所有调用参数、callId、事件seq、测试失败断言）。操作列为首个成功修改的tool_start及终止run_end；其余关键seq见候选分类表。原始journal、before/after/changes及验收日志均由索引覆盖。读取/回读是文件工具行为，模型不能在runtime中执行测试命令。

| attempt | 主结果/终止 | 公开/隐藏通过用例 | worker尝试/成功 | 工具/错误 | 关键操作 | 实际变化文件 | 失败断言 | 原始证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [b01-normalize r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b01-normalize-baseline-1.json) | PASS; completed | 3/3 / 5/5 | 5/5 | 5/0 | 首改seq24; end38 | normalize.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/b01-normalize-baseline-1/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/b01-normalize-baseline-1/changes.json) |
| [b01-normalize r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b01-normalize-baseline-2.json) | PASS; completed | 3/3 / 5/5 | 6/6 | 5/0 | 首改seq28; end42 | normalize.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/b01-normalize-baseline-2/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/b01-normalize-baseline-2/changes.json) |
| [b01-normalize r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b01-normalize-baseline-3.json) | PASS; completed | 3/3 / 5/5 | 4/4 | 3/0 | 首改seq14; end28 | normalize.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/b01-normalize-baseline-3/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/b01-normalize-baseline-3/changes.json) |
| [b02-counter r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b02-counter-baseline-1.json) | PASS; completed | 3/3 / 5/5 | 4/4 | 4/0 | 首改seq24; end31 | counter.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/b02-counter-baseline-1/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/b02-counter-baseline-1/changes.json) |
| [b02-counter r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b02-counter-baseline-2.json) | PASS; completed | 3/3 / 5/5 | 4/4 | 4/0 | 首改seq24; end31 | counter.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/b02-counter-baseline-2/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/b02-counter-baseline-2/changes.json) |
| [b02-counter r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b02-counter-baseline-3.json) | PASS; completed | 3/3 / 5/5 | 3/3 | 2/0 | 首改seq14; end21 | counter.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/b02-counter-baseline-3/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/b02-counter-baseline-3/changes.json) |
| [b03-config r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b03-config-baseline-1.json) | PASS; completed | 3/3 / 8/8 | 8/8 | 8/0 | 首改seq24; end59 | config.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/b03-config-baseline-1/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/b03-config-baseline-1/changes.json) |
| [b03-config r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b03-config-baseline-2.json) | PASS; completed | 3/3 / 8/8 | 10/10 | 9/0 | 首改seq28; end70 | config.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/b03-config-baseline-2/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/b03-config-baseline-2/changes.json) |
| [b03-config r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b03-config-baseline-3.json) | PASS; completed | 3/3 / 8/8 | 7/7 | 6/0 | 首改seq28; end49 | config.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/b03-config-baseline-3/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/b03-config-baseline-3/changes.json) |
| [f01-tags r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f01-tags-baseline-1.json) | PASS; completed | 3/3 / 5/5 | 5/5 | 5/0 | 首改seq24; end38 | tags.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/f01-tags-baseline-1/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/f01-tags-baseline-1/changes.json) |
| [f01-tags r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f01-tags-baseline-2.json) | PASS; completed | 3/3 / 5/5 | 6/6 | 6/0 | 首改seq24; end45 | tags.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/f01-tags-baseline-2/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/f01-tags-baseline-2/changes.json) |
| [f01-tags r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f01-tags-baseline-3.json) | PASS; completed | 3/3 / 5/5 | 6/6 | 6/0 | 首改seq24; end45 | tags.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/f01-tags-baseline-3/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/f01-tags-baseline-3/changes.json) |
| [f02-pagination r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f02-pagination-baseline-1.json) | PASS; completed | 2/2 / 4/4 | 3/3 | 2/0 | 首改seq14; end21 | pagination.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/f02-pagination-baseline-1/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/f02-pagination-baseline-1/changes.json) |
| [f02-pagination r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f02-pagination-baseline-2.json) | PASS; completed | 2/2 / 4/4 | 3/3 | 2/0 | 首改seq14; end21 | pagination.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/f02-pagination-baseline-2/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/f02-pagination-baseline-2/changes.json) |
| [f02-pagination r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f02-pagination-baseline-3.json) | PASS; completed | 2/2 / 4/4 | 4/4 | 3/0 | 首改seq14; end28 | pagination.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/f02-pagination-baseline-3/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/f02-pagination-baseline-3/changes.json) |
| [f03-ranges r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f03-ranges-baseline-1.json) | PASS; completed | 2/2 / 5/5 | 5/5 | 5/0 | 首改seq24; end38 | ranges.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/f03-ranges-baseline-1/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/f03-ranges-baseline-1/changes.json) |
| [f03-ranges r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f03-ranges-baseline-2.json) | PASS; completed | 2/2 / 5/5 | 5/5 | 5/0 | 首改seq24; end38 | ranges.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/f03-ranges-baseline-2/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/f03-ranges-baseline-2/changes.json) |
| [f03-ranges r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f03-ranges-baseline-3.json) | PASS; completed | 2/2 / 5/5 | 6/6 | 6/0 | 首改seq24; end45 | ranges.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/f03-ranges-baseline-3/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/f03-ranges-baseline-3/changes.json) |
| [h01-config-pipeline r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h01-config-pipeline-baseline-1.json) | FAIL; tool_limit | 4/4 / 10/10 | 11/11 | 24/3 | 首改seq54; end121 | src/env-config.mjs, src/merge.mjs, src/validate.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/h01-config-pipeline-baseline-1/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/h01-config-pipeline-baseline-1/changes.json) |
| [h01-config-pipeline r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h01-config-pipeline-baseline-2.json) | FAIL; tool_limit | 4/4 / 10/10 | 12/12 | 24/4 | 首改seq54; end125 | src/env-config.mjs, src/merge.mjs, src/validate.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/h01-config-pipeline-baseline-2/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/h01-config-pipeline-baseline-2/changes.json) |
| [h01-config-pipeline r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h01-config-pipeline-baseline-3.json) | FAIL; tool_limit | 4/4 / 10/10 | 9/9 | 24/3 | 首改seq54; end113 | src/env-config.mjs, src/merge.mjs, src/validate.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/h01-config-pipeline-baseline-3/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/h01-config-pipeline-baseline-3/changes.json) |
| [h02-chunk-parser r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h02-chunk-parser-baseline-1.json) | FAIL; model_error | 3/5 / 4/9 | 3/2 | 13/0 | 首改seq无; end53 | 无 | public: CRLF split across chunks ends one record; public: doubled quotes unescape across chunks; acceptance: every two-way chunk split matches whole input; acceptance: quoted CRLF is preserved and outside CRLF is a delimiter; acceptance: doubled quotes spanning chunks become one quote; acceptance: open quote and bare CR have distinct errors; acceptance: both consumers preserve quoted contents and count the same rows | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/h02-chunk-parser-baseline-1/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/h02-chunk-parser-baseline-1/changes.json) |
| [h02-chunk-parser r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h02-chunk-parser-baseline-2.json) | FAIL; tool_limit | 5/5 / 9/9 | 8/8 | 24/3 | 首改seq68; end109 | src/state.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/h02-chunk-parser-baseline-2/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/h02-chunk-parser-baseline-2/changes.json) |
| [h02-chunk-parser r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h02-chunk-parser-baseline-3.json) | FAIL; model_error | 3/5 / 4/9 | 3/2 | 13/0 | 首改seq无; end53 | 无 | public: CRLF split across chunks ends one record; public: doubled quotes unescape across chunks; acceptance: every two-way chunk split matches whole input; acceptance: quoted CRLF is preserved and outside CRLF is a delimiter; acceptance: doubled quotes spanning chunks become one quote; acceptance: open quote and bare CR have distinct errors; acceptance: both consumers preserve quoted contents and count the same rows | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/h02-chunk-parser-baseline-3/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/h02-chunk-parser-baseline-3/changes.json) |
| [h03-module-navigation r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h03-module-navigation-baseline-1.json) | PASS; completed | 4/4 / 8/8 | 11/11 | 24/0 | 首改seq68; end119 | entry.mjs, registry.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/h03-module-navigation-baseline-1/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/h03-module-navigation-baseline-1/changes.json) |
| [h03-module-navigation r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h03-module-navigation-baseline-2.json) | PASS; completed | 4/4 / 8/8 | 11/11 | 22/0 | 首改seq68; end113 | entry.mjs, registry.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/h03-module-navigation-baseline-2/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/h03-module-navigation-baseline-2/changes.json) |
| [h03-module-navigation r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h03-module-navigation-baseline-3.json) | PASS; completed | 4/4 / 8/8 | 11/11 | 22/0 | 首改seq68; end113 | entry.mjs, registry.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/h03-module-navigation-baseline-3/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/h03-module-navigation-baseline-3/changes.json) |
| [h04-issue-refactor r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h04-issue-refactor-baseline-1.json) | FAIL; tool_limit | 3/3 / 7/7 | 8/8 | 24/0 | 首改seq60; end109 | consumers/activity.mjs, consumers/list.mjs, consumers/search.mjs, normalize.mjs, serialize.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/h04-issue-refactor-baseline-1/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/h04-issue-refactor-baseline-1/changes.json) |
| [h04-issue-refactor r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h04-issue-refactor-baseline-2.json) | FAIL; tool_limit | 3/3 / 7/7 | 4/4 | 24/0 | 首改seq60; end93 | consumers/activity.mjs, consumers/list.mjs, consumers/search.mjs, normalize.mjs, serialize.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/h04-issue-refactor-baseline-2/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/h04-issue-refactor-baseline-2/changes.json) |
| [h04-issue-refactor r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h04-issue-refactor-baseline-3.json) | FAIL; tool_limit | 3/3 / 7/7 | 8/8 | 24/0 | 首改seq60; end109 | consumers/activity.mjs, consumers/list.mjs, consumers/search.mjs, normalize.mjs, serialize.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/h04-issue-refactor-baseline-3/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/h04-issue-refactor-baseline-3/changes.json) |
| [m01-report r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/m01-report-baseline-1.json) | FAIL; completed | 2/2 / 4/5 | 8/8 | 11/0 | 首改seq27; end68 | parser.mjs, report.mjs | acceptance: overflow in row and aggregate is rejected | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/m01-report-baseline-1/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/m01-report-baseline-1/changes.json) |
| [m01-report r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/m01-report-baseline-2.json) | FAIL; completed | 2/2 / 4/5 | 5/5 | 8/0 | 首改seq27; end47 | parser.mjs, report.mjs | acceptance: overflow in row and aggregate is rejected | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/m01-report-baseline-2/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/m01-report-baseline-2/changes.json) |
| [m01-report r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/m01-report-baseline-3.json) | FAIL; completed | 2/2 / 4/5 | 6/6 | 9/0 | 首改seq27; end54 | parser.mjs, report.mjs | acceptance: overflow in row and aggregate is rejected | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/m01-report-baseline-3/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/m01-report-baseline-3/changes.json) |
| [m02-options r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/m02-options-baseline-1.json) | FAIL; completed | 2/2 / 3/4 | 5/5 | 11/0 | 首改seq30; end56 | defaults.mjs, formatter.mjs, resolver.mjs | acceptance: invalid overrides and values use specified errors | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/m02-options-baseline-1/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/m02-options-baseline-1/changes.json) |
| [m02-options r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/m02-options-baseline-2.json) | PASS; completed | 2/2 / 4/4 | 5/5 | 11/0 | 首改seq30; end56 | defaults.mjs, formatter.mjs, resolver.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/m02-options-baseline-2/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/m02-options-baseline-2/changes.json) |
| [m02-options r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/m02-options-baseline-3.json) | PASS; completed | 2/2 / 4/4 | 6/6 | 12/0 | 首改seq30; end63 | defaults.mjs, formatter.mjs, resolver.mjs | 无 | [journal](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/m02-options-baseline-3/journal.jsonl) / [diff](../runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/attempts/m02-options-baseline-3/changes.json) |

## 重复调用与回读

key为工具名与参数JSON递归排序；无效JSON按原串。exact为每key出现次数减一之和，consecutive只数相邻相同key。下表先列全部tool_start（含7次未执行），另列已派发口径。回读只数同一路径第二次及以后的成功read_file，失败另计；是否合理须结合中间修改及可见内容变化。

| attempt | 完全重复 | 连续重复 | 派发重复/连续 | 成功回读 | 工具错误 |
| --- | --- | --- | --- | --- | --- |
| [b01-normalize r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b01-normalize-baseline-1.json) | 1 | 0 | 1/0 | 1 | 0 |
| [b01-normalize r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b01-normalize-baseline-2.json) | 1 | 0 | 1/0 | 1 | 0 |
| [b01-normalize r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b01-normalize-baseline-3.json) | 1 | 0 | 1/0 | 1 | 0 |
| [b02-counter r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b02-counter-baseline-1.json) | 0 | 0 | 0/0 | 0 | 0 |
| [b02-counter r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b02-counter-baseline-2.json) | 0 | 0 | 0/0 | 0 | 0 |
| [b02-counter r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b02-counter-baseline-3.json) | 0 | 0 | 0/0 | 0 | 0 |
| [b03-config r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b03-config-baseline-1.json) | 3 | 1 | 3/1 | 3 | 0 |
| [b03-config r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b03-config-baseline-2.json) | 4 | 0 | 4/0 | 3 | 0 |
| [b03-config r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b03-config-baseline-3.json) | 1 | 0 | 1/0 | 1 | 0 |
| [f01-tags r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f01-tags-baseline-1.json) | 1 | 0 | 1/0 | 1 | 0 |
| [f01-tags r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f01-tags-baseline-2.json) | 2 | 0 | 2/0 | 1 | 0 |
| [f01-tags r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f01-tags-baseline-3.json) | 2 | 0 | 2/0 | 1 | 0 |
| [f02-pagination r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f02-pagination-baseline-1.json) | 0 | 0 | 0/0 | 0 | 0 |
| [f02-pagination r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f02-pagination-baseline-2.json) | 0 | 0 | 0/0 | 0 | 0 |
| [f02-pagination r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f02-pagination-baseline-3.json) | 1 | 0 | 1/0 | 1 | 0 |
| [f03-ranges r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f03-ranges-baseline-1.json) | 1 | 0 | 1/0 | 1 | 0 |
| [f03-ranges r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f03-ranges-baseline-2.json) | 1 | 0 | 1/0 | 1 | 0 |
| [f03-ranges r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f03-ranges-baseline-3.json) | 2 | 0 | 2/0 | 2 | 0 |
| [h01-config-pipeline r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h01-config-pipeline-baseline-1.json) | 6 | 0 | 5/0 | 4 | 3 |
| [h01-config-pipeline r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h01-config-pipeline-baseline-2.json) | 5 | 0 | 4/0 | 4 | 4 |
| [h01-config-pipeline r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h01-config-pipeline-baseline-3.json) | 5 | 0 | 4/0 | 4 | 3 |
| [h02-chunk-parser r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h02-chunk-parser-baseline-1.json) | 0 | 0 | 0/0 | 0 | 0 |
| [h02-chunk-parser r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h02-chunk-parser-baseline-2.json) | 8 | 0 | 7/0 | 6 | 3 |
| [h02-chunk-parser r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h02-chunk-parser-baseline-3.json) | 0 | 0 | 0/0 | 0 | 0 |
| [h03-module-navigation r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h03-module-navigation-baseline-1.json) | 7 | 0 | 7/0 | 6 | 0 |
| [h03-module-navigation r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h03-module-navigation-baseline-2.json) | 5 | 0 | 5/0 | 4 | 0 |
| [h03-module-navigation r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h03-module-navigation-baseline-3.json) | 5 | 0 | 5/0 | 4 | 0 |
| [h04-issue-refactor r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h04-issue-refactor-baseline-1.json) | 5 | 0 | 4/0 | 4 | 0 |
| [h04-issue-refactor r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h04-issue-refactor-baseline-2.json) | 5 | 0 | 4/0 | 4 | 0 |
| [h04-issue-refactor r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h04-issue-refactor-baseline-3.json) | 5 | 0 | 4/0 | 4 | 0 |
| [m01-report r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/m01-report-baseline-1.json) | 4 | 0 | 4/0 | 3 | 0 |
| [m01-report r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/m01-report-baseline-2.json) | 2 | 0 | 2/0 | 2 | 0 |
| [m01-report r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/m01-report-baseline-3.json) | 3 | 0 | 3/0 | 2 | 0 |
| [m02-options r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/m02-options-baseline-1.json) | 3 | 0 | 3/0 | 3 | 0 |
| [m02-options r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/m02-options-baseline-2.json) | 3 | 0 | 3/0 | 3 | 0 |
| [m02-options r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/m02-options-baseline-3.json) | 4 | 0 | 4/0 | 3 | 0 |

逐次回读的前后callId/seq、期间成功修改、输出hash/是否相同：共78条，见[read-backs.csv](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/read-backs.csv)；完全重复key及所有出现seq见[repeated-calls.csv](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/repeated-calls.csv)。这些计数不等于浪费或遗忘。

## 逐请求用量和上下文增长

| 组 | requestChars均值/中位/峰值 | 估算token均值/中位/峰值 | olderRounds均值/峰值 | 到阈值/可压缩 | 实际压缩 |
| --- | --- | --- | --- | --- | --- |
| S | 6001.06 / 4182.00 / 21434.00 | 1395.94 / 955.00 / 5195.00 | 0.28 / 5 | 0 / 0 | 0 |
| H | 15814.65 / 16580.00 / 44989.00 | 3760.68 / 3913.00 / 10993.00 | 1.41 / 7 | 13 / 11 | 0 |
| overall | 10262.22 / 6274.00 / 44989.00 | 2422.73 / 1437.00 / 10993.00 | 0.77 / 7 | 13 / 11 | 0 |

完整228次请求的seq/responseSeq/observationSeq、当前长度、worker估算变化、输入/输出token及累计已知和精确token见[逐请求表](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/request-growth.md)和[CSV](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/request-growth.csv)。各attempt累计独立归零；缺失usage必须null，不填0，本次无缺失。估算是当前上下文压力，累计token是费用维度，不互换。baseline压缩前后相同。

| 到阈值的attempt | 峰值估算token | 到6144阈值请求数 | 满足可压缩条件请求数 | 对应request seq |
| --- | --- | --- | --- | --- |
| [h01-config-pipeline r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h01-config-pipeline-baseline-1.json) | 6989 | 2 | 2 | 103, 110 |
| [h01-config-pipeline r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h01-config-pipeline-baseline-2.json) | 7316 | 4 | 4 | 99, 106, 113, 120 |
| [h01-config-pipeline r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h01-config-pipeline-baseline-3.json) | 6913 | 2 | 2 | 89, 96 |
| [h02-chunk-parser r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h02-chunk-parser-baseline-2.json) | 10993 | 5 | 3 | 58, 65, 75, 82, 89 |

仅4个attempt出现阈值观测；本次未发出的context_observation为0，未混入已发请求均值。8192是Context策略窗口，不是provider硬上限；本次baseline不裁剪，峰值10993不等于context_overflow。

## 客观终止

| termination | S | H | 整体 |
| --- | --- | --- | --- |
| completed | 24 | 3 | 27 |
| model_error | 0 | 2 | 2 |
| tool_limit | 0 | 7 | 7 |
| request_limit | 0 | 0 | 0 |
| timeout | 0 | 0 | 0 |
| context_overflow | 0 | 0 | 0 |
| cancelled | 0 | 0 | 0 |
| io_error | 0 | 0 | 0 |
| internal_error | 0 | 0 | 0 |

completed 27中4次acceptance_test失败；tool_limit 7；model_error 2均为单次输出4096 token、finish=length（h02 r1/r3 seq52），没有文件修改，不能称为provider宕机或补丁错误。原始termination保持不变；候选原因单独分析。

## 复核与局限

真实矩阵命令 `node --env-file=.env --import tsx eval/cli.ts --config experiments/baseline-deepseek.json` 退出0（表示矩阵完成，不表示36次均通过）。[独立计数](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/independent-counter.json)从原始result/journal复算并与派生数据一致；[复算说明](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/README.md)。

这是同一冻结12题的小规模诊断，未声称外部泛化或C/O因果收益。temperature=0和相同fingerprint不保证重复完全一致。M9必须在同一最终实现重新运行四组，不能将本次诊断baseline拼入主表。未修改题库、窗口、预算或运行时，未实现C/O。
