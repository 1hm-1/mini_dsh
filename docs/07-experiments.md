# 07 先诊断，再做2×2消融

## 不变的公平性

| 组别 | Context Manager（C） | Prompt Optimizer（O） |
| --- | ---: | ---: |
| baseline | 0 | 0 |
| context | 1 | 0 |
| optimizer | 0 | 1 |
| full | 1 | 1 |

唯一来源specs/variants.json。四组同模型/温度/Loop/工具/权限/任务/预算/验收。关闭C只关摘要，关闭O只省改写；不移除baseline的必要功能。

**Auxiliary requests consume the same global model-request budget.** 默认总共16次：worker+optimizer+summary。baseline最多16次worker；full若花1次optimizer和2次summary，最多剩13次worker。辅助请求没有免费额度，报告必须分项展示；不能把这种约束下的结果称为等worker预算实验。equal-worker-budget仅为未来补充，不进入v1主实验。

## 三种实验用途

| 阶段 | 矩阵 | 默认次数 | 用途 |
| --- | --- | ---: | --- |
| M6诊断baseline | 12题×baseline×3次 | 36 | 先取得真实日志，分析失败/压力 |
| M9快速对照（可选） | 12题×baseline/full×2次 | 48 | 实现后快速比较，不能代替完整消融 |
| M9完整消融 | 12题×4组×3次 | 144 | 最终主比较和两因素消融 |

M6可在开跑前选择2次=24次，必须写清；后续矩阵重复数亦必须预先确定、按实报告。完整默认流程为36+144=180次，若另跑48次快速对照则共228次，不把前期baseline调用隐去。当前只规划，不自动执行付费运行。

M6来自机制实现前的代码，供诊断使用；M9必须在同一最终commit下新跑baseline/context/optimizer/full，不能挪用旧baseline作最终对照。模型实际版本/fingerprint变化要记录，无法控制时说明时间漂移限制。新增机制过程如改变共用代码必须让baseline回归通过；发生工程缺陷则新runId，旧失败保留。

## 先固定题目与配置

M5固定所有任务资产和benchmark-v1的commit/hash。M6启动前保存实际模型、共同预算与上下文配置；M7/M8后M9沿用这些参数。若必须变更，作为新协议另跑可比baseline，不原地覆盖。

默认8192估算窗口、0.75阈值、4个近期完整轮次不因观察结果降低。题目不保证触发C；零触发或Optimizer纯增成本也可成为结论。

## 调度

task按ID排序，variants按specs顺序筛选；外层repeat从1开始，其次task，内层variants。第t题（0起）第r次将variants左移(t+r-1)%组数。先落盘完整schedule，再串行执行。

M6只有baseline，顺序用于复现；M9交错各组，避免先跑完一组。失败保留，无自动retry。子集调试明确列taskIds，不能冒充12题完整结果。样本缺失或日志incomplete时verify失败，只出诊断表。

## 指标

主表分别给Benchmark-S、Benchmark-H；附12题整体。成功率=严格passed/计划且完整记录的attempt数，给分子/分母；重复不取最佳，不叫pass@k。

必须报告：成功率及full-baseline百分点差；Model Requests总数与worker/optimizer/summary分项；Tool Calls/Errors；input/output/总Tokens；Latency均值/中位数；Context Length均值/峰值；Termination Reason和验收失败类型；compactions。

Context Length采用每次worker请求实际发送前的requestChars和estimatedInputTokens，估算公式与C阈值一致；另给压缩前估算长度、近期外旧轮次数、达到触发条件请求数。不能以整场累计input tokens代替当前上下文长度。API prompt_tokens如有单独报告，不与粗估混用。summary和optimizer请求长度亦保存，主context表默认只统计worker。

所有成本包含失败与辅助调用。usage缺失则总量null，列已知部分/完整率；不填0。验收耗时另列。首版只报token，不估美元价格，不做显著性或bootstrap承诺。

## 失败分析与机制解释

M6输出reports/baseline-report.md、reports/baseline-failure-analysis.md，两份都引用runId/benchmarkCommit/config和可复算产物。对每个失败保存task/repeat、终止原因、测试断言、相关journal事件、修改路径。区分模型/网络故障、工具参数/权限错误、导航选错文件、功能/边界遗漏、上下文硬超限、请求预算耗尽；没有证据时标unknown。

大量token、重复read或request_limit只能提示可能的问题，不能单凭这些指标断言“遗忘”。把观察、候选解释、C/O可能帮助、反证/替代解释分列。C/O是预选的候选能力；只能说baseline证据支持/不支持某个假设，不能声称它们都是看过日志后首次提出。

M9比较context-baseline、optimizer-baseline、full-optimizer、full-context，不将单项差值机械相加。全部100%注明饱和；零压缩注明未评估压缩生效后收益；full退化直接报告。冻结不等于盲测：这是用同一题库诊断再对照的探索性项目，不能宣称独立泛化验证。

## 分析提交是里程碑

必须包含[13](13-baseline-milestone.md)的九项分析及固定trace选择规则。先把M6报告/索引/摘录独立提交，记录baselineAnalysisCommit；再由M7/M8实现提交引用它与HYP编号。M9报告路径为reports/ablation-report.md，追加假设验证结果，不倒改M6分析。该提交关系能检查开发先后，不能单凭Git证明因果收益或不可伪造时间。
