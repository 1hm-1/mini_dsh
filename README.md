# mini-harness

从零实现与mini-dsh规模接近的TypeScript Coding Agent Harness，保持“一切产品能力皆插件”，并用冻结题库比较baseline/context/optimizer/full四组。

**M0–M9基础实现与真实评测已完成。** 12题冻结资产、M6真实baseline、Context Manager与Prompt Optimizer及M9真实四组144次消融均有本地证据。M6 baseline为23/36（S20/24、H3/12）；M9新跑baseline为25/36，四组结果为baseline 25/36、context 23/36、optimizer 24/36、full 21/36，full较M9 baseline低11.11个百分点。M9没有显示机制带来成功率收益；14次压缩确实降低估算输入长度，但其中12条摘要包含DSML工具调用标记，需要结合报告中的质量风险一起解读。详见[M9消融报告](reports/ablation-report.md)、[M9证据索引](reports/evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/README.md)、[M6 baseline报告](reports/baseline-report.md)、[M6失败分析](reports/baseline-failure-analysis.md)和[进度](docs/progress.md)。题库资产和离线复核命令见[Benchmark v1](benchmark/README.md)。

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

[Benchmark v1 manifest](benchmark/v1.json)已收录12题：Benchmark-S保留8道小型功能题；Benchmark-H增加4道多文件/长约束任务，提供自然上下文压力与需求整理场景。S/H分表，不保证C触发，也不预设full获胜。

M6诊断为12×baseline×3=36次，M9为12题×4组×3次=144次，主表只使用M9同一提交下的新baseline/context/optimizer/full数据；不将M6拼进M9成功率。可选的12×baseline/full×2=48次快速比较未运行。M9实际记录1,065个模型请求、3,116,131个输入加输出token，所有辅助请求均计入共同预算；完整数据、失败与限制见M9报告。题库是小型自建12题，每题重复3次；结果不能外推为一般模型或任务性能。Context组的24个S attempt没有一次压缩，因此S分数差异不能归因于实际摘要。原始运行材料保存在Git忽略目录`runs/<runId>/`，没有提交到Git；复核M9需保留对应本地run。Git材料包含报告与派生证据索引/trace摘录。

本地开发使用Node 24和npm：

```sh
npm ci
npm run check
```

提供`typecheck`、`test`和组合检查`check`；CI还运行固定mock smoke、12题preflight和题库冻结校验，不调用真实模型或读取API Key。HTTP模型通过环境变量`HARNESS_API_KEY`读取凭据，变量名见[环境示例](.env.example)，不要将真实密钥提交到Git。受限环境若只显示测试文件名而无具名用例，须排查子进程限制，不据此认定测试通过。

DeepSeek使用[baseline配置](experiments/baseline-deepseek.json)和[M9 ablation配置](experiments/ablation-deepseek.json)：endpoint为`https://api.deepseek.com/chat/completions`，model为`deepseek-flash`。官方端点使用`max_tokens`并显式设置`thinking: { type: 'disabled' }`，沿用非思考模式的文本/工具消息结构；其他端点继续使用原有协议。M9四组使用相同模型协议和预算。参数依据：[输出额度字段](https://api-docs.deepseek.com/quick_start/agent_integrations/oh_my_pi/)、[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)。

如果Key保存在根目录`.env`，应用本身不自动加载，使用Node的`--env-file`加载。以下M6命令记录已完成的诊断运行；再次运行会启动新的付费baseline：

```sh
node --env-file=.env --import tsx eval/cli.ts --config experiments/baseline-deepseek.json
```

这条命令执行12题×3次真实baseline并产生API费用。M6历史运行已完成；再次执行会创建新的付费run，不会查看或复用既有报告。

M9四组真实消融已完成。若要重新运行，需明确授权新的付费实验，并使用干净且已提交的实现/config；此命令不属于CI或默认检查：

```sh
node --env-file=.env --import tsx eval/cli.ts --config experiments/ablation-deepseek.json
```

该配置安排12题×4组×3次，共144次attempt；重新运行会产生新的run和API费用，不会覆盖现有M9证据。

单次执行使用[配置模板](specs/config.example.json)填写真实model/endpoint、workspace、精确可写文件列表和sessionPath，并在环境中设置HARNESS_API_KEY；CLI不自动加载.env：

```sh
npm run agent -- --config /path/to/runtime.json --input '修复指定文件中的问题'
# 长任务也可用 --input-file /path/to/task.txt，和 --input 互斥
```

当前单次runtime支持baseline/context/optimizer/full，开关唯一来源为specs/variants.json。workspace与日志父目录需已存在，日志必须在workspace外且路径未被使用；相对路径按启动目录解析。运行结束输出RunResult JSON；退出码0表示completed、2表示预算/模型等运行终止、1表示配置/环境/IO或内部错误、130表示取消。读取纯JSON可用`npm run --silent agent -- ...`。CLI不执行外部验收测试，completed不等于任务评分通过。

已实现[运行配置校验](src/config.ts)、[插件接口](src/plugin.ts)、[服务接口](src/services/index.ts)及[任务/实验配置校验](eval/task.ts)。纯解析函数检查描述数据，runtime插件检查工作区/日志路径；[任务加载](eval/assets.ts)进一步校验实际资产、计算全包SHA-256并创建独立工作区副本。题库Git冻结见M5验收记录；配置通过校验不代表真实provider可用。

[Context](src/context.ts)现可按调用者顺序加载插件、检查服务依赖并逆序释放资源；内核不包含Agent策略。[事件](src/plugins/events.ts)、[JSONL持久化](src/plugins/jsonl-persistence.ts)和[内存Session](src/plugins/memory-session.ts)均以插件提供服务。Session统一生成事件序号，写入成功后才更新历史；[日志解析](src/journal.ts)只读检查已实现事件及模型请求/响应关联，断尾或缺少结束记录标为incomplete。

[权限](src/plugins/permissions.ts)与[工具注册](src/plugins/tools.ts)已支持精确写入白名单、参数校验、统一输出上限和取消传播。[文件工具插件](src/plugins/file-tools.ts)已提供递归列表、读取、写入、唯一文本替换和删除；逐段拒绝符号链接/特殊文件，限制文件大小，并用同目录临时文件加rename执行原子替换。

[共享计量](src/accounting.ts)、[HTTP模型](src/plugins/http-model.ts)和[脚本模型](src/plugins/mock-model.ts)已支持统一请求额度、共同超时、用量缺失标记及请求日志。HTTP已通过离线协议检查及M6真实DeepSeek运行验证。

[ContextManager](src/plugins/context-manager.ts)始终保留完整Session历史；context组在达到阈值且有旧完整轮次时调用同模型摘要，保留原任务与近期完整call/results，并记录增量边界；baseline继续完整投影。[Agent Loop](src/plugins/agent-loop.ts)负责单次运行、顺序工具调用、预算和取消处理。[工具事件](src/tool-events.ts)与日志解析检查调用、结果及消息的关联。[Runtime](src/runtime.ts)装配插件并在finally清理，[CLI](src/cli.ts)提供单次执行入口。脚本模型与本地假HTTP的真实文件读→改→final链路已验证；摘要调用计入共同预算，成功落盘才计compactions；[Prompt Optimizer](src/plugins/prompt-optimizer.ts)仅在optimizer/full首个worker前调用一次同模型，原始任务保留，返回的简短需求重述作为低优先级建议；输出上限min(512,maxOutputTokens)，计入共同预算，失败不重试或降级。full后续压缩保留该建议。M9观察到14次压缩、72个Optimizer输出；机制文本和运行效果见真实消融报告，不由mock链路代替。

[快照与改动检查](eval/workspace.ts)保留文件原字节哈希和前后内容，检查非白名单文件变化及symlink/特殊项；任务副本只含workspace，隐藏验收和参考补丁留在外部。[外部判定器](eval/judge.ts)在独立检查副本使用原始测试，[测试执行器](eval/check.ts)核对真实用例与结构化完成记录，拒绝把提前退出或空测试判为通过。

[Preflight](eval/preflight.ts)验证初始验收真实失败、参考补丁只改白名单且参考版本两类测试通过，保留日志和预检JSON。[eval-smoke夹具](tests/fixtures/README.md)已通过该离线工程验证，不属于S8/H4题库。[Runner](eval/runner.ts)支持四组串行调度、失败保留、逐次结果及报告生成；[verify](eval/verify.ts)独立复算并检查证据。

离线评测入口可立即运行，不读取API Key、不发网络请求；固定工程smoke题重复两次，执行读→改→final并外部评分，产物标记`provider=mock`：

```sh
npm run eval:smoke
# 可指定输出目录；每次创建全新的runId
npm run eval:smoke -- --output /tmp/mini-harness-smoke
```

产物在`runs/<runId>/`：包含题目preflight证据、manifest中的实际配置和完整schedule，以及每次attempt的journal、before/after/changes、两类测试日志与result.json。失败保留、不自动重试。完成矩阵后先校验底层证据，再生成summary.json/report.md并执行verify；不完整记录只产出diagnostic.json/diagnostic.md，保留原始失败材料。

报告分别展示S/H及总体成功率、全部请求与工具成本、token已知部分/完整率、Agent与验收耗时、逐请求上下文长度及终止原因。M9有真实四组主结果；[M9复核入口](reports/evidence/2026-09-24T15-18-52-983Z-c2434904-189f-4143-891b-f516dc9b67e3/README.md)提供逐次数据、variant隔离复算器和代表trace。离线工程smoke只验证Harness链路，不代表模型成绩。

```sh
# 只读检查已完成运行；不调用模型、不重跑测试、不修复产物
npm run eval:verify -- --run runs/<runId>
# 单题离线预检；输出目录必须全新，父目录须存在
npm run eval:preflight -- --task tests/fixtures/eval-smoke --output /tmp/mini-harness-preflight
```

verify核对计划样本、原任务hash、快照/changes、测试输出hash、journal计量与评分，并重算summary/report；一致退出0，否则输出诊断并退出1。它检查本地产物的内部一致性，不证明所有文件从未被整体重写。复核旧运行时需保留其原题包路径和冻结资产，原始产物不得原地更新。

正式评测入口已实现，M5题库已冻结。需要另行运行baseline/ablation时，应先明确授权付费实验，并从本项目Git根运行对应配置：

```sh
npm run eval -- --config experiments/baseline-config.example.json --variants baseline --repeats 3
# --tasks id1,id2 可选；上述模板必须先填写真实模型配置
```

CLI覆盖先合并校验后落盘；runtime/runner支持四组。实验phase规则不变：baseline-diagnostic仅baseline，ablation必须四组，comparison仅baseline/full；smoke必须mock，各组均可由单次Agent入口或离线工厂验收。HTTP模式要求干净的实现提交和已提交的题库manifest/资产，校验全部题目（包括未选题），再预检所选题；输出使用Git忽略目录或仓库外目录。每次attempt独立工作区/Session/预算；完成矩阵即退出0（可以包含评分失败），配置/环境/证据错误退出1，取消退出130。普通评测入口不接受smoke配置，请使用明确的离线入口。题库、实现、M6分析与M9报告/证据均在本地工作区；CI只运行离线工程检查，不会重新发起付费评测。

阅读入口：

- [范围与完成标准](docs/00-scope.md)
- [插件架构](docs/01-architecture.md)与[最小插件契约](docs/11-plugin-kernel.md)
- [接口契约](docs/02-contracts.md)、[运行流程](docs/03-runtime.md)、[工具边界](docs/04-tools.md)
- [评测系统](docs/05-evaluator.md)、[两层Benchmark](docs/06-benchmark.md)、[实验与指标](docs/07-experiments.md)
- [M0–M9实施工单](docs/08-implementation.md)、[验收用例](docs/09-acceptance.md)及[M6正式完成门槛](docs/13-baseline-milestone.md)
- [决策与扩展](docs/10-decisions.md)、[上游对照](docs/12-upstream-alignment.md)

配置示例：[variants](specs/variants.json)、[runtime](specs/config.example.json)、[task](specs/task.example.json)、[M6 baseline](experiments/baseline-config.example.json)、[M9 ablation](experiments/run-config.example.json)。报告模板：[baseline report](experiments/baseline-report.template.md)、[failure analysis](experiments/baseline-failure-analysis.template.md)。

执行模型遵守[AGENTS.md](AGENTS.md)，按证据门槛推进。容器平台、真实仓库大型题库、保留集、预注册、高级统计仍不属于首版，不因修正实验顺序恢复过度工程。

M6固定输出为baseline run、baseline报告、失败分析和证据索引，analysis commit为`93d075b80ce15616ca019f71153935b5d3ad51cb`。M7/M8机制提交关联该分析和HYP编号。M9最终报告关联同一题库、分析commit及C/O机制提交；其本地run、144次结果、报告和SHA-256证据索引已形成。CI及默认开发检查不重新启动M6/M9模型运行。
