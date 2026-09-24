# 13 M6 Baseline Experiment & Failure Analysis：正式里程碑

本文件定义M6的完成门槛。本次M6已按下列门槛完成，真实run与分析提交见[progress](progress.md)及[报告](../reports/baseline-report.md)。M6不是跑完API就结束，也不是项目完工后补写故事；必须先形成可追溯分析，再进入C/O实现。

## 前置与固定输出

前置：M0–M5验收完成，12题实际资产已在benchmark-v1提交固定，真实模型与本次运行授权可用。候选C/O接口可以事先定义，摘要/改写机制不得提前实现。

```text
runs/<baseline-run>/                         全部原始attempt、journal、用量、验收和verify结果
reports/baseline-report.md                   数值报告，S/H/整体及逐任务结果
reports/baseline-failure-analysis.md         事实、分类、trace分析、候选假设
reports/evidence/<baseline-run>/index.json   证据索引与SHA-256
reports/evidence/<baseline-run>/traces/      代表性脱敏trace摘录和事件定位
```

M6完成提交跟踪两份报告及证据索引、代表性摘录。runs可继续gitignore，但必须保留完整目录，并在index记录可读取的路径；不得只留失效临时目录或截图。无需新增远程归档平台或自动上传。向他人交付可复现材料时同时交付run目录；只有Git中的报告不等于全部原始证据已公开。

## 必须包含的九项分析

| 项 | 内容与最低要求 |
| --- | --- |
| failure taxonomy | 明确分类定义、分类计数、逐attempt映射；原始终止/验收结果与推测原因分开 |
| per-task trace summary | 覆盖每个task及全部repeat，包括成功；每行给关键操作、结果、事件索引与文件差异 |
| repeated tool calls | 每attempt记录完全相同调用的重复数、连续重复数、相同路径回读；区分中间是否修改，不自动判为浪费 |
| token/context growth | 每轮输入/输出token和累计已知用量；worker上下文估算曲线/表、峰值、阈值及可压缩条件；缺失usage明确null |
| model rounds | worker请求尝试数、成功响应数、总请求数；baseline的optimizer/summary均为0 |
| tool errors | 数量、工具名、错误码、call/事件ID及模型后续是否纠正；0也列出 |
| termination reasons | 每attempt明确termination；正常结束但测试失败也保留独立判定，不能全混为model_error |
| representative traces | 按下述固定规则选摘录，附完整journal路径、事件范围和SHA-256；有成功对照或注明没有 |
| candidate hypotheses | 以稳定ID列观察、证据、候选机制、替代解释、预期指标与反证；状态supported/unsupported/inconclusive只评价诊断支持程度 |

单独总表、最终答案、成本数字或截图均不能替代逐任务trace分析。不要求人工复述每条消息：数值/重复调用表由eval后处理生成，事件因果解释由分析者审阅并引用证据。首版无需新增模型来生成分析。

## 失败分类与推断边界

记录两个独立维度：

1. **客观结果**：termination、integrity、public/acceptance判定及具体失败断言，从产物直接读取；可以并存多个失败信号。
2. **候选主要原因**：以下枚举中选择一个；证据不足用unknown，其他因素放tags，不强凑原因。

| cause | 使用条件 |
| --- | --- |
| none | 主passed=true；成功样本仍可有工具错误和效率问题 |
| provider_or_io | HTTP/解析/日志/运行环境错误有明确事件 |
| resource_limit | 请求/工具/时间/硬上下文额度导致终止；记录具体额度，不能据此断言遗忘 |
| tool_or_permission | 具体参数/权限错误持续阻止必要操作，有trace证据；出现过一次错误不足以判因 |
| wrong_target | 改动了非实际调用链或未改正确目标，有源码调用链/测试证据 |
| missed_constraint | 公开的某项明确约束未实现，给prompt片段和失败断言；不推断模型内部是否记住 |
| wrong_logic | 目标正确但实现逻辑与需求不符，有输入/输出或代码证据 |
| unknown | 以上原因无法可靠区分或证据不足 |

上下文压力、反复读取、长需求是观测tag，不自动等于主因。因果关系不能由baseline单组证明。多种候选原因都合理时选unknown并列替代解释，不强制归为C/O能解决的问题。

## 重复调用、轮数与增长的可复算口径

- Tool call key = 工具名 + 参数JSON递归键排序后的序列化；无效JSON用原始字符串。只在同一attempt统计，不跨任务。
- exactRepeatCount = 对每个key累计max(出现次数-1,0)；consecutiveRepeatCount只数相邻两次工具调用key相同的后一次。
- readBackCount：同一路径read_file第二次及以后调用数；每条记录前次read之后是否有成功write/edit/delete该路径，以及两次可见output是否完全相同。读取失败仍占调用预算，但不计成功回读，单列错误。
- 完全重复调用、修复后回读和必要验证可能合理。报告只能说重复，不可仅凭计数称无效循环；模型反复犯错的判断需要事件解释。
- worker rounds明确为worker请求尝试数，另外列成功响应数；不能把HTTP失败算成成功推理轮。modelRequests=worker+optimizer+summary，baseline后两项为0。
- context按每次请求的当前长度，token累计是费用/用量维度，不能相互替代。图不是必须，按request序号的表即可。上下文硬超限的未发出请求从context_observation单列，不混入已发请求均值。

## 代表性trace选择

按taskId、repeat排序；对每个实际出现的失败cause选第一条完整trace；另选第一条成功attempt作为对照。同一attempt重复命中只保留一份，分类重复引用即可。unknown照样选，不因为难解释省略。

若全部成功，选S和H各第一条成功trace，注明无失败；若全失败，注明无成功对照。摘录必须覆盖任务、相关请求/工具错误/改动、终止和验收结果，不能只截看似支持假设的一句回答。完整日志保留，摘录引用原事件seq和文件hash。

## 候选假设记录

每条HYP-001等编号包含：观察到的现象；task/repeat/事件引用；C或O或“二者均无直接帮助”；预期改善指标；成本风险（包括16次总预算）；替代解释；可推翻该解释的结果；状态。

supported表示baseline证据使这个假设值得检验，绝不表示机制已被证明有效。后续M9对同一hypothesis ID追加supported-by-ablation / not-supported / inconclusive的结果解释，不能反写M6原文。若没有支持证据，允许如实写能力待验证，但不能以简历需要为由伪造问题。

## Git完成门槛与后续关联

1. 全部计划baseline attempts与verify完成，九项内容齐备，报告无占位数字/假trace。
2. 两份报告头部记录baselineRunId、baselineImplementationCommit、benchmarkCommit/hash、实际model/config、verify结果和证据索引位置。index记录每个原始产物相对run路径、大小、SHA-256，以及脱敏说明。
3. 在**不包含C/O机制代码**的独立提交中提交报告、index和摘录，提交说明建议m6-baseline-analysis。Git diff应只有分析/证据相关文件，不搭车加入机制实现。
4. 该提交产生后，在docs/progress.md后续记录其真实SHA并单独保存进度提交，状态才改M6 DONE；不能在提交自身写自己的SHA，不能仅以未来提交名称冒充证据。
5. M7/M8开始前检查该SHA可解析、包含固定两份报告和index，F01/F02/F04通过，且它是当前HEAD祖先。机制提交注明baselineAnalysisCommit和相关HYP编号；不改写/压缩历史以消除先后关系。
6. M9生成reports/ablation-report.md，记录同一benchmark、最终运行commit、baselineAnalysisCommit、context/optimizer实现提交与HYP结果；最终四组仍需同版本新跑baseline。

本地Git历史提供可检查的开发先后记录，不是不可伪造的时间证明，也不替代真实日志。不得倒填日期、伪造SHA、把事后分析重写成事前发现。要修正分析应追加更正提交，保留原报告历史和原始run。

## 禁止抢跑

M6 DONE前，禁止基于主观判断实现/修改/调优Context摘要和Optimizer来追求成绩；禁止改窗口、给辅助请求免费预算、改冻结任务或挑重跑。基础运行/计量bug可以修复，但要独立提交、解释原因、保留旧run，并在修复版本重跑受影响baseline；这不是跳过M6的借口。

没有真实模型凭据或运行授权则M6待运行，M7/M8不开始。不得创建空reports冒充里程碑完成。
