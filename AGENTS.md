# 执行规则

用户已于2026-09-24要求开始开发，授权GPT-6 Sol（medium）子智能体实现，由主智能体负责架构审阅与验收。按子工单推进M0–M9，当前状态见docs/progress.md。用户最新要求优先：规模接近 mini-dsh，重点是可实现的 baseline/full 对照评测，不扩大运行时难度；增加4道Harness场景题，并按“题库冻结→真实baseline分析→C/O→消融”推进。

M9执行授权更新：用户指定GPT-6 Luna（high）子智能体执行真实四组消融及证据整理，主智能体审阅配置、归因与最终验收；沿用DeepSeek评测模型及固定144次矩阵。执行子智能体模型不属于实验因素。

## 工作方式

1. 阅读 README、00-scope、10-decisions 和当前工单。
2. 查看 git status，保留用户无关修改。
3. 按08的依赖顺序完成一个子工单；不要一次铺开所有模块。
4. 遵循接口、允许文件和验收编号。先补相关测试，再实现、运行检查。
5. 在 progress 记录实际命令、退出码和证据；未运行不能写成通过。
6. 前置工单验收失败时先修复，不绕过断言进入下游。

## 实验先后门槛

M5必须交付12题实际资产、preflight和benchmark-v1 Git提交；M6真实baseline报告/分析完成后才能实现M7/M8的C/O。提前定义接口允许，提前实现机制不允许。没有凭据/授权就标实验待运行，不以mock替代或跳过。最终M9重新跑包括baseline在内四组，早期诊断baseline不直接拼入最终主表。题库/窗口不根据full收益改动；必要改题创建新版本并重做baseline。

## M6正式完成条件

必须遵守[Baseline里程碑](docs/13-baseline-milestone.md)。固定输出为runs/<baseline-run>/、reports/baseline-report.md、reports/baseline-failure-analysis.md以及reports/evidence/<baseline-run>/证据索引/代表性trace。九项分析齐全、verify通过后，先单独提交Git，再在progress记录真实baselineAnalysisCommit，才可标M6 DONE。

在此之前禁止根据主观判断实现、修改或调优Context摘要/Optimizer追求成绩。M7/M8必须核对该分析commit为HEAD祖先，提交关联HYP编号；M9的reports/ablation-report.md关联同一题库、分析commit和机制实现commit。不得事后重写M6报告冒充事前发现。仅基础工程bug修复可先做，并记录/重跑受影响baseline。

## 权威和边界

用户要求 > 本文件 > 10-decisions > 专项规格 > 工单。实验组唯一来源为 specs/variants.json。普通内部实现选择自行决定；影响公共接口、权限、评分或组间公平性的歧义，记录 open-questions，先完成其他明确部分，再请求决定。

- 保留“一切产品能力皆插件”：Model、Tools、Permission、Session、Persistence、Events、Context、Optimizer、Agent Loop 都通过插件注册服务。
- 内核只做服务注册、依赖检查、顺序加载和逆序清理，不实现 Agent 策略。
- 不增加热重载、复杂profile继承、插件市场、通用hook系统、评测插件平台、多Agent、RAG或Web UI。
- 不增加规划器或结束前验证门禁；首版研究因素只有Context Manager和Prompt Optimizer。
- 从零编写运行时与评测代码，不import/copy mini-dsh实现；可参考其接口职责和实验经验。
- 不让 src import eval；隐藏验收、参考补丁、其他组输出不得进入模型工作区。
- 四组共用模型、工具、安全规则和预算；辅助模型调用也计数。
- 不把mock成绩写成真实模型成绩；不为获得full优势改题、丢失败记录或挑选重跑结果。
- 不把临时目录或Node权限机制称为操作系统沙箱；首版只执行可信自建任务。
- 不自动启动未要求的付费实验或发布远程仓库。

修改已报告实验的任务/配置/实现时使用新runId，保留旧证据。无需建立正式预注册流程，也不以引入高级统计作为首版验收条件。
