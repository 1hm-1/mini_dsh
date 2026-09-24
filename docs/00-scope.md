# 00 范围与完成标准

## 工程范围不变

TypeScript strict、Node 24、npm lockfile；从零编写，不复制mini-dsh实现或成绩。保留mini-dsh级别插件/服务架构，不建新平台。

| 部分 | 首版范围 |
| --- | --- |
| 内核 | Context、ServiceRegistry、PluginRegistry，显式加载、依赖检查、逆序清理 |
| 服务 | Model/Tools/Permission/Session/Persistence/Events/AgentLoop |
| 模型 | HTTP + scripted mock，共同请求计量 |
| 工具 | 五个文件工具和精确写入白名单；不提供Shell/search |
| Session | 完整历史、JSONL、只读回放，无执行续跑 |
| C | 长度估算、LLM摘要、近期完整轮次保留 |
| O | 一次需求改写，不制定详细计划、不写代码 |
| CLI/评测 | 单次Agent、独立任务副本、外部验收、结果/report/verify |
| 题库 | S8基础题 + H4多文件/长约束题，共12个可信自建任务 |

Context的完整历史投影属于baseline基础能力；C的摘要机制必须在真实baseline分析之后实现。四组在同一总请求额度内比较，包含辅助调用。

## 顺序门槛

M0–M4先建基础工程和评测器；M5实际创建全部prompt/source/public/acceptance/reference并preflight、Git提交benchmark-v1；M6先跑真实baseline并写报告/失败分析；M7/M8再实现C/O；M9在同一最终版本重新跑四组。

提前写题目规格不等于冻结资产。提前选C/O候选能力不等于已有baseline证据支持；分析必须区分事实、假设与后续验证。无失败或压力时可如实将假设标为证据不足，不能制造证据。

## 完成状态分别报告

- 规划完成：当前文档/契约/工单一致，尚未实现或测量。
- 基础工程与Benchmark就绪：M0–M5通过，12题preflight与真实Git冻结完成；可运行baseline。
- Baseline证据完成：M6真实运行verify通过；reports/baseline-report.md与reports/baseline-failure-analysis.md覆盖13规定九项，证据索引/代表trace已单独提交Git；progress记录真实baselineAnalysisCommit，之后才进入M7。
- Harness实现完成：M7/M8完成、四组mock链路和回归通过；不能宣称已有性能收益。
- 对比实验完成：M9真实四组结果可核对，S/H分表、总预算与成本、机制触发、失败及限制完整报告。

无凭据/未授权付费运行则停在对应阶段并写缺项，mock只验证工程，不能跳过M6推进M7/M8。用户已授权开始开发；该授权不包含付费实验或远程发布，不伪造benchmark-v1提交。实际进度见progress。

## 不增加的要求

真实仓库任务、容器、大型题库、保留集、预注册、显著性检验、bootstrap、费用价格表、并发、复杂profile/hook、热替换仍为后续可选。Git固定小题库和先跑baseline是简洁证据流程，不要求构建研究平台。
