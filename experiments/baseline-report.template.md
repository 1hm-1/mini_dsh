# Baseline Report（模板，尚未运行）

M6固定输出reports/baseline-report.md；原始产物runs/<baseline-run>/。模板不是完成报告，所有数字和路径必须来自真实可核对证据。完成门槛见[13](../docs/13-baseline-milestone.md)。

## 版本与范围

- baselineRunId / baselineImplementationCommit：
- benchmark-v1 commit/hash、task IDs及S/H划分：
- 请求模型ID / actual model / fingerprint / provider / 参数：
- 预算、窗口、repeats、计划/完成attempt数：
- verify命令、退出码及结果路径：
- reports/evidence/<baseline-run>/index.json位置及完整run存储路径：

不要在本报告提交前伪填自身SHA；提交后真实baselineAnalysisCommit写入progress，后续机制/消融引用它。

## 分层汇总

| Suite | 成功/总数 | worker尝试/成功响应 | 总请求 | 工具调用/错误 | input/output tokens | Latency中位数 | context均值/峰值 | 可压缩条件次数 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S | 待运行 | | | | | | | |
| H | 待运行 | | | | | | | |
| Overall | 待运行 | | | | | | | |

baseline的optimizer/summary请求均为0。另列usage完整率/已知用量，termination和验收失败计数；失败样本的资源消耗不删除。

## 每任务、每重复的Trace摘要

| Task/repeat | passed/失败断言 | worker轮次/成功响应 | tool calls/errors | token用量 | latency | context峰值 | termination | 关键操作/改动 | journal定位 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 待真实记录 | | | | | | | | | |

覆盖全部成功和失败attempt，不能只列典型题。

## 重复调用

每attempt列exactRepeatCount、consecutiveRepeatCount、成功readBackCount及对应call ID；回读注明中间是否改动与output是否相同。重复不自动等于无效，解释与证据放failure-analysis。

## Token与Context增长

按task/repeat和request序号列input/output tokens、累计已知用量、requestChars、estimatedInputTokens、preCompressionEstimatedTokens、olderRounds、thresholdReached/compactionEligible。附peak与缺失字段说明；context_overflow未发请求单列观察事件，不能计为已发worker轮。

## 工具错误与终止

错误工具/错误码/事件/后续纠正、每个termination与独立验收判定。无错误也写0；正常结束但acceptance失败不可当作provider错误。

## 证据与局限

链接全部逐次结果、原始journal、代表trace索引及reports/baseline-failure-analysis.md。说明模型漂移、缺usage、全成功/无压力等实际限制；不要预写full会改善。
