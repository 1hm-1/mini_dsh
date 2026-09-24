# 08 实施顺序：Benchmark → Baseline证据 → 机制 → 消融

用户已于2026-09-24要求开始实现，从M0.1按子工单推进；实际状态及验收证据见progress.md。M0–M4保持小型工程范围，M5固定任务资产，M6真实baseline与分析完成后才开始M7/M8。当前C/O只是事先选定的候选能力，不得倒写成已经由实验发现的解决方案。

共同要求：每次一个子工单，接口和允许文件明确，实际命令/退出码/证据写progress。前置未过不进入下游。普通内部选择自行处理，公共评分/公平性歧义记录open-questions。

## M0 工程与接口

依赖：用户明确要求实现。读00/01/02/11。

- M0.1 package/lock、tsconfig strict、gitignore、环境示例、tests；仅TypeScript、tsx、Node类型，无Agent框架。
- M0.2 插件/服务/配置/任务/结果接口及显式校验；variants唯一来源specs。先定义C/O接口，不实现其机制。

允许工程和契约文件及tests。验收A01。scripts只在入口存在时增加。

## M1 Plugin Kernel与Session

依赖M0。

- M1.1 context/service-registry/plugin-registry：给定顺序、依赖检查、逆序清理。
- M1.2 events、JSONL persistence、memory session和只读日志解析。

允许内核与对应插件/tests；不加通用hook/热替换。验收K01–K04、R06的Session部分。

## M2 Tools

依赖M1。

- M2.1 permissions/tools：统一schema、白名单、参数校验。
- M2.2 五个文件工具：路径边界、唯一编辑、原子写和删除规则。

允许对应插件/tests；不加Shell/容器。验收T01–T04，不请求API。

## M3 Baseline Agent Runtime

依赖M2。

- M3.1 accounting、mock/http模型：统一请求计数、usage、上下文长度和取消；fake HTTP验证。
- M3.2 context-manager只做完整投影，enabled=false；agent-loop预算和串行工具。
- M3.3 runtime/CLI一次执行，baseline装配，finally清理；mock读→改→final链路。

允许基础runtime/插件/CLI/tests，禁止compaction和Optimizer实现。验收R01–R07、A02；完成后有真正可工作的baseline Coding Agent。

## M4 Evaluator

依赖M3。

- M4.1 任务加载、独立副本、快照/changes；独立smoke fixture不算Benchmark。
- M4.2 外部judge/preflight，保护测试，初始失败/reference通过，超时与测试完成检测。
- M4.3 参数、轮换schedule、逐次结果、失败保留、benchmark hash检查。
- M4.4 report/verify，记录成功率、请求/工具、token、耗时、上下文长度、终止原因。

允许eval/**和测试fixture/tests。runner此时仅接受baseline，其他组明确报尚未实现；禁止静默按baseline执行。验收E01–E07、S01–S03的单组/手工多组部分，真实四组集成留到M9。此阶段不写C/O实现。

## M5 Benchmark v1：先做完整资产，再冻结

依赖M4。

- M5.1 完成Benchmark-S原8题的prompt、workspace、public tests、acceptance tests、reference patch。
- M5.2 完成Benchmark-H的4题，按06提供跨文件关联、合理无关文件和完整长约束；不加runtime能力。
- M5.3 对全部12题preflight：初始acceptance失败、reference公开/独立验收均过、补丁不越界。生成benchmark/v1.json列出12题的suite、路径和资产hash。
- M5.4 提交完整任务资产、manifest与预检证据，Git提交说明为benchmark-v1，记录真实完整commit SHA。不能只提交题目表或用占位hash声称冻结。

允许benchmark/**、preflight证据和文档；禁止修改模型提示、C/O代码以迎合题目。验收B01–B03、E07。冻结后主流程不改题或缩窗口，必要修正另建benchmark-v2并重做baseline；v1证据保留。

## M6 Baseline Experiment & Failure Analysis（正式里程碑）

依赖M5，真实模型凭据与该次运行授权可用。详细门槛见[13](13-baseline-milestone.md)。固定产物：runs/<baseline-run>/、reports/baseline-report.md、reports/baseline-failure-analysis.md、reports/evidence/<baseline-run>/。

- M6.1 明确同一model/endpoint/temperature及共同预算；保存baseline实验配置、benchmarkCommit/hash。默认12题×baseline×3次=36次，可在运行前统一改为2次=24次，报告准确重复数。
- M6.2 完整执行并verify，保留成功/失败全部journal、改动和测试输出。
- M6.3 生成reports/baseline-report.md：S/H分表及总表；成功率、Model Requests、Tool Calls/Errors、Tokens、Latency、Context Length、Termination Reason。
- M6.4 生成reports/baseline-failure-analysis.md：逐任务/重复记录失败模式、journal事件引用、预期机制关联及反证；明确哪些问题C/O可能无帮助。若无失败，则分析上下文触发条件与额外开销的研究价值，不能虚构失败。
- M6.5 完成13规定的九项：failure taxonomy、per-task trace summary、repeated tool calls、token/context growth、model rounds、tool errors、termination reasons、representative traces、candidate hypotheses。成功/失败全覆盖，假设分配HYP编号，明确supported/unsupported/inconclusive只是诊断状态。
- M6.6 verify和F01/F02内容验收通过后，将两份报告、证据索引和trace摘录单独提交（建议说明m6-baseline-analysis），不包含C/O代码；提交后完成F04的Git检查，再在progress记录真实SHA，M6才可DONE。不能仅有本地未提交报告就开始M7。

允许实验配置、结果和报告，不允许同runId调题/调窗口/反复重跑替换失败。验收F01/F02/F04、S04、E05/E07。无凭据或未授权时停在“baseline实验待运行”，可继续无依赖文档/测试整理，不能跳到C/O实现并称顺序已满足。mock不能替代这一步。

## M7 Context Manager

依赖M6 DONE；先核验baselineAnalysisCommit包含报告与索引且为HEAD祖先，禁止提前按主观判断优化C。

- M7.1 记录baselineAnalysisCommit及HYP编号，根据记录的上下文长度、回读、遗漏或预算终止证据说明实现目的与局限；基础算法仍按03，不假装每种失败都是context问题。
- M7.2 实现阈值、LLM摘要、完整轮次保留、历史边界、共同计量。
- M7.3 开放context组，baseline行为保持兼容；用mock长历史测试触发，不改Benchmark v1或默认窗口。

允许context-manager、装配和tests；禁止免费summary额度。验收C01–C03、R07。

## M8 Prompt Optimizer

依赖M6 DONE和M7；核验同一baselineAnalysisCommit，保证分析提交先于O实现。

- M8.1 关联baselineAnalysisCommit与HYP编号，从长需求的约束遗漏案例形成假设，或明确证据不足；不是将任何失败都归因于提示不清。
- M8.2 实现一次需求改写，不计划/选文件/写代码；原任务保留。
- M8.3 开放optimizer/full，四组同Loop/工具/权限/预算。

允许Optimizer、装配和tests。验收O01/O02、E06四组mock、S01–S03。若baseline短清晰题已经很好，接受Optimizer只增加成本的可能。

## M9 Ablation与交付

依赖M7/M8，真实实验有凭据与运行授权。

- M9.1 在同一最终代码版本与benchmark-v1上重新运行全部四组，默认12×4×3=144次；这是最终比较，必须重新跑baseline。
- M9.2 verify后生成reports/ablation-report.md，关联baselineAnalysisCommit、C/O实现commit及同一benchmark，逐HYP解释结果；报告S/H分别成绩、总体、机制触发、辅助调用预算占用及失败证据。早期M6 baseline用于诊断，不能直接拼进较晚full形成最终主比较。
- M9.3 README/CI离线检查及复现步骤齐全，写清负结果、未触发和研究局限。可选12×baseline/full×2=48次只作快速对照，不替代四组消融；它发生在机制实现后。

允许实验报告/README/CI；若需修工程bug，保留旧实验，新runId重跑可比矩阵。验收F03、E01–E07、S01–S03及00完成标准。真实实验不在每次CI自动跑。

未来命令：npm run typecheck/test/agent/eval/eval:preflight/eval:smoke/eval:verify。eval接收config/tasks/variants/repeats，实际覆盖后的配置落盘。运行期间不改样本数、预算或选择性排除任务。

## 单工单提示

“只执行Mx.y，核对前置证据，修改允许文件，运行指定验收并记录结果。M7/M8前必须有冻结题库、真实baseline报告及已验收的Git分析提交；没有证据就明确缺项，不倒写实验故事。”
