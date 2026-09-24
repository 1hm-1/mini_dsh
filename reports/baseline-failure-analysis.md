# M6 Baseline 失败分析

- baselineRunId: `2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b`; phase: `baseline-diagnostic`; provider: `http`.
- baselineImplementationCommit: `8d848c165546727585878e3b6b6613b647087781`; dirty: `false`.
- benchmarkCommit: `9fd463f618edfe25e8a683a62b7f540f3e644f90`; benchmark/hash: `benchmark/v1.json`, `d3d3321d3347017e58be60215e00a7ceb8e75fee5d4d77a2c07b0677160165a2`.
- 配置：[baseline-deepseek.json](../experiments/baseline-deepseek.json)；12题 × baseline × 3次，全部36次保留，无重跑/挑选。实际模型 `deepseek-flash`，全部fingerprint为 `aeb56401ca74e127821c4f9126dcb669`。
- endpoint `https://api.deepseek.com/chat/completions`；temperature=0，thinking.type=disabled，max_tokens=4096。每attempt共用16次模型请求、24次工具调用、120000ms、128000输入字符；上下文窗口8192、触发比例0.75、保留4轮。
- 独立 `eval:verify`：退出0，passed=true/errors=[]；[命令输出](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/verify.json)。[证据索引](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/index.json)；原始目录 `runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/` 保留于本地，未推送远程。

## 分类及逐attempt映射

termination、完整性和两类测试是客观记录；下列cause为候选主要原因，不表示模型内部心理状态。主评分23/36，失败13次；两层功能通过30/36，所有完整性检查通过。

| cause | 定义 | 数量 |
| --- | --- | --- |
| none | 主passed=true；仍可能有重复等效率现象 | 23 |
| provider_or_io | 有明确HTTP/解析/日志/运行环境故障 | 0 |
| resource_limit | 固定请求/工具/时间/输入或单次输出额度导致终止 | 9 |
| tool_or_permission | 参数/权限错误持续阻止必要操作；一次错误不足以判因 | 0 |
| wrong_target | 改动非实际调用链或遗漏正确目标，有代码/测试证据 | 0 |
| missed_constraint | 公开明确约束未实现；不推断内部是否记住 | 4 |
| wrong_logic | 目标正确而实现与需求不符，有输入输出证据 | 0 |
| unknown | 以上证据不足或无法可靠区分 | 0 |

工具错误和上下文压力保留为tags；功能已通过而额度耗尽的7次归resource_limit。finish=length输出额度也归resource_limit，但保留raw model_error。

| attempt | 客观termination / 主结果 | 候选cause | 审阅解释 | 关键seq |
| --- | --- | --- | --- | --- |
| [b01-normalize r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b01-normalize-baseline-1.json) | completed / True | none | Completed; integrity and both test layers passed. | 24, 38 |
| [b01-normalize r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b01-normalize-baseline-2.json) | completed / True | none | Completed; integrity and both test layers passed. | 28, 42 |
| [b01-normalize r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b01-normalize-baseline-3.json) | completed / True | none | Completed; integrity and both test layers passed. | 14, 28 |
| [b02-counter r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b02-counter-baseline-1.json) | completed / True | none | Completed; integrity and both test layers passed. | 24, 31 |
| [b02-counter r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b02-counter-baseline-2.json) | completed / True | none | Completed; integrity and both test layers passed. | 24, 31 |
| [b02-counter r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b02-counter-baseline-3.json) | completed / True | none | Completed; integrity and both test layers passed. | 14, 21 |
| [b03-config r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b03-config-baseline-1.json) | completed / True | none | Completed; integrity and both test layers passed. | 24, 59 |
| [b03-config r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b03-config-baseline-2.json) | completed / True | none | Completed; integrity and both test layers passed. | 28, 70 |
| [b03-config r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/b03-config-baseline-3.json) | completed / True | none | Completed; integrity and both test layers passed. | 28, 49 |
| [f01-tags r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f01-tags-baseline-1.json) | completed / True | none | Completed; integrity and both test layers passed. | 24, 38 |
| [f01-tags r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f01-tags-baseline-2.json) | completed / True | none | Completed; integrity and both test layers passed. | 24, 45 |
| [f01-tags r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f01-tags-baseline-3.json) | completed / True | none | Completed; integrity and both test layers passed. | 24, 45 |
| [f02-pagination r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f02-pagination-baseline-1.json) | completed / True | none | Completed; integrity and both test layers passed. | 14, 21 |
| [f02-pagination r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f02-pagination-baseline-2.json) | completed / True | none | Completed; integrity and both test layers passed. | 14, 21 |
| [f02-pagination r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f02-pagination-baseline-3.json) | completed / True | none | Completed; integrity and both test layers passed. | 14, 28 |
| [f03-ranges r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f03-ranges-baseline-1.json) | completed / True | none | Completed; integrity and both test layers passed. | 24, 38 |
| [f03-ranges r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f03-ranges-baseline-2.json) | completed / True | none | Completed; integrity and both test layers passed. | 24, 38 |
| [f03-ranges r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/f03-ranges-baseline-3.json) | completed / True | none | Completed; integrity and both test layers passed. | 24, 45 |
| [h01-config-pipeline r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h01-config-pipeline-baseline-1.json) | tool_limit / False | resource_limit | 24 tools dispatched; next tool blocked. Public 4/4 and acceptance 10/10 passed, but no final model completion. Permission denials on nonwritable paths are tags and an alternative efficiency explanation. | 62, 69, 100, 120, 121 |
| [h01-config-pipeline r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h01-config-pipeline-baseline-2.json) | tool_limit / False | resource_limit | 24 tools dispatched; next tool blocked. Public 4/4 and acceptance 10/10 passed, but no final model completion. Permission denials on nonwritable paths are tags and an alternative efficiency explanation. | 62, 69, 86, 103, 124, 125 |
| [h01-config-pipeline r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h01-config-pipeline-baseline-3.json) | tool_limit / False | resource_limit | 24 tools dispatched; next tool blocked. Public 4/4 and acceptance 10/10 passed, but no final model completion. Permission denials on nonwritable paths are tags and an alternative efficiency explanation. | 62, 69, 86, 112, 113 |
| [h02-chunk-parser r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h02-chunk-parser-baseline-1.json) | model_error / False | resource_limit | Raw model_error came from a valid finish=length response at the 4096 output-token cap; no files changed. The failing checks apply to unchanged source. | 52, 53 |
| [h02-chunk-parser r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h02-chunk-parser-baseline-2.json) | tool_limit / False | resource_limit | 24 tools dispatched, next blocked after state.mjs change; public 5/5 and acceptance 9/9 passed. Missing package.json and denied writes contributed tool cost. | 55, 69, 72, 86, 108, 109 |
| [h02-chunk-parser r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h02-chunk-parser-baseline-3.json) | model_error / False | resource_limit | Raw model_error came from a valid finish=length response at the 4096 output-token cap; no files changed. The failing checks apply to unchanged source. | 52, 53 |
| [h03-module-navigation r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h03-module-navigation-baseline-1.json) | completed / True | none | Completed; integrity and both test layers passed. | 68, 119 |
| [h03-module-navigation r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h03-module-navigation-baseline-2.json) | completed / True | none | Completed; integrity and both test layers passed. | 68, 113 |
| [h03-module-navigation r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h03-module-navigation-baseline-3.json) | completed / True | none | Completed; integrity and both test layers passed. | 68, 113 |
| [h04-issue-refactor r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h04-issue-refactor-baseline-1.json) | tool_limit / False | resource_limit | 24 tools dispatched, next blocked; public 3/3 and acceptance 7/7 passed after five writable source changes. No context threshold reached. | 60, 108, 109 |
| [h04-issue-refactor r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h04-issue-refactor-baseline-2.json) | tool_limit / False | resource_limit | 24 tools dispatched, next blocked; public 3/3 and acceptance 7/7 passed after five writable source changes. No context threshold reached. | 60, 92, 93 |
| [h04-issue-refactor r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h04-issue-refactor-baseline-3.json) | tool_limit / False | resource_limit | 24 tools dispatched, next blocked; public 3/3 and acceptance 7/7 passed after five writable source changes. No context threshold reached. | 60, 108, 109 |
| [m01-report r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/m01-report-baseline-1.json) | completed / False | missed_constraint | Completed, public 2/2, acceptance 4/5. The first overflow assertion expected parseOrders to reject a row product exceeding MAX_SAFE_INTEGER; after-state parser checks field sizes but omits row-product check. Aggregate assertion was not reached in that test. | 27, 30, 54, 68 |
| [m01-report r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/m01-report-baseline-2.json) | completed / False | missed_constraint | Completed, public 2/2, acceptance 4/5. The first overflow assertion expected parseOrders to reject a row product exceeding MAX_SAFE_INTEGER; after-state parser checks field sizes but omits row-product check. Aggregate assertion was not reached in that test. | 27, 30, 47 |
| [m01-report r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/m01-report-baseline-3.json) | completed / False | missed_constraint | Completed, public 2/2, acceptance 4/5. The first overflow assertion expected parseOrders to reject a row product exceeding MAX_SAFE_INTEGER; after-state parser checks field sizes but omits row-product check. Aggregate assertion was not reached in that test. | 27, 30, 54 |
| [m02-options r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/m02-options-baseline-1.json) | completed / False | missed_constraint | Completed, public 2/2, acceptance 3/4. Resolver throws TypeError for fractional precision 1.5; prompt requires RangeError for invalid precision. The test stops before later invalid values. | 33, 56 |
| [m02-options r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/m02-options-baseline-2.json) | completed / True | none | Completed; integrity and both test layers passed. | 30, 56 |
| [m02-options r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/m02-options-baseline-3.json) | completed / True | none | Completed; integrity and both test layers passed. | 30, 63 |

## 失败链路与反例

- h01全部3次先读取配置链，修改env-config/merge/validate，公开4/4、隐藏10/10通过，但已派发24工具后下一调用被阻止。r1错误seq62/69/100、终止121；r2错误62/69/86/103、终止125；r3错误62/69/86、终止113。权限错误消耗预算，可作为效率因素，不能证明必要修复受阻。
- h02 r1/r3读取后第3次模型响应seq52达到4096输出token、finish=length，seq53终止；未改文件，两层失败来自初始状态。r2修改state.mjs，两层全部通过，seq108/109工具额度终止，期间有缺文件和权限错误。
- h04全部3次修改5个目标文件，两层测试通过，24工具后阻止第25次；终止seq109/93/109。无工具错误，context阈值均未到达，说明不能把所有H失败都解释为Context问题。h03全部成功，在22–24工具范围结束，是达到较多调用仍可完成的反例。
- m01全部3次公开2/2、隐藏4/5，均正常结束。公开prompt要求行或聚合的quantity/cents total超过MAX_SAFE_INTEGER抛RangeError；parser仅检查字段大小，缺少quantity×unitPriceCents溢出检查。验收`overflow in row and aggregate is rejected`在首个行乘积断言报告缺RangeError；同一测试的后续聚合断言未执行，不能声称两者独立失败。r1修改seq27/30/54、结束68；r2结束47；r3结束54。
- m02 r1正常结束，公开2/2、隐藏3/4。prompt明确precision必须是0–4整数，否则RangeError；实际1.5分支抛TypeError。`invalid overrides and values use specified errors`在此停止，未把后续输入算作独立失败。修改seq30/33/36、结束56。r2/r3通过是同一需求可被baseline满足的反例。

公开需求定位：[m01 prompt](../benchmark/tasks/m01-report/prompt.md)、[m02 prompt](../benchmark/tasks/m02-options/prompt.md)。每次after/changes和失败断言见[全量trace摘要](baseline-report.md#全部36次trace摘要)及对应JSON；重复/增长/模型轮数见同报告和全量CSV。m01/m02均未到Context阈值，遗漏边界要求不等于超过窗口或遗忘。

## 全部工具错误及后续行为

共13次：S=0、H=13。下表列callId和start/end seq，下一worker请求/成功响应及同路径后续成功操作。read成功不等于先前写失败已纠正；同key成功只按完全相同参数认定。7次未派发tool_limit不计入此表。

| attempt | callId | 调用 | 错误 | start/end | 下一请求/成功响应 | 同路径后续成功操作 | 是否纠正/结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [h01-config-pipeline r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h01-config-pipeline-baseline-1.json) | call_00_1j38kA5h0HuCOrEJjijA7190 | write_file src/file-config.mjs | permission_denied | 61/62 | 65/66 | read_file@92 | 后续未成功修改被拒路径；其他白名单修改已通过验收。 |
| [h01-config-pipeline r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h01-config-pipeline-baseline-1.json) | call_00_wrNzee40QqA2Z8cVA31K0953 | edit_file src/file-config.mjs | permission_denied | 68/69 | 72/73 | read_file@92 | 后续未成功修改被拒路径；其他白名单修改已通过验收。 |
| [h01-config-pipeline r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h01-config-pipeline-baseline-1.json) | call_00_u1l9jUTuZIQwThyCWy7e9313 | write_file src/file-config.mjs | permission_denied | 99/100 | 103/104 | 无 | 后续未成功修改被拒路径；其他白名单修改已通过验收。 |
| [h01-config-pipeline r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h01-config-pipeline-baseline-2.json) | call_00_BnaGvOR61L8a4M1JZvdl0916 | write_file src/file-config.mjs | permission_denied | 61/62 | 65/66 | 无 | 后续未成功修改被拒路径；其他白名单修改已通过验收。 |
| [h01-config-pipeline r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h01-config-pipeline-baseline-2.json) | call_00_Zj5Vg8xapJ3yQzrYm41n0628 | edit_file src/file-config.mjs | permission_denied | 68/69 | 72/73 | 无 | 后续未成功修改被拒路径；其他白名单修改已通过验收。 |
| [h01-config-pipeline r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h01-config-pipeline-baseline-2.json) | call_01_EpVqYTa6farJz18knf0R8235 | edit_file src/merge.mjs | edit_no_match | 85/86 | 89/90 | read_file@92 | 该次文本替换未匹配；原先merge修改已存在，最终两层通过。 |
| [h01-config-pipeline r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h01-config-pipeline-baseline-2.json) | call_00_NlbsL2ZXU1lRwYxpUfTo3742 | delete_file src/file-config.mjs | permission_denied | 102/103 | 106/107 | 无 | 后续未成功修改被拒路径；其他白名单修改已通过验收。 |
| [h01-config-pipeline r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h01-config-pipeline-baseline-3.json) | call_00_d3eNdtoF4YDOLwjIh5xo4291 | write_file src/file-config.mjs | permission_denied | 61/62 | 65/66 | read_file@108 | 后续未成功修改被拒路径；其他白名单修改已通过验收。 |
| [h01-config-pipeline r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h01-config-pipeline-baseline-3.json) | call_00_0FR1w5T8t0xvOFnjGV7S2652 | edit_file src/file-config.mjs | permission_denied | 68/69 | 72/73 | read_file@108 | 后续未成功修改被拒路径；其他白名单修改已通过验收。 |
| [h01-config-pipeline r3](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h01-config-pipeline-baseline-3.json) | call_00_JEv4ewbmkSmxFk2wbUyS9219 | edit_file src/index.mjs | permission_denied | 85/86 | 89/90 | 无 | 后续未成功修改被拒路径；其他白名单修改已通过验收。 |
| [h02-chunk-parser r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h02-chunk-parser-baseline-2.json) | call_00_JOlOWVl6Nh9RIn7i2VQp9370 | read_file package.json | file_missing | 54/55 | 58/59 | 无 | 缺失路径未成功读取；继续处理state，最终两层通过。 |
| [h02-chunk-parser r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h02-chunk-parser-baseline-2.json) | call_01_w0csiSp0qd05EfKYZ1Kp5561 | write_file src/assembler.mjs | permission_denied | 71/72 | 75/76 | 无 | 后续未成功修改被拒路径；其他白名单修改已通过验收。 |
| [h02-chunk-parser r2](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/attempts/h02-chunk-parser-baseline-2.json) | call_00_oY3mYzfHuaL6jNP7uQsd5254 | write_file scratch.test.mjs | permission_denied | 85/86 | 89/90 | 无 | 后续未成功修改被拒路径；其他白名单修改已通过验收。 |

完整参数、后续所有工具seq及同key成功seq见[tool-errors.csv](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics/tool-errors.csv)和attempt JSON。连续被拒写不能单凭错误次数归为tool_or_permission主因：这些attempt已通过功能测试，其客观失败是终止额度。

权限可发现性是限制：当前worker接收原任务prompt及工具schema，未显式注入TaskSpec.writable的完整精确列表。H prompt虽提及允许路径边界，但不等于完整列表已经展示。因此不能把权限拒绝说成“忘记已展示白名单”，也不能让O凭空补充不可见信息。本次保留题库v1与运行实现，不在分析后修题调预算。

## 固定规则代表性trace

按taskId/repeat排序，对每个出现的失败cause取第一例，并加第一成功对照：resource_limit=h01 r1，missed_constraint=m01 r1，none对照=b01 r1。以下保留完整事件区间以免挑片段，附评分和文件变化引用；不是只截最终答案。

- [h01-config-pipeline r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/traces/h01-config-pipeline-baseline-1.json)：resource_limit，seq 1–121；原journal SHA-256 `379fb48b9f44e41f149fbd16b0ea159b3bddaa8f8530f5aa80d420fe6bcac65d`。
- [m01-report r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/traces/m01-report-baseline-1.json)：missed_constraint，seq 1–68；原journal SHA-256 `ae622ab94c398c88d2351d8a8dc32948909f314a28afba4ff4f226f298bab411`。
- [b01-normalize r1](evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/traces/b01-normalize-baseline-1.json)：none，seq 1–38；原journal SHA-256 `3624a8fbfe977facf2f61ddfb8d60d3a408aa1f0d2f2310c5fd1a4c381e4d439`。

## 候选假设（仅诊断支持程度）

### HYP-001：压缩可降低部分长交互的请求长度 — inconclusive

观察：h01 r1/r2/r3、h02 r2合计13次触及6144阈值，11次满足可压缩条件；峰值分别6989/7316/6913/10993。事件定位为[逐请求表](baseline-report.md#逐请求用量和上下文增长)所列request seq，对应原始context_observation及olderRounds。候选C以摘要保留任务约束、已修改文件和工具结果，并减少旧历史体积；不增加规划器或结束前验证门禁。预期指标是后续worker输入估算/字符减少、真实压缩次数、总token/延迟及主成功率。

替代解释：这些失败客观上为工具额度，不是硬上下文超限；权限发现、冗余读取或任务难度也可解释调用多。h04没有触发仍失败；h03接近阈值仍成功。风险：摘要丢细节且summary占共享16次总模型预算，可能降低worker可用轮数。反证：M9无自然压缩、请求长度未降、总成本更高且成功率不改善或下降，均不能支持C收益。当前只有可触发证据，没有失去上下文的直接证据。

### HYP-002：初始约束重述可能减少遗漏边界 — supported（值得检验）

观察：m01三次遗漏公开行乘积溢出要求，m02 r1错误异常类型；上述改动/结束seq及验收断言可定位。候选O仅一次精简、无损地重述公开要求（包括范围和异常类型），不引入计划、隐藏验收或额外权限信息。预期指标是相应约束失败次数、主成功率、optimizer成本及总token/延迟。

替代解释：任务逻辑理解或模型随机变化足以解释；m02 r2/r3原baseline已通过，不能声称一定需要O。风险：重述漏义或引入错误，且占16次共享预算中的一次。反证：M9相同边界仍失败、引入其他失败、仅增加成本或与baseline无稳定差别，则不支持收益。supported仅指明确可见约束与失败有对应证据，绝不表示O已被证明有效或内部遗忘已成立。

### HYP-003：C/O能直接解除固定额度失败 — unsupported

观察：h02 r1/r3 response seq52输出4096且finish=length；h01/h02 r2/h04的24工具派发及终止事件明确。C和O均无直接提高输出/工具额度的机制。预期核对指标为tool_limit及length错误数、主成功率、工具/模型调用总数。

替代解释：改写或压缩可能间接改变调用/输出行为，但baseline单组无法证明；h04未触发C是直接归因C的反例。成本风险是辅助请求挤占16次预算且不增加工具额度。反证/后续修正条件：若M9在固定额度下相关终止减少，应检查trace确认间接路径，再在消融报告追加解释；不可回写本报告为事前已证明有效。不得为获得full优势提高额度、丢失败或挑重跑。

## 边界与后续门槛

全部36次保留，不以mock补真实样本；本次只有baseline，无法给出C/O因果结论。少量自建任务、同题重复、不显式展示完整白名单及外部判定器可见性限制了推广。五种文件工具没有shell，回读不是运行测试，未新增结束验证门禁。

本报告和证据先独立Git提交；随后progress记录真实baselineAnalysisCommit才可标M6 DONE。M7/M8需核对该提交为HEAD祖先，关联HYP编号；M9重新跑同题库同实现的四组并追加消融解释，保留M6原文。
