# Baseline Failure Analysis（模板，尚未运行）

M6固定输出reports/baseline-failure-analysis.md。即使全通过也必须输出，不虚构失败。必须满足[13](../docs/13-baseline-milestone.md)九项内容和Git完成门槛。

## 证据范围

baselineRunId、baselineImplementationCommit、benchmarkCommit/hash、实际配置、样本数量、verify结果、证据index路径。声明这是同一题库的探索性分析，不是保留集盲测。

## Failure Taxonomy

使用13的none/provider_or_io/resource_limit/tool_or_permission/wrong_target/missed_constraint/wrong_logic/unknown。列每类计数及全部task/repeat对应关系；termination/integrity/public/acceptance是客观结果，cause是有证据限制的解释，不相互替代。

## Per-task Trace Summary

逐项链接baseline-report中的所有attempt行，并补有依据的关键事件解释：读过什么、改了什么、哪里出错、是否纠正、最终断言。必须覆盖成功样本；不要求重复贴完整聊天。

## Repeated Tool Calls

引用每attempt重复/连续重复/回读计数和call ID；检查中间写入及输出变化。必要回读、重试修复与疑似无效循环分开描述，未知就写未知。

## Token / Context Growth与Model Rounds

引用逐轮表、估算当前上下文和API用量，不能以累计tokens替代context。分别列worker请求尝试/成功响应，辅助请求为0；检查是否达到阈值且有旧轮次可压缩。

## Tool Errors与Termination Reasons

列错误类型、原事件和是否被纠正；区分API故障、工具预算、上下文硬上限、正常结束但功能失败。只有预算失败不能证明遗忘。

## Representative Traces

每个实际出现的failure cause按taskId/repeat取第一例完整trace，另取第一成功例；全成功时选S/H各第一例，全失败注明无成功对照。记录原journal、事件范围、文件hash和摘录路径，不只截支持假设的一句话。

## Candidate Hypotheses

| ID | 观察事实/样本 | 事件与断言 | 候选C/O或无关联 | 预期改善指标 | 反证/替代解释 | 预算及成本风险 | 诊断状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| HYP-001（格式示例） | 待真实证据 | | | | | | supported / unsupported / inconclusive |

状态只表示是否值得检验，不表示已证实收益。没有证据则明确inconclusive；不能为了给C/O找理由重分类失败。

## M6完成核对

- 九项内容完整，所有数值/trace可追溯，无占位事实。
- 两份报告及index/代表trace单独Git提交，不含C/O实现。
- 提交后在progress记录真实SHA并通过F04；此前禁止主观实现/调优C/O追分。
- 后续C/O实现commit引用该SHA与HYP；M9在reports/ablation-report.md追加验证结果，不倒改原始分析。
