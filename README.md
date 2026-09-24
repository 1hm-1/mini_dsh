# mini-harness

从零实现与mini-dsh规模接近的TypeScript Coding Agent Harness，保持“一切产品能力皆插件”，重点做好baseline/full比较和2×2消融。

**M0–M4已完成：baseline runtime、评测调度/CLI、外部judge/preflight、汇总报告和只读verify均已验收；冻结题库和真实模型实验尚未开始。** 实际状态与验收证据见[进度](docs/progress.md)。路线先创建并固定任务资产，真实baseline取得证据后才实现增强机制：

```text
M0 工程/接口 → M1 Plugin/Session → M2 Tools
→ M3 Baseline Runtime → M4 Evaluator
→ M5 Benchmark v1（完整资产、预检、Git冻结）
→ M6 真实Baseline + Failure Analysis
→ M7 Context Manager → M8 Prompt Optimizer
→ M9 四组Ablation
```

C/O是预先选择的候选能力；baseline日志决定哪些改进假设有证据，最终消融检验收益，不倒写“早已发现并解决”的故事。

| 组别 | Context压缩 | Optimizer |
| --- | --- | --- |
| baseline | 关闭 | 关闭 |
| context | 开启 | 关闭 |
| optimizer | 关闭 | 开启 |
| full | 开启 | 开启 |

四组共享模型、循环、工具、权限、任务和总预算。默认16次模型请求包含worker/optimizer/summary；full不会获得免费辅助调用。

Benchmark v1规划12题：Benchmark-S保留8道小型功能题；Benchmark-H增加4道多文件/长约束任务，提供自然上下文压力与需求整理场景。S/H分表，不保证C触发，也不预设full获胜。

默认M6是12×baseline×3=36次，M9是12×4×3=144次，合计180次；实现后可选12×baseline/full×2=48次快速对照，不替代四组。模型凭据/授权不足时明确停在实验门槛，不以mock替代真实baseline。当前不启动这些实验。

本地开发使用Node 24和npm：

```sh
npm ci
npm run check
```

提供`typecheck`、`test`和组合检查`check`；离线工程检查不需要API Key。HTTP模型通过环境变量`HARNESS_API_KEY`读取凭据，变量名见[环境示例](.env.example)，不要将真实密钥提交到Git。受限环境若只显示测试文件名而无具名用例，须排查子进程限制，不据此认定测试通过。

单次执行使用[配置模板](specs/config.example.json)填写真实model/endpoint、workspace、精确可写文件列表和sessionPath，并在环境中设置HARNESS_API_KEY；CLI不自动加载.env：

```sh
npm run agent -- --config /path/to/runtime.json --input '修复指定文件中的问题'
# 长任务也可用 --input-file /path/to/task.txt，和 --input 互斥
```

当前仅支持baseline；其余组明确报尚未实现。workspace与日志父目录需已存在，日志必须在workspace外且路径未被使用；相对路径按启动目录解析。运行结束输出RunResult JSON；退出码0表示completed、2表示预算/模型等运行终止、1表示配置/环境/IO或内部错误、130表示取消。读取纯JSON可用`npm run --silent agent -- ...`。CLI不执行外部验收测试，completed不等于任务评分通过。

已实现[运行配置校验](src/config.ts)、[插件接口](src/plugin.ts)、[服务接口](src/services/index.ts)及[任务/实验配置校验](eval/task.ts)。纯解析函数检查描述数据，runtime插件检查工作区/日志路径；[任务加载](eval/assets.ts)进一步校验实际资产、计算全包SHA-256并创建独立工作区副本。题库Git冻结留M5，配置通过校验不代表真实provider可用。

[Context](src/context.ts)现可按调用者顺序加载插件、检查服务依赖并逆序释放资源；内核不包含Agent策略。[事件](src/plugins/events.ts)、[JSONL持久化](src/plugins/jsonl-persistence.ts)和[内存Session](src/plugins/memory-session.ts)均以插件提供服务。Session统一生成事件序号，写入成功后才更新历史；[日志解析](src/journal.ts)只读检查已实现事件及模型请求/响应关联，断尾或缺少结束记录标为incomplete。

[权限](src/plugins/permissions.ts)与[工具注册](src/plugins/tools.ts)已支持精确写入白名单、参数校验、统一输出上限和取消传播。[文件工具插件](src/plugins/file-tools.ts)已提供递归列表、读取、写入、唯一文本替换和删除；逐段拒绝符号链接/特殊文件，限制文件大小，并用同目录临时文件加rename执行原子替换。

[共享计量](src/accounting.ts)、[HTTP模型](src/plugins/http-model.ts)和[脚本模型](src/plugins/mock-model.ts)已支持统一请求额度、共同超时、用量缺失标记及请求日志。HTTP仅通过本地假服务验证，尚未连接真实provider。

[ContextManager](src/plugins/context-manager.ts)保留完整历史并生成上下文指标；[Agent Loop](src/plugins/agent-loop.ts)负责单次运行、顺序工具调用、预算和取消处理。[工具事件](src/tool-events.ts)与日志解析检查调用、结果及消息的关联。[Runtime](src/runtime.ts)装配插件并在finally清理，[CLI](src/cli.ts)提供单次执行入口。脚本模型与本地假HTTP的真实文件读→改→final链路已验证；尚未实现摘要或Prompt Optimizer机制。

[快照与改动检查](eval/workspace.ts)保留文件原字节哈希和前后内容，检查非白名单文件变化及symlink/特殊项；任务副本只含workspace，隐藏验收和参考补丁留在外部。[外部判定器](eval/judge.ts)在独立检查副本使用原始测试，[测试执行器](eval/check.ts)核对真实用例与结构化完成记录，拒绝把提前退出或空测试判为通过。

[Preflight](eval/preflight.ts)验证初始验收真实失败、参考补丁只改白名单且参考版本两类测试通过，保留日志和预检JSON。[eval-smoke夹具](tests/fixtures/README.md)已通过该离线工程验证，不属于S8/H4题库。[Runner](eval/runner.ts)已支持baseline串行调度、失败保留、逐次结果及报告生成；[verify](eval/verify.ts)独立复算并检查证据。

离线评测入口可立即运行，不读取API Key、不发网络请求；固定工程smoke题重复两次，执行读→改→final并外部评分，产物标记`provider=mock`：

```sh
npm run eval:smoke
# 可指定输出目录；每次创建全新的runId
npm run eval:smoke -- --output /tmp/mini-harness-smoke
```

产物在`runs/<runId>/`：包含题目preflight证据、manifest中的实际配置和完整schedule，以及每次attempt的journal、before/after/changes、两类测试日志与result.json。失败保留、不自动重试。完成矩阵后先校验底层证据，再生成summary.json/report.md并执行verify；不完整记录只产出diagnostic.json/diagnostic.md，保留原始失败材料。

报告分别展示S/H及总体成功率、全部请求与工具成本、token已知部分/完整率、Agent与验收耗时、逐请求上下文长度及终止原因。当前runner仍只执行baseline，四组统计通过手工数据验证，C/O机制与真实消融按后续里程碑推进。

```sh
# 只读检查已完成运行；不调用模型、不重跑测试、不修复产物
npm run eval:verify -- --run runs/<runId>
# 单题离线预检；输出目录必须全新，父目录须存在
npm run eval:preflight -- --task tests/fixtures/eval-smoke --output /tmp/mini-harness-preflight
```

verify核对计划样本、原任务hash、快照/changes、测试输出hash、journal计量与评分，并重算summary/report；一致退出0，否则输出诊断并退出1。它检查本地产物的内部一致性，不证明所有文件从未被整体重写。复核旧运行时需保留其原题包路径和冻结资产，原始产物不得原地更新。

正式评测入口已实现，实际使用须等M5题库冻结及相应实验授权/凭据就绪后，从本项目Git根运行：

```sh
npm run eval -- --config experiments/baseline-config.example.json --variants baseline --repeats 3
# --tasks id1,id2 可选；上述模板必须先填写真实模型配置
```

CLI覆盖先合并校验后落盘；目前只运行baseline。HTTP模式要求干净的实现提交和已提交的题库manifest/资产，校验全部题目（包括未选题），再预检所选题；输出使用Git忽略目录或仓库外目录。每次attempt独立工作区/Session/预算；完成矩阵即退出0（可以包含评分失败），配置/环境/证据错误退出1，取消退出130。普通评测入口不接受smoke配置，请使用明确的离线入口。当前本仓库尚未创建Git提交、M5题库或真实模型成绩。

阅读入口：

- [范围与完成标准](docs/00-scope.md)
- [插件架构](docs/01-architecture.md)与[最小插件契约](docs/11-plugin-kernel.md)
- [接口契约](docs/02-contracts.md)、[运行流程](docs/03-runtime.md)、[工具边界](docs/04-tools.md)
- [评测系统](docs/05-evaluator.md)、[两层Benchmark](docs/06-benchmark.md)、[实验与指标](docs/07-experiments.md)
- [M0–M9实施工单](docs/08-implementation.md)、[验收用例](docs/09-acceptance.md)及[M6正式完成门槛](docs/13-baseline-milestone.md)
- [决策与扩展](docs/10-decisions.md)、[上游对照](docs/12-upstream-alignment.md)

配置示例：[variants](specs/variants.json)、[runtime](specs/config.example.json)、[task](specs/task.example.json)、[M6 baseline](experiments/baseline-config.example.json)、[M9 ablation](experiments/run-config.example.json)。报告模板：[baseline report](experiments/baseline-report.template.md)、[failure analysis](experiments/baseline-failure-analysis.template.md)。

执行模型遵守[AGENTS.md](AGENTS.md)，按证据门槛推进。容器平台、真实仓库大型题库、保留集、预注册、高级统计仍不属于首版，不因修正实验顺序恢复过度工程。

M6固定输出：runs/<baseline-run>/、reports/baseline-report.md、reports/baseline-failure-analysis.md。两份报告及证据索引/代表trace必须先单独提交Git，M7/M8才能开始；机制提交关联分析SHA与HYP编号，最终reports/ablation-report.md再关联实现和结果。当前尚无这些实测产物。
