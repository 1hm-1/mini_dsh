# 02 实现契约

M0已实现类型与配置/任务描述的纯校验，后续工单实现运行行为；避免用any绕过校验。JSON统一schemaVersion=1，供应商用量缺失用null，不填0。

源码入口：src/types.ts、src/plugin.ts、src/services/index.ts、src/config.ts、eval/contracts.ts、eval/task.ts。parseRunConfig/parseTaskSpec/parseEvalConfig接收unknown并返回新的配置对象；variant类型和能力开关来自specs/variants.json。空writable表示无写权限，计数字段不接受字符串转换；大写TEMPLATE是保留占位标记，普通template文件名合法。endpoint允许HTTPS与本地loopback HTTP，拒绝userinfo、fragment及常见凭据查询参数，错误不回显输入值；普通查询参数保留。

上述配置解析函数不访问任务文件、不读取API Key或请求模型。任务资产存在性、符号链接、已知taskId/provider和冻结提交等校验由M4/M5运行前加载流程完成；M1.2的JSONL插件已检查日志真实父目录位于workspace外，M2文件工具已检查真实路径和文件类型。Event.data保留unknown边界类型，M1.2已实现run_start/message/run_end的payload校验，M3.1增加context_observation/request/response，M3.2增加tool_start/tool_end。ContextProjection与ModelRequest输入指标省略requestChars/observationSeq，由accounting包装器补齐；M3.2提供完整历史ContextManager；M7增加可选摘要，详见文末M7扩展。

## 配置

```ts
type Variant = 'baseline' | 'context' | 'optimizer' | 'full';
interface Budget {
  maxModelRequests: number; // worker + optimizer + summary实际请求总数
  maxToolCalls: number;     // 含参数错误、权限拒绝
  timeoutMs: number;        // 包含辅助调用和工具
  maxOutputTokens: number;
  maxInputChars: number;    // 请求体JSON的JS string.length硬上限
}
interface RunConfig {
  schemaVersion: 1; variant: Variant;
  model: { endpoint: string; id: string; temperature: number };
  budget: Budget;
  context: { estimatedWindowTokens: number; triggerRatio: number; keepRecentRounds: number };
  workspace: string; writable: string[]; sessionPath: string;
}
```

候选默认：16次模型请求、24次工具调用、120000ms、4096输出tokens、128000 input chars。Context估算窗口8192 tokens、触发比例0.75、保留最近4个完整轮次。计数字段为正安全整数，0<ratio<1。这是本地实验参数，不是供应商真实上下文窗口；四组配置相同，仅enabled不同。

model ID与endpoint显式提供；API key仅从HARNESS_API_KEY读取，不写日志。endpoint必须HTTPS（本地测试loopback除外），禁止userinfo/query中的凭据。temperature候选0；无自动HTTP重试。

首版不做累计token停机或费用停机，资源由请求/工具/时间/单次输出限制；实际token完整记录。usage缺失可以继续，但报告总量null和已知部分，不能把估算当实测。

## 模型与消息

```ts
interface ToolCall { id: string; name: string; arguments: string }
type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; calls: ToolCall[] }
  | { role: 'tool'; callId: string; content: string };
interface ModelRequest {
  kind: 'worker' | 'optimizer' | 'summary';
  contextMetrics?: Omit<WorkerContextMetrics, 'requestChars' | 'observationSeq'>; // worker必需；仅日志
  system: string; messages: Message[]; tools: ToolSchema[];
  maxOutputTokens: number; signal: AbortSignal;
}
interface ModelResponse {
  content: string; calls: ToolCall[];
  finish: 'stop' | 'tool_calls' | 'length' | 'other';
  usage: { inputTokens: number | null; outputTokens: number | null };
  actualModel: string | null; fingerprint: string | null;
}
interface ModelService { complete(request: ModelRequest): Promise<ModelResponse> }
interface ToolSchema { name: string; description: string; parameters: Record<string, unknown> }
interface ToolResult { ok: boolean; output: string; errorCode: string | null; truncated: boolean }
interface ToolDefinition extends ToolSchema {
  execute(args: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult>;
}
```

工具schema声明required和additionalProperties=false，执行时仍校验类型。call ID非空且同一响应内唯一；结果匹配ID。无calls且finish=stop才是final；length/other或结构不合法是model_error。工具参数错误可反馈继续，网络/预算/取消错误终止。

```ts
type Termination = 'completed' | 'request_limit' | 'tool_limit' | 'timeout'
  | 'cancelled' | 'context_overflow' | 'model_error' | 'io_error' | 'internal_error';
interface RunResult {
  schemaVersion: 1; termination: Termination; answer: string | null;
  modelRequests: number; workerRequests: number; optimizerRequests: number; summaryRequests: number;
  toolCalls: number; toolErrors: number;
  inputTokens: number | null; outputTokens: number | null;
  knownInputTokens: number; knownOutputTokens: number;
  durationMs: number; compactions: number; error: string | null;
  contextStats: { workerRequests: number; meanEstimatedInputTokens: number | null;
    peakEstimatedInputTokens: number | null; peakRequestChars: number | null;
    thresholdRequests: number; eligibleCompactionRequests: number };
}
```

completed不等于验收成功。失败也保留全部消耗。没有任何请求时token为0；发生请求而usage缺失则对应总量为null。summaryRequests计尝试次数，compactions只计成功更新摘要次数。

## 服务接口

- PersistenceService.append(event): Promise<void>；close(): Promise<void>。JSONL在workspace外。
- SessionService.append(message): Promise<void>；messages(): readonly Message[]；record(input: {type:string,data:unknown}): Promise<Event>。按Q-M1.2-01用户决定，Session统一生成schemaVersion、seq与elapsedMs；append与record共用同一事件序列，先落盘再更新内存，不覆盖旧历史。record返回已保存的完整事件供引用，调用者不传元数据。
- ContextManagerService.build({system,signal}): Promise<{system,messages,tools,contextMetrics}>。M3.2只返回完整历史投影；M7才增加摘要和压缩边界，不修改Session历史。
- PromptOptimizerService.optimize(input,signal): Promise<string>。返回简洁任务改写，空白或tool calls是model_error。
- AgentLoopService.run(input,{signal?}): Promise<RunResult>。一个runtime只运行一个任务，评测每次新建。
- PermissionService.check(tool,args): {allowed:boolean,reason:string|null}。
- ToolsService.register(definition): Disposer；schemas(): ToolSchema[]；execute(call,signal): Promise<ToolResult>。统一权限/参数校验；schema按名称排序。
- EventsService.on(listener): Disposer；emit(event): void。只做即时观测，耐久记录由Session写入。

Event为 `{schemaVersion:1,seq:number,type:string,elapsedMs:number,data:unknown}`，按type验证payload。type至少包括run_start、request、response、tool_start、tool_end、context_compacted、context_observation、run_end。请求记录kind和真实body，响应记录usage/model/finish，run_end记录结果；不含授权header和key。

M1.2实现的日志payload为run_start `{input:string}`、message `{message:Message}`、run_end `{result:RunResult}`。seq从1开始连续递增，elapsedMs不倒退；RunResult校验字段类型、非负数和null，均值/耗时允许有限小数。M3.1增加以下模型事件；M3.2增加tool_start/tool_end，M7增加context_compacted及摘要请求/响应关联校验，见文末扩展。逐请求用量、计数与结果的交叉核对留M3/M4。

Events.on注册同步监听器，每次注册的disposer只移除自身；每个监听器获得独立快照，抛出的同步异常不影响其他监听器或已经提交的Session历史。Session对输入、返回Event、历史快照和持久化provider分别隔离引用。写入失败后，已排队与后续写入都拒绝，不再改变内存或发布事件；run_end成功提交后同样拒绝后写。Session清理先等待已排队写入，随后由持久化插件关闭文件。

jsonlPersistencePlugin接收绝对workspace/sessionPath，要求workspace路径及日志父目录预先存在；通过realpath与path.relative检查工作区边界，用wx创建日志并拒绝覆盖已有文件。readJournal不写回文件、不恢复执行：缺run_end或末行JSON损坏返回incomplete；序号/时间逆行、重复开始/结束、未知或重复tool result等结构问题报错。completed结束不能缺tool result，预算或取消等非completed结束允许未执行的工具后缀；complete仅代表本阶段日志结构完整，不代表任务通过或全部计数已核验。

## M3.1 模型请求与计量

Accounting由每个runtime独立创建，接收Budget及可选运行取消信号；复制并校验预算，建立覆盖全部调用的共同deadline。httpModelPlugin({model,accounting})和mockModelPlugin({model,accounting,script})均依赖Session并注册ModelService。两者复用编码和计量路径；mock脚本不读取API key。每个服务拒绝并发complete，调用输入在首个await前复制；关闭后旧引用不能继续请求。异步mock脚本须配合传入signal，取消时等待脚本结束并拒绝迟到成功，不丢弃仍运行的回调。辅助kind共用公共计量；M7摘要已接入，优化插件留M8。

HTTP使用配置中的完整endpoint，不自动追加路径。首版支持非流式Chat Completions的文本/function tools子集：model、temperature、stream=false、n=1、max_completion_tokens、messages与tools。assistant.calls映射tool_calls，tool.callId映射tool_call_id；usage的prompt_tokens/completion_tokens映射内部输入/输出token。字段参考[官方Chat Completions接口](https://developers.openai.com/api/reference/cli/resources/chat/subresources/completions/methods/create)。不声称兼容所有provider或模型参数组合；真实provider在M6运行前验证，不自动改参数或重试。

M6前补齐DeepSeek官方端点协议：配置仍为endpoint/id/temperature，不增加provider框架或新的公共配置字段。仅匹配`https://api.deepseek.com`官方origin及`/chat/completions`或`/v1/chat/completions`路径（允许普通查询参数），发送`max_tokens`而非`max_completion_tokens`、不发送`n`，并固定`thinking: { type: 'disabled' }`；messages/tools及usage映射不变。依据：[DeepSeek输出参数](https://api-docs.deepseek.com/quick_start/agent_integrations/oh_my_pi/)、[默认思考模式及工具消息要求](https://api-docs.deepseek.com/guides/thinking_mode/)。当前不支持思考模式的reasoning_content历史回传；不把推理内容静默混入普通baseline。通用端点维持原协议，模型名称相似或相似域名不触发适配。

协议选择在共享模型计量层编码body时完成；HTTP插件直接发送该body，保证requestChars、请求日志、硬输入上限与实际请求一致。eval的journal核验按相同端点选择规则校验额度字段和非思考设置，拒绝混用额度字段、缺少或启用thinking的DeepSeek证据。不能在发送阶段临时改body而绕过计量。

HTTP插件setup读取HARNESS_API_KEY并保存，不写入请求日志；不自动跟随重定向或重试。响应必须是单个assistant choice，call ID非空且唯一，stop与tool_calls须匹配是否含调用。length/其他结束原因是model_error。普通HTTP/解析异常不回显供应商错误正文；可验证usage即使响应结构非法也保留。结构非法时response为null，不保留未验证的content/finish；合法length/other响应保留规范化内容和finish供诊断。缺失用量按输入/输出分别记null，known计数继续累计。

新增事件数据：

- context_observation：`{metrics: Omit<WorkerContextMetrics, 'observationSeq'>}`；自己的Event.seq即观测序号。
- request：`{kind, body:string, requestChars, estimatedInputTokens, observationSeq:number|null}`；body是实际发送的JSON字符串，长度按JS字符计；辅助kind的observationSeq为null。
- response：`{requestSeq, kind, dispatched:boolean, response:ModelResponse|null, usage:{inputTokens,outputTokens}, error:'model_error'|'timeout'|'cancelled'|null}`。独立usage允许结构非法的响应仍保存可信用量；有规范response时两处usage必须一致。

先检查输入及signal/deadline/额度，再保存worker观测（硬长度超限也保存），然后保存request意图；意图持久化成功后、调用provider前才同步预留请求计数。取消发生在意图写入期间时，可以有dispatched=false的response且不占请求额度；一旦dispatch，无论成功/失败均计入对应kind和worker上下文统计。request日志失败不发起provider，response日志失败保留已消耗计数；任一日志失败封存该模型服务并返回io_error。底层I/O失败可留下未配对意图，完整计数重算由M4补验。

日志解析检查串行request引用此前尚未使用的worker观测、长度和估算一致，response引用尚未响应的request且kind一致；completed不能有未响应request。取消发生在response保存期间时，已经落盘的response仍描述模型响应；包装器在返回前再检查signal并抛出取消/超时，由后续Loop记录最终termination，不改写旧事件。此阶段未实现RunResult全部计数与事件的交叉核对。

## M3.2 完整上下文与循环

contextManagerPlugin({context})依赖session/model/tools，复制并校验ContextConfig。M3.2时固定关闭压缩；M7扩展前的行为为：即使达到阈值也完整复制system、全部消息及工具schema，不请求模型或写摘要。assistant无calls自身算一完整轮；有calls时全部匹配结果齐全才算一轮，多工具算一轮，未完成尾轮不计。olderRounds=max(0,完整轮数-keepRecentRounds)，thresholdReached使用估算值>=窗口×比例，compactionEligible严格等于thresholdReached && olderRounds>0。

agentLoopPlugin({system,accounting})依赖session/model/tools/contextManager/events；一个实例只接收一次run，重复、并发或关闭后的调用直接拒绝，不追加第二次run_start/run_end。Loop拥有生命周期事件与原始user消息；独立使用Loop时调用方负责dispose，M3.3的Runtime.run在finally清理。Loop仅通过可选PromptOptimizerService接口连接未来扩展，当前无Optimizer实现；若注入该服务，其非空建议单独附在系统规则后并说明优先级低于原任务，原user不替换。

工具事件数据：

- tool_start：`{call:ToolCall}`，表示调用意图，包含预算限制下未调用的后缀。
- tool_end：`{startSeq, dispatched:boolean, result:ToolResult|null, error:'tool_limit'|'timeout'|'cancelled'|'internal_error'|null}`。startSeq关联tool_start的Event.seq。

普通成功或工具参数/权限失败都记录dispatched=true、result非空、error=null，再将规范ToolResult的JSON写为对应tool消息。实际调用前才计toolCalls；已调用且返回ok=false或抛出取消/超时/意外异常时计一次toolErrors。未调用的预算后缀记录dispatched=false、result=null、error=tool_limit，不增加两个计数，也不伪造tool消息或继续发缺结果的worker请求。

每次工具意图落盘后检查signal再执行；末次合法模型请求返回的工具仍可在工具预算内执行，请求额度只阻止下一次模型请求。所有工具按顺序await，取消不放任尚未结束的handler继续运行。assistant、工具事件、工具消息或模型日志任一持久化失败均以io_error结束且停止后续动作；run_end自身写失败返回io_error并清空answer，不伪造持久化成功。

run_end开始保存前确定最终termination及durationMs，保存成功是run的提交点；保存期间发生的取消不改写已保存结果，返回值与run_end.result一致。正常完成error=null，其余仅保存安全的termination字符串；completed只表示模型正常结束，不是外部测试通过。M3时compactions恒为0；M7开始Loop订阅已落盘context_compacted计数，不判断variant。

readJournal对含工具事件的日志检查assistant调用顺序、串行start/end、匹配result消息、预算后缀与未完成调用；旧的纯message日志保留既有校验。完整评测verify仍须在M4核对计数和实现版本，不能用向后兼容解析代替该验证。

## M3.3 Runtime与CLI

`createRuntime(config: unknown, options?: RuntimeOptions): Promise<Runtime>`位于src/runtime.ts。Runtime提供`context: Context`、`run(input: string): Promise<RunResult>`和幂等`dispose(): Promise<void>`；每实例只执行一次。RuntimeOptions接收可选signal及modelPlugin工厂，工厂入参为`{model: ModelConfig, accounting: Accounting}`，返回MiniPlugin。默认HTTP，离线测试可显式换成mock插件，Loop不变；该工厂是可信本地代码，不是CLI动态加载入口。

首次await前校验并复制RunConfig、捕获signal和模型工厂。组开关读取specs/variants.json，M7已支持baseline/context装配，optimizer/full留M8，现明确拒绝。默认HTTP缺HARNESS_API_KEY时在创建日志前失败；自定义模型插件不要求该凭据。配置中的workspace/sessionPath相对启动cwd解析（不是相对配置文件目录），目录须预先存在，日志位于workspace外且不能覆盖。模型不会在setup期间调用。

固定插件次序：JSONL persistence → events → memorySession → permissions → tools → fileTools → model → contextManager → agentLoop。每实例独立Accounting、Session、权限、工具；BASE_SYSTEM是源码内固定的简洁文件操作指令，无规划器或结束前验证门禁。启动失败清理已加载插件；run在finally逆序清理，外部dispose在运行中取消并等待在途调用结束后再清理。清理失败继续释放其余服务并拒绝调用，不改写已经保存的run_end。

CLI入口为src/cli.ts，支持`--config <json-path>`以及互斥的`--input <task>`/`--input-file <utf8-path>`；单独`--help`显示用法。未知、重复、缺值参数和空白任务失败；不自动读取.env。输入文件按UTF-8原样读取，原始任务保存在user消息。SIGINT通过取消信号传递，等待运行/清理完成后退出，finally移除监听。

直接Node入口stdout在运行完成后输出一行RunResult JSON，错误写stderr，不回显原始异常/密钥/配置内容；help只输出用法。退出码：completed为0；request_limit/tool_limit/timeout/context_overflow/model_error为2；配置、环境、io_error/internal_error或清理失败为1；cancelled为130。completed只表示Agent结束，外部评分仍由M4实现。`npm run agent`会额外显示npm自身banner，机器读取JSON可用`npm run --silent agent -- ...`或直接Node入口。

## 任务协议

```ts
interface TaskSpec {
  schemaVersion: 1; id: string; suite: 'S' | 'H'; category: 'bug-fix' | 'feature' | 'multi-file';
  promptFile: string; workspaceDir: string; writable: string[];
  publicTest: string;     // 相对于workspace，可读不可写
  acceptanceTest: string;// 相对于任务包，不复制给Agent
  referencePatch: string;// 仅preflight使用
  testTimeoutMs: number;
}
```

id匹配 `^[a-z0-9][a-z0-9-]{0,39}$`。包内路径不允许越界或symlink，writable为精确workspace相对路径，无glob，可含计划新增文件。测试固定.mjs，不接受自由shell命令。全部任务资产参与SHA-256 taskHash。TEMPLATE值或不存在资产拒绝运行。

## 评测数据与函数

AttemptResult含runId、phase、implementationCommit、benchmarkCommit、taskId、suite、variant、repeat、orderIndex、taskHash、config、agent:RunResult、integrity、publicTest、acceptanceTest、passed、failureReason、artifactPaths。CheckResult含exitCode、signal、timedOut、completed、passedTests、failedTests、outputPath；通过要求exit=0、无signal/timeout、completed=true、至少1个实际测试用例成功且failedTests=0（文件级wrapper成功不计用例）。

- loadTask(taskDir) / loadTasks(taskRoot, ids)：加载并校验资产，返回LoadedTask；不得把完整对象传给runtime。
- materialize(task, destination)：只复制workspaceDir到新目录，返回workspace路径及before快照。
- runAttempt(options): Promise<AttemptResult>：runtime→run→dispose→grade→save，完整入参见M4.3。
- buildSchedule(taskIds,variants,repeats) / runEvaluation(config,options)：固定顺序与串行执行。
- grade({task,before,after,termination,outputDir}): Promise<Grade>：外部验收，不调用模型。
- preflight(task,outputDir): Promise<PreflightResult>：验证初始失败与参考版本通过。
- summarize(manifest,attempts,metrics): Summary / renderReport(manifest,summary): string：纯统计与渲染。
- verify(runDir): Promise<{passed:boolean,errors:string[]}>：核对证据并重算，不只信summary。

首版用简单显式校验函数即可，不要求JSON Schema生成平台。新增任务不修改runtime。

## M4.1 任务资产与快照

`eval/assets.ts`提供`loadTask(taskDir)`、`loadTasks(taskRoot, ids)`和`materialize(task, destination)`。LoadedTask为`{root,spec,prompt,taskHash,assets}`：root是任务包绝对路径，assets为全包快照；返回对象递归冻结。ID列表须非空、不重复且有效，包目录名与task.id一致。必需资产须真实存在且类型正确，整个包拒绝symlink/特殊文件，prompt为非空UTF-8。publicTest相对workspace，acceptance/reference相对任务包且必须在workspace外；必需文件不得别名重叠。writable可含计划新增文件，已有项必须为普通文件，已有父节点必须为目录。

所有包资产参与taskHash，包括task.json原始格式、prompt、workspace、公开/隐藏测试、reference及未引用的附加文件。算法为SHA-256(UTF-8 JSON.stringify({schemaVersion:1,entries}))；entries按包相对path稳定排序，file记录字段依次为path/kind/sha256，directory记录path/kind。文件sha256针对原字节；绝对目录、mtime不参与。相同包复制到另一位置hash不变，任意资产字节改动可区分。该hash不是Git冻结提交，M5另行创建manifest并提交。

materialize先重新校验来源及加载元数据，destination必须不存在、父目录已存在且无symlink，并位于任务包外。只复制workspace子树，文件为独立副本；复制后核对来源和副本，源有变化则拒绝，失败只清理本次新建目录。返回`{workspace,before}`，不自动运行Agent。调用runtime时只传公开prompt、writable、workspace和共同配置，不传LoadedTask/assets。

`eval/workspace.ts`提供snapshotWorkspace(root)、diffSnapshots(before,after)和checkIntegrity(before,after,writable)。快照为`{schemaVersion:1,entries}`，条目包含path和kind：file有sha256/content/encoding，directory保留空目录，symlink只记录target，special只记录类型。文件合法UTF-8保留原文和BOM/CRLF，其他字节用base64无损保存；不读取symlink目标或FIFO内容。条目按Unicode码点顺序排序，不记录mtime或根绝对路径。

changes按路径排序，每条为`{path,kind:added|deleted|modified,before,after}`，前后条目保留完整证据且与输入无共享可变引用。比较输入拒绝重复/越界路径、缺失目录父节点及文件内容/hash不符。IntegrityResult沿用既有passed/changedPaths/violations：所有symlink/特殊项失败；非writable文件新增、删除或内容/类型变化失败。目录变化保留在changes，纯空目录增删不单独扩大文件白名单评分。磁盘条目名按实际文件记录；writable仍按配置规则拒绝glob/占位路径。

这些函数返回可序列化结构，M4.3 runner已持久化attempt的before.json/after.json/changes.json；M4.4已实现完整结果重算。当前静态夹具位于tests/fixtures/eval-smoke，仅验证工程隔离，不属于Benchmark-S/H题库，未形成benchmark-v1或真实成绩。

## M4.2 外部测试、判定与预检

`eval/check.ts`提供`runCheck({workspace,testFile,timeoutMs,outputPath})`，返回既有CheckResult。精确.mjs入口在真实检查目录内，逐段拒绝symlink；输出文件在检查目录外，父目录存在，wx拒绝覆盖。配置/环境/日志I/O错误抛出；用例失败、语法错误、提前退出和超时返回失败结果。

独立Node子进程由eval/check-worker.mjs执行node:test，使用isolation=none避免把文件wrapper当作通过用例。实际test事件计数，suite、skip和todo不算成功用例；结构化整体summary在独立fd3上传，stdout/stderr仅是日志。通过同时要求整体完成、正常exit=0、无signal/timeout、summary成功、至少一个真实通过用例且无失败/取消。只有console打印TAP/JSON、空测试、提前process.exit(0)都不能冒充成功。实现参考[Node 24测试运行器文档](https://nodejs.org/docs/latest-v24.x/api/test.html)，具体行为以当前Node 24.20下回归为证据。

日志边接收边落盘，outputHash为实际日志字节SHA-256；元数据大小有界。子进程仅继承少量基础环境变量，不传HARNESS_API_KEY、NODE_OPTIONS或NODE_TEST_CONTEXT。到时杀死并等待检查进程结束，在POSIX下清理其进程组，防普通派生进程残留。这里仅执行可信自建任务，不是OS沙箱；不防主动逃离进程组、直接伪造私有通信或任意宿主访问的恶意代码。

`eval/judge.ts`的grade先重新核对任务来源和before原始快照，以checkIntegrity作为唯一完整性规则。公开和隐藏验收各自使用全新检查副本，仅重建允许的普通文件改动/删除及所需目录；不复制候选symlink/特殊项或非白名单文件。保护测试来自原始资产，隐藏验收只在独立检查副本根映射为acceptance.test.mjs；原workspace或writable与该保留路径冲突时拒绝。公开测试运行产生的文件不能污染独立验收。检查结束finally删除两个检查副本，保留outputDir下public-output.txt与acceptance-output.txt；outputDir须全新且位于任务包外。

Grade为`{integrity,publicTest,acceptanceTest,functionalPass,passed,failureReason}`。functionalPass仅指两类检查通过；passed还要求termination=completed及完整性通过。failureReason依次取非completed的termination、integrity、public_test、acceptance_test，否则null。完整性失败仍允许在干净副本诊断可安全重建的白名单修改，诊断通过不能改变主passed=false。候选只作为快照输入，grade不写Agent工作区或原任务。

`eval/reference.ts`的applyReferencePatch(before,patch,writable)纯函数在副本上应用严格文本unified diff。支持a/b路径头、可选diff/index头、100644新增/删除标记、多文件精确hunk、/dev/null增删和无末尾换行标记；补丁自身以LF结束，负载保留CRLF。上下文/行号/计数须准确，无fuzz。拒绝越权/越界路径、重复目标、二进制、rename/copy、权限变更及其他不支持格式；任一文件失败不部分修改原快照。

`eval/preflight.ts`的preflight返回`{passed,taskId,taskHash,initial,reference,error}`并保存outputDir/preflight.json。输出目录独占创建，initial/reference子目录保留各自两类测试日志。初始public可过或败，但必须正常完成实际用例；初始acceptance必须正常完成且有真实失败用例，零测试/语法错误/提前退出/超时不算有效失败。之后应用参考补丁，reference必须通过完整性及两类测试。坏题返回passed=false和固定error；invalid_initial_public、invalid_initial_acceptance、invalid_reference_patch或reference_failed。环境/目录/来源漂移错误抛出，已存在的证据不覆盖。预检只验证题目可用性，不运行模型、不冻结题库。

## M4.3 调度、运行与版本记录

`eval/schedule.ts`的buildSchedule接收非空、无重复的taskIds/variants与正整数repeats。任务按ID排序，组顺序只取specs/variants.json的order；外层repeat从1起，其次任务，内层组按`(taskIndex + repeat - 1) % variantCount`左移。返回`ScheduleEntry {taskId,variant,repeat,orderIndex}`，orderIndex全局从0起。纯调度函数可验证四组顺序；runner仅允许baseline，其他组明确报未实现，不退化为baseline。

`eval/benchmark.ts`的loadEvaluationInputs(config,projectRoot,smokeTaskRoot?)返回`{tasks,implementationCommit,dirty,benchmarkCommit,benchmarkHash}`。同步校验/复制配置后才异步读取。smoke要求benchmarkManifest=null，可加载显式夹具根（默认projectRoot/tests/fixtures），真实记录已有HEAD及dirty；无Git/无HEAD时commit=null且dirty=true，benchmark字段均null。真实模式要求projectRoot为Git根、HEAD存在且worktree clean；严格解析manifest并校验其中全部任务ID/suite/字节hash和所选子集。

benchmarkHash为manifest原字节SHA-256。benchmarkCommit取HEAD历史中最后修改该manifest的提交，核对其祖先关系、manifest字节和每个任务全包文件与Git树一致；空目录无法由Git冻结，明确拒绝。该SHA独立于后续实现commit，不能以实现HEAD替代。输出不得位于任何题包内，包括未选题。检查证明当前产物与该提交一致，不取代M5的完整十二题、preflight及版本规则；修改题目仍须新题库版本和新baseline。

`eval/runner.ts`提供`runEvaluation(config:unknown, options?:{projectRoot?,smokeTaskRoot?,modelPlugin?,signal?})`，返回`{runId,runRoot,manifest,attempts}`。projectRoot默认cwd，真实模式必须是执行中的runner所属项目根，防把无关仓库的SHA记作实现版本；smoke可使用临时测试根。modelPlugin沿用RuntimeOptions接口，smoke必须显式注入，真实模式禁止替换且启动前要求HARNESS_API_KEY。首个await前捕获配置/factory/signal，outputDir接受绝对路径，相对路径按projectRoot解析。

runner校验输入/版本后，创建唯一runId和新目录，逐题保存preflight；全部通过后复核Git/题包未漂移，保存完整manifest/schedule，再串行执行。真实产物应位于忽略目录或仓库外，预检输出不得使clean校验失效；smoke允许输出造成dirty并如实记录。父路径拒绝symlink/特殊文件，已有run/attempt/日志不覆盖。停止错误留下已有证据和脱敏error.json（stage与固定code），不重跑替换失败。

EvalManifest为`{schemaVersion:1,runId,phase,provider,startedAt,nodeVersion,implementationCommit,dirty,benchmarkCommit,benchmarkHash,config,tasks,schedule}`。provider为http或mock，config为实际EvalConfig（outputDir绝对化），tasks每项含id/suite/taskHash/root，schedule为完整ScheduleEntry数组。M4.3交付时只保存逐次结果；M4.4已接入summary/report与完整verify。

`eval/attempt.ts`的runAttempt入参为`{task,config,entry,runId,runRoot,implementationCommit,benchmarkCommit,modelPlugin?,signal?}`；只允许配置包含的baseline任务/重复。每次创建新runtime、Session和预算，模型仅接收公开prompt与RunConfig。runtime清理结束后保存快照/changes，再grade；两项日志移至attempt根，最后独占保存result.json。artifactPaths包含before/after/changes/journal/result/publicOutput/acceptanceOutput的绝对路径；CheckResult.outputPath对应最终日志，hash保持原字节。结果落盘后删除临时Agent工作区，原任务不变；若意外异常则保留已有证据而停止，不伪造RunResult或run_end。正常返回的模型/预算/工具错误作为失败attempt保留并继续下一项。

`eval/cli.ts`接受--config及可选--tasks、--variants、--repeats，覆盖先合并再严格校验。正常入口仅HTTP；`eval/smoke.ts`为固定夹具显式注入脚本模型，支持--output，固定两次。输出runId/runRoot/provider/attempt数；矩阵完成退出0（评分失败仍计入），参数/环境/证据错误退出1，捕获SIGINT后等待当前清理并以130退出。已取消signal传入剩余项，记录cancelled而不再发模型请求；不提供恢复或自动retry。

## M4.4 证据复算、统计与报告

`eval/journal-metrics.ts`提供`inspectJournal(journal:JournalRead,config:RunConfig):JournalMetrics`。JournalMetrics含result、requests及inputKnownRequests/outputKnownRequests/completeUsageRequests；requests只列response.dispatched=true的请求，每项含seq/kind、requestChars、estimatedInputTokens、worker上下文观测、input/output tokens和actualModel/fingerprint。未派发意图不占请求额度，缺usage保持null，硬超限的未派发observation可以保留且不混入worker均值。

复算所有请求及kind分项、工具实际派发/错误、known/total tokens和contextStats，与run_end逐字段比较；终止结果还须与持久化assistant回答及错误关系一致。检查body长度、模型/温度/输出上限、估算公式和worker观测关联，额度不可超出共同预算。当前worker投影按baseline完整历史核验，M7引入压缩时须扩展对应校验；这里不实现压缩。外部取消/截止信号未必有独立事件，不以缺少错误response或loop耗时小于装配期timeout误拒合法终止；未完成请求/工具、断尾或缺结束记录仍拒绝。

`eval/report.ts`的summarize要求manifest完整schedule、同runId/phase/实现commit/benchmarkCommit/配置/任务hash，metrics按attempt顺序且result一致；缺失、重复、混入样本或评分矛盾抛错。返回Summary含schemaVersion/runId/phase/provider/sampleCount、byVariant（每组S/H/overall）、overall（跨组S/H/overall）及fullMinusBaselinePercentagePoints。无对照或无样本时差值/成功率为null，不取每题最佳结果。

每个GroupSummary包含success分子/分母/率、requests总数及三类分项、工具calls/errors、tokens input/output/combined、Agent latency、公开/隐藏check duration、worker context、compactions、termination/failureReason分布及actualModels/fingerprints。token总量遇任一未知项为null；known保存所有已知部分，combined.known包含只有单侧usage的请求，完整率仍按该指标完整的请求数/全部已派发请求计算。零请求total=0且完整率null。上下文按逐请求加权，不平均run均值；requestChars/估算/压缩前估算/olderRounds给count/mean/median/peak，另列threshold/eligible数量。失败与辅助请求成本全部计入。

CheckResult新增可选durationMs：新检查以单调时钟测量子进程启动至结束的wall time，同时写入日志末尾check-result；不是测试用例内部计时或Agent耗时。旧证据缺此字段不补0。验收耗时统计保留knownCount/unknownCount/knownSum，任一未知使sum=null，mean/median/peak仅针对已知样本；无样本时sum=0但均值/峰值null。

`eval/verify.ts`的inspectRun(runDir)读取并校验底层证据，返回manifest/attempts/metrics；verify(runDir)返回`{passed,errors}`，还复算已存在的summary.json和report.md，一致才通过。两者不调用模型、重跑验收或修改证据。要求manifest与重建schedule一致、attempt目录无缺失/多余，逐次身份/共享RunConfig一致，artifactPaths精确对应本attempt固定文件且父/叶无symlink。before须等于原任务workspace，after/changes/hash/integrity均重算；测试输出原字节SHA及末尾结构化结果与CheckResult一致；passed和failureReason重新计算，journal完整且计量与agent一致。preflight的初始实际失败、参考通过、参考补丁完整性及四份日志也复核。

真实运行的verifyFrozenInputs校验记录的实现/题库提交存在、祖先关系、当时最后修改manifest的提交、manifest hash以及全部题包的冻结字节。不要求当前HEAD仍等于历史实现提交或当前实现工作树clean；仍须保留原任务绝对路径、当前manifest与该版本题包字节，否则明确失败。后续改题应新版本保留旧资产，不把移动/删除原任务后的旧报告称为已重新验收。smoke必须标mock且冻结字段null，未提交实现必须dirty=true。校验是内部一致性检查，无法防止本地所有证据被同时重写，不将可编辑日志的摘要等同于不可伪造执行证明。

`eval/finalize.ts`的writeRunReport仅处理新运行：先inspectRun，通过后独占写summary/report，再verify。失败移除本次尚未通过验收的报告文件，保留全部原始attempt证据并写diagnostic.json/md；不会覆盖已报告运行。runner在Agent完成后调用此离线流程，不新增Agent结束前门禁。CLI增加eval:verify（--run）和eval:preflight（--task、--output）；前者只读退出0/1，后者执行单题离线预检退出0/1。M6九项分析、evidence index及分析Git里程碑另按13交付，不由本次基础verify冒充完成。

## 实验配置与Mock入口

EvalConfig为 `{schemaVersion:1,phase:ExperimentPhase,benchmarkManifest:string|null,taskIds:string[],variants:Variant[],repeats:number,model:RunConfig[model],budget:Budget,context:RunConfig[context],outputDir:string}`（方括号表示同型字段）。taskIds/variants非空且不重复，repeats为正安全整数，全部ID必须存在；未知字段拒绝。CLI覆盖先合并校验，实际配置落盘。

正常eval使用HTTP模型；eval:smoke通过测试专用model factory注入脚本模型，不偷偷读取key。manifest必须记录provider=http或mock；mock结果禁止与http合并。RunConfig中的endpoint在mock测试配置中可使用loopback假地址，不产生网络调用。

CheckResult另含outputHash与testCount；AttemptResult的integrity列出changedPaths和violations。manifest包含每个任务hash、实际配置、provider、实现commit/dirty、开始时间和schedule。实现未在git提交时commit可以null，必须明确标记，不伪装为clean版本。

## Benchmark冻结、阶段与上下文指标

ExperimentPhase枚举baseline-diagnostic/ablation/comparison/smoke。baseline-diagnostic仅baseline；ablation必须四组；comparison仅baseline/full；smoke用于工程验证且必须provider=mock。benchmarkManifest指向M5生成的benchmark/v1.json，null仅允许smoke/单元测试；真实运行先检查全部任务资产hash，再核对所选taskIds属于该manifest。manifest记录benchmarkCommit和benchmarkHash，不能用当前含机制实现的commit替代题库冻结commit。

benchmark/v1.json格式 `{schemaVersion:1,benchmarkVersion:"v1",tasks:[{id,suite,path,taskHash}]}`；提交文件不存自身commit以免自引用。M5 Git提交后将实际SHA记入progress，M6运行配置快照/manifest解析记录该SHA并验证提交中的题库manifest一致。不能把模板或当前未创建任务标为frozen。

每个worker request增加contextMetrics：`requestChars`为实际规范化body.length；`estimatedInputTokens=ceil(JSON.stringify({system,messages,tools}).length/4)`；`preCompressionEstimatedTokens`为build开始投影；`olderRounds`为最近keepRecentRounds之外可摘要完整轮数。`thresholdReached`按preCompression估算与窗口×ratio比较；`compactionEligible=thresholdReached && olderRounds>0`，即使C关闭也只观测不执行。由每次worker请求指标重算contextStats均值/峰值/次数；没有worker请求时均值/峰值为null。仅发送请求前观察，不为了计量增加模型调用。所有kind仍记录requestChars与估算；主统计只取worker，API输入tokens另外报告。

WorkerContextMetrics类型对应上文七个字段：requestChars、estimatedInputTokens、preCompressionEstimatedTokens、olderRounds、thresholdReached、compactionEligible，以及observationSeq（对应context_observation事件序号）。数值字段为非负整数，两个条件为boolean。按用户决定Q-M3.1-01，ModelRequest只接收五项投影指标，不要求调用方传requestChars/observationSeq；完整WorkerContextMetrics类型保持不变。指标仅用于日志与统计，不进入供应商HTTP请求体。包装器对真正body编码后生成requestChars，并从投影重算estimatedInputTokens，保存context_observation后用返回Event.seq关联request；避免长度递归或填占位序号。

## M6分析后处理（不增加运行时策略）

从现有journal/result离线派生attemptAnalysis：taskId、repeat、objectiveOutcome、candidateCause、traceSummary、exactRepeatCount、consecutiveRepeatCount、readBacks、requestGrowth、toolErrors、termination、evidenceRefs。重复调用/增长/选择规则以[13](13-baseline-milestone.md)为准；分析者填写cause/解释/HYP时必须引用机器表和事件，不写回原始日志。表可以JSON/Markdown输出，无需新模型调用或新服务。

EvidenceIndex格式 `{schemaVersion:1,baselineRunId,runRoot,baselineImplementationCommit,benchmarkCommit,benchmarkHash,artifacts:[{path,size,sha256}],representatives:[{taskId,repeat,journalPath,eventSeqs,excerptPath,excerptSha256,selectionReason,redactions}]}`。path相对runRoot，excerptPath相对项目根；禁止越界、重复或指向不存在文件。index不收录自身hash，避免循环。原始日志hash和脱敏摘录hash分别存，不声称脱敏副本与原日志字节相同。

M6报告commit在创建后才能得到SHA：baselineAnalysisCommit记到后续progress提交，M7/M8实现记录和M9报告引用它。报告自身和index不填写自身将来commit。Git门槛是提交与历史检查，不由CLI自动commit。


## M7 增量摘要与独立复核

前置分析：baselineAnalysisCommit=`93d075b80ce15616ca019f71153935b5d3ad51cb`；关联HYP-001（存在可触发观测，但收益inconclusive）与HYP-003（不直接解除固定额度）。机制未修改题库/窗口/预算/系统任务规则；接口仍为ContextManagerService.build，不增加新服务。

`contextManagerPlugin({context, enabled?:boolean, maxOutputTokens?:number})`是内部装配选项，默认enabled=false/maxOutputTokens=512；runtime按variants开关传enabled及budget.maxOutputTokens。开启时增加events依赖以捕获同一次summary请求/响应seq。辅助调用经现有ModelService共享额度、deadline、signal、输入硬上限；输出上限min(512,maxOutputTokens)。SUMMARY_SYSTEM固定在插件源码，要求只总结已有事实、改动、错误和待办，不声称未执行测试已通过。

边界以完整Session.messages()的零起始下标计，to为排他上界；初次from为第一条assistant，之后from为上次to。只摘要边界后新增的旧完整轮次，最近keepRecentRounds完整轮次及不完整尾轮保留；工具calls/results不能切开。摘要输入为前摘要user（若有）+本次[from,to)消息，tools为空。worker system和原始user不替换；压缩部分的user消息仍逐条保留，随后插入`Earlier conversation summary:\n`前缀的合成user摘要，再接边界之后的原消息。合成摘要不写入Session聊天历史，所有辅助请求和响应仍记日志。

新增context_compacted payload：`{fromMessageIndex,toMessageIndex,summary,summaryRequestSeq,summaryResponseSeq}`。summary必须是非空stop、无calls的规范响应文本trim结果；request/response引用同一次summary。只有事件持久化成功才推进内存边界；Loop只统计已发布的成功落盘事件。IO失败返回io_error且不伪造run_end，摘要模型错误/空输出/工具调用显式终止；取消不接受迟到成功；并发build拒绝、dispose等待在途build结束。

contextMetrics里的preCompressionEstimatedTokens和olderRounds取本次build开始时的未摘要投影；estimatedInputTokens/requestChars取最终worker投影。一次build最多摘要一次，摘要后不递归压缩；summary自身或最终worker超过共同输入硬上限均context_overflow。summary占最后一次请求后，允许compactions已增加、后续worker因request_limit未发；这不是免费摘要或静默退回baseline。

readJournal校验压缩事件的summary请求/响应对应及复用；eval/journal-metrics独立重建完整轮次、边界、摘要输入和worker投影，核对两种长度、触发条件和累计compactions，拒绝边界/文本/引用/次数篡改；无Optimizer的baseline/context请求还必须使用固定BASE_SYSTEM，不能通过同步修改长度和统计掩盖系统提示变化。辅助模型合法协议响应但文本为空/包含calls可支持model_error；取消/超时优先保留其终止原因。summary输入硬超限未发请求时，从历史重建应发body证明超限，不伪造已派发请求或token。baseline旧日志继续按完整历史复算。

runtime、eval runner与attempt开放baseline/context；optimizer/full仍拒绝，所有phase矩阵约束保持原值。baseline-diagnostic不容混入context，正式四组ablation等待M8；本阶段的两组长历史测试必须标mock，不能作为真实收益成绩。
