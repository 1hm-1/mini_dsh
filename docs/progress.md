# 进度

IMPLEMENTING。用户于2026-09-24授权开始开发，使用GPT-6 Sol（medium）子智能体实现，主智能体负责架构审阅与验收。M0.1、M0.2、M1.1、M1.2、M2.1、M2.2 DONE，M0/M1/M2完成；M3.1、M3.2、M3.3 DONE，M3完成；M4.1、M4.2、M4.3、M4.4 DONE，M4整体完成；M5.1、M5.2、M5.3、M5.4 DONE，M5整体完成；M6.1–M6.6 DONE：DeepSeek真实baseline 36次已完整运行、verify及九项分析验收通过，独立分析提交`93d075b80ce15616ca019f71153935b5d3ad51cb`；M7.1–M7.3 DONE（281项工程检查、两组mock及旧baseline verify通过）；M8.1–M8.3 DONE（307项工程检查、四组mock及旧baseline verify通过）；M9 NOT_STARTED。S8/H4题库保持benchmark-v1；真实baseline主成功23/36（S20/24、H3/12），尚无消融成绩。

## 本次规划修订

- M0–M4保持小型工程；M5实际创建S8/H4并预检/Git固定；M6真实baseline和失败分析；M7 C；M8 O；M9四组消融。
- 新增长约束和多文件H场景；S用于基础能力/工程回归，两层分别计分。
- baseline阶段已记录逐请求上下文长度、阈值条件、终止原因；提供两份报告模板。
- 保留16次总模型请求、8192窗口/0.75/4轮；辅助调用没有免费额度。
- 最终同版本重新跑baseline，不与早期诊断baseline拼主表。
- 默认36次诊断+144次消融=180次；48次快速比较为可选额外运行。

C/O是事先选择的候选能力，不能把规划写成已经有因果证据。无失败或零压缩均须如实报告。

## 实施工单记录

工单ID、前置证据、修改文件、实际命令/退出码、验收ID与路径、未执行项、状态。M6/M9真实证据门槛和离线mock验收分别记录。

### M0.1：工程基础（2026-09-24，DONE）

前置证据：用户明确要求开始开发并授权GPT-6 Sol（medium）实现；已阅读README、00/01/02/08/10/11及其余专项规格。初始Git工作树仅有未跟踪规划资料，无提交、无remote；原有资料保留，未创建提交或推送。

先编写tests/engineering.test.ts，再添加package.json、package-lock.json、tsconfig.json、.gitignore和.env.example。主智能体审阅配置并同步README、AGENTS及00/08/10中的开发授权状态。仅使用TypeScript、tsx、Node类型开发依赖，无生产依赖。未实现M0.2接口、插件内核或运行时。

| 实际命令/操作 | 退出码 | 结果与边界 |
| --- | --- | --- |
| `node --version` / `npm --version` | 各0 | v24.20.0 / 11.19.0 |
| `git status --short` / `git remote -v` | 各0 | 初始规划文件均未跟踪；无remote |
| `git log -1 --oneline` | 128 | 尚无提交，不记作实现或冻结SHA |
| `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` | 130 | 默认网络等待后中止 |
| 上述安装追加`--fetch-retries=0 --fetch-timeout=15000` | 1 | 沙箱网络EPERM，未生成lock |
| `npm install --ignore-scripts --no-audit --no-fund --fetch-retries=0 --fetch-timeout=15000`（获准升级） | 0 | 安装并生成lock |
| `npm run check` | 0 | tsc严格检查通过；本次test只报告文件级通过，不作测试用例验收 |
| `npm ls --depth=0` | 0 | @types/node 24.13.6、tsx 4.23.15、typescript 5.9.3 |
| `git check-ignore .env .env.local node_modules runs/probe.json` | 0 | 密钥文件、依赖和原始runs匹配忽略规则 |
| `npm ci --offline --ignore-scripts --no-audit --no-fund` | 0 | 从lock及本地缓存成功重装 |
| `npm test -- --test-reporter=tap` / `node --import tsx --test --test-reporter=tap tests/engineering.test.ts` | 各0 | 仍只有文件级输出，不作具名用例证据 |
| 临时故意失败用例的`spawnSync`诊断（Node内联脚本） | 1 | 未取得预期断言输出；后续最小子进程探针证实spawnSync EPERM，探针本身退出0 |
| `npm test`（获准沙箱外重跑） | 0 | 具名用例`TypeScript tests execute through tsx`通过；1 test、0 fail |

工程证据：tests/engineering.test.ts的TypeScript语法实际由tsx执行，两个`@ts-expect-error`在tsc检查中验证strictNullChecks/noImplicitAny生效。无API调用。A01及其余运行时/评测验收尚未执行，A01归M0.2；不能以本次1项工程测试称M0或Harness完成。

本工单完成时下一子工单为M0.2，结果见下。远程发布与M6付费实验各在实际需要时取得对应信息和授权。

### M0.2：接口与显式校验（2026-09-24，DONE）

前置证据：用户要求继续；M0.1已完成，主智能体重新运行typecheck与具名测试通过。Git仍无提交，原有未跟踪文件保留。GPT-6 Sol（medium）子智能体先写tests/contracts.test.ts并验证缺模块失败，再实现接口与解析函数；主智能体审阅、修正边界并独立补充tests/config-boundaries.test.ts。

新增文件：src/types.ts、src/plugin.ts、src/services/index.ts、src/config.ts、src/validation.ts、eval/contracts.ts、eval/task.ts及上述两个测试文件。同步README、02-contracts与本进度；未新增依赖或脚本。

交付：九类服务及插件契约、消息/模型/工具/结果/上下文指标类型、任务与评测结果类型、运行/任务/实验配置纯校验。variant类型和开关读取specs/variants.json；检查未知字段、预算与上下文计数、模型端点、保留占位值、精确写入路径及实验阶段矩阵。解析不修改输入；空白名单合法。审阅修复了继承属性/稀疏数组绕过、凭据参数漏检与普通参数误判、公开测试可写冲突，以及以组顺序位置代替阶段语义的问题。

| 实际命令/操作 | 退出码 | 结果与边界 |
| --- | --- | --- |
| `git status --short` | 0 | 保留已有未跟踪工程与规划资料 |
| `npm run typecheck`（前置复核） | 0 | M0.1类型检查通过 |
| `npm test`（前置复核，获准沙箱外） | 0 | 原1个具名用例通过 |
| `npm test`（子智能体先写测试，获准沙箱外） | 1 | 缺src/config.js，契约测试文件失败；工程用例仍通过，确认测试先于实现 |
| `npm run typecheck`（子智能体实现后） | 0 | 契约和显式校验类型检查通过 |
| `npm test`（子智能体实现后，获准沙箱外） | 0 | 原有工程测试与6项契约测试，共7个具名用例通过 |
| `npm run typecheck`（主智能体最终验收） | 0 | 包含独立补充边界测试 |
| `npm test`（主智能体最终验收，获准沙箱外） | 0 | 11个具名用例通过，0失败/跳过，含7项A01具名用例 |
| `rg`源码静态检查（实际模式见下） | 1 | 无命中；结合源码审阅确认src不依赖eval，解析无模型调用/写文件/凭据读取 |
| 逐文件`git diff --no-index --check /dev/null <file>`（Python内联脚本汇总） | 0 | 检查12个源码/测试/文档文件，包括未跟踪文件；无空白错误。最初shell循环将无输出的差异退出码1当错误而停止，随后按no-index语义处理0/1并要求无诊断输出，完成全部文件检查 |

静态检查实际命令（退出1表示无匹配）：

```sh
rg -n '\bany\b|fetch\(|writeFile|mkdir|process\.env|eval/' src
```

验收边界：A01配置契约层检查通过，入口是parseRunConfig；尚不存在runtime/CLI，其“启动失败且无副作用”集成验证留到M3接线时执行。M0.2不实现任务加载，因此TaskSpec通过形状校验不证明资产存在、无symlink或已冻结；这些检查留M4/M5。Event payload、运行结果计数一致性等行为验收随服务/运行时实现进行。未实现C/O机制，未运行API、preflight或真实评测，未提交/推送。

本工单完成时下一子工单为M1.1，结果见下。

### M1.1：插件内核（2026-09-24，DONE）

前置证据：用户要求执行下一步，M0类型检查与11项具名测试已通过，无前置失败遗留。已阅读README、00/01/08/10/11、验收条目与现有插件/服务接口；git status确认原有未跟踪文件保留。GPT-6 Sol（medium）子智能体先写内核测试、观察缺模块失败后实现；主智能体补充独立边界测试并审阅。

新增src/context.ts、src/service-registry.ts、src/plugin-registry.ts、tests/kernel.test.ts、tests/kernel-boundaries.test.ts；同步README、11-plugin-kernel与本进度。未增加依赖、脚本或修改公共插件接口。

交付：泛型服务注册与身份绑定的移除函数；按调用者顺序加载、按服务名检查依赖；重复服务/插件拒绝；失败启动清理此前成功插件；逆序异步清理、首个错误报告和幂等dispose；独立Context隔离。内核只接线和管理生命周期，无业务插件实现。

审阅发现并修复：原dispose在保存closing Promise前同步执行清理回调，重入dispose可提前移除上游，且关闭期间仍可注册服务。新增两项复现先失败，修复为先发布closing Promise再执行清理；启动失败触发清理时也立即拒绝新的注册。故障插件自清理及外部资源释放仍由插件负责，不增加事务。

| 实际命令/操作 | 退出码 | 结果与证据 |
| --- | --- | --- |
| `git status --short` | 0 | 现有未跟踪资料保留；无提交或推送 |
| `npm test`（子智能体先写测试，获准沙箱外） | 1 | kernel.test.ts缺context.js，原11项通过；测试先于实现 |
| `npm run typecheck` / `npm test`（子智能体首轮实现后） | 各0 | 20项具名测试通过，包含首批3项独立边界测试 |
| `npm test`（增加清理重入复现，获准沙箱外） | 1 | 22项中20通过、2失败，定位K02/K03关闭状态窗口 |
| `npm run typecheck` / `npm test`（修复后） | 各0 | 22项全部通过 |
| `npm run typecheck`（主智能体最终验收） | 0 | strict类型检查通过 |
| `npm test`（主智能体最终验收，获准沙箱外） | 0 | 22项具名测试通过、0失败/跳过；其中11项为新增内核用例 |
| 逐文件`git diff --no-index --check /dev/null <file>`（Python内联脚本汇总） | 0 | 本次8个源码/测试/文档文件无空白错误，包含未跟踪文件；按no-index语义处理0/1且要求无诊断输出 |

验收：K01/K02内核行为通过；K03覆盖部分setup失败自清理、前置插件回收与同一测试consumer替换provider；K04覆盖两个Context服务隔离。K03真实Loop不改源码替换provider、K04两runtime的Session/权限/工具/预算隔离及schema/handler清理，须在相应服务与runtime存在后补做。R06属于M1.2及M3，不在本次宣称通过。未运行API、preflight或真实模型评测，未实现C/O。

本工单完成时下一子工单为M1.2，结果见下。

### M1.2：事件、持久化、Session与只读日志（2026-09-24，DONE）

前置证据：用户要求执行下一步；M1.1已有typecheck和22项具名测试通过，无前置失败。核对README、00/02/03/08/10/11、现有接口及Git状态，原有未跟踪资料保留。GPT-6 Sol（medium）子智能体实现，主智能体审阅并补充独立边界测试。

接口决定：Q-M1.2-01已记入open-questions。用户明确选择Session统一编号并返回Event；SessionService.record改为接收EventInput `{type,data}`、返回Promise<Event>，append沿用Promise<void>，二者共享序号和时间。调整前暂停依赖该选择的Session实现，先推进Events/持久化/解析；得到回复后实施。

新增src/plugins/events.ts、jsonl-persistence.ts、memory-session.ts、src/journal.ts、tests/session.test.ts及tests/session-boundaries.test.ts；更新src/types.ts、src/services/index.ts和README、02-contracts、open-questions、本进度。无新依赖/脚本，不修改内核或提前实现Agent策略。

交付：事件注册/取消及快照隔离；工作区外JSONL独占创建、串行写入和幂等关闭；Session先完成持久化再更新完整历史/发布事件，写失败阻断所有后续写入，正常run_end唯一；只读解析序号/时间、生命周期和message call/result关联，断尾/缺结束记录返回incomplete。支持替换持久化provider和独立Session。

审阅修复：record(message)必须与append一致更新历史；均值与耗时接受有限小数；稀疏calls拒绝；最后一行坏JSON含换行仍标incomplete；dispose后的观察服务不可复活。另以两项失败测试复现并修复返回Event与历史/provider共享引用、旧unsubscribe删除后来同listener注册的问题。

| 实际命令/操作 | 退出码 | 结果与证据 |
| --- | --- | --- |
| `git status --short` | 0 | 保留已有文件；无提交/推送 |
| 先写Session测试后的`npm test`（完整命令见下，获准沙箱外） | 1 | 原22项通过，新session.test.ts因events.js尚不存在报ERR_MODULE_NOT_FOUND，确认测试先于实现；筛选参数位于文件列表后，实际输出包含全部旧测试 |
| `npm run typecheck`（Session接口等待决定期间） | 2 | 当时仅缺memory-session模块，未声明实现完成 |
| `npm run typecheck` / `npm test`（首轮集成） | 各0 | 29项具名测试通过；随后补充边界测试 |
| `npm run typecheck` / `npm test`（子智能体补验） | 各0 | 35项具名测试通过 |
| `npm test`（加入引用身份复现，获准沙箱外） | 1 | 39项中37通过、2失败，确认返回Event和旧unsubscribe漏洞 |
| `npm run typecheck` / `npm test`（修复后） | 各0 | 39项具名测试通过 |
| `npm run typecheck`（主智能体最终核验） | 0 | strict检查通过 |
| `npm test`（主智能体最终核验，获准沙箱外） | 0 | 39项具名测试通过，0失败/跳过；相对M1.1新增17项 |
| 逐文件`git diff --no-index --check /dev/null <file>`（Python内联脚本汇总） | 0 | 本次12个源码/测试/文档文件无空白错误，覆盖未跟踪文件；按no-index语义处理0/1且要求无诊断输出 |

最初失败验证实际命令：

```sh
npm test -- --test-name-pattern='R06|K03/K04|K03 JSONL'
```

验收边界：R06的Session先写后提交、写失败封存、断尾诊断和唯一结束记录部分通过；K03/K04覆盖持久化替换、服务清理、Session隔离和观察者隔离。AgentLoop将Session拒绝映射为io_error并停止后续工具/模型动作、HTTP事件与用量重算、完整runtime预算/权限/工具隔离留M2–M4，未声称其通过。当前解析器只接受三种已实现payload，真实实验日志格式与verify尚未完成。未调用模型API、preflight或真实评测，未实现C/O。

本工单完成时下一子工单为M2.1，结果见下。

### M2.1：权限与工具注册（2026-09-24，DONE）

前置证据：用户要求继续；M0/M1已完成，M1.2类型检查及39项具名测试通过。核对README、00/02/04/08/10/11、既有接口、未决问题和Git状态；保留全部已有未跟踪文件。GPT-6 Sol（medium）子智能体先写测试再实现；主智能体另写7项边界用例并审阅。无公共接口变更或待用户决定问题。

新增src/plugins/permissions.ts、src/plugins/tools.ts、tests/tools.test.ts、tests/tool-boundaries.test.ts；同步README、04-tools及本进度。无新增依赖或脚本，不实现实际文件handler、Shell、模型计量或Agent Loop。

交付：五工具默认权限及精确白名单快照、词法路径检查；明确的字符串参数schema子集；schema/handler注册快照、排序输出和身份绑定disposer；JSON/字段/类型/权限检查后执行handler；异常脱敏、16000字符上限（含标记）、取消传播。默认权限拒绝未知工具，可通过替换Permission provider验证工具服务扩展。输入含普通TEMPLATE文字不被当作配置占位值拒绝。

审阅补验覆盖白名单/注册定义/返回schema修改隔离、旧disposer、取消前不执行及取消后等待handler结束、输出上限。进一步用两项失败测试复现并修复稀疏或glob白名单被接受，以及ToolResult额外字段透传的问题。

| 实际命令/操作 | 退出码 | 结果与证据 |
| --- | --- | --- |
| `git status --short` | 0 | 原有文件保留，未提交/推送 |
| `node --import tsx --test tests/tools.test.ts`（子智能体先写测试） | 1 | 缺permissions.js，确认测试先于实现 |
| `npm test`（首轮检查） | 1 | 45项中44通过；测试误将约定标记断言为truncated而非[truncated]，修正该断言，未放宽输出限制 |
| `npm run typecheck` / `npm test`（首次完整实现） | 各0 | 50项具名测试通过 |
| `npm test`（新增两项审阅复现） | 1 | 52项中50通过、2失败，分别为白名单验证和返回值额外字段 |
| `npm run typecheck` / `npm test`（修复后） | 各0 | 52项具名测试通过 |
| `npm run typecheck`（主智能体最终验收） | 0 | strict检查通过 |
| `npm test`（主智能体最终验收，获准沙箱外） | 0 | 52项具名测试通过，0失败/跳过；相对M1.2新增13项 |
| 逐文件`git diff --no-index --check /dev/null <file>`（Python内联脚本汇总） | 0 | 本次7个源码/测试/文档文件无空白错误，覆盖未跟踪文件；按no-index语义处理0/1且要求无诊断输出 |

验收边界：T01仅词法路径部分；T02仅白名单和拒绝后handler未执行部分；T04参数错误、通用输出上限与取消传播部分；K04注册/撤销、schema快照和替换Permission provider部分通过。真实文件/symlink/特殊文件/保护文件不变、T03原子写入和唯一编辑、256KiB/1000项限制留M2.2；请求/工具预算留M3。未运行API、题目preflight或真实模型评测。

本工单完成时下一子工单为M2.2，结果见下。

### M2.2：五个文件工具（2026-09-24，DONE）

前置证据：用户要求执行下一步；M2.1类型检查与52项具名测试通过。核对README、00/02/04/08/09/10/11、既有接口、未决问题及Git状态，保留原有未跟踪文件。GPT-6 Sol（medium）子智能体先写测试再实现；主智能体新增8项边界测试并审阅、独立验收。

新增src/plugins/file-tools.ts、src/plugins/file-tools-atomic.ts、tests/file-tools.test.ts及tests/file-tool-boundaries.test.ts；同步README、04-tools与本进度。file-tools只依赖tools并注册五个工具，无新增服务接口、依赖或脚本；原子写辅助函数的write/rename注入仅用于内部故障测试。

交付：启动时realpath工作区并确认目录，逐段lstat拒绝symlink/特殊文件；读/写/编辑按UTF-8字节检查256KiB；write拒绝用小内容覆盖已有超限文件；edit要求非空oldText且只出现一次（含重叠匹配），替换结果同样限长。list按工作区相对路径全局字典序输出，最多1000项并受通用16000字符限制。delete仅删除精确白名单普通文件，不存在返回file_missing。父目录须已存在。

审阅修复：临时文件独占open成功后才标记owned，防止创建失败时误删他人文件；固定短临时名支持255字节basename；关闭失败仍尝试清理；注册部分失败时撤销既有handler，清理失败不覆盖原始setup错误且不阻断其他撤销。测试注入rename失败、真实部分写入后失败及提交前取消，均确认原内容完整、临时文件移除。真实Unix socket与外部symlink夹具验证文件类型边界；两个工作区互不影响。

| 实际命令/操作 | 退出码 | 结果与证据 |
| --- | --- | --- |
| `git status --short` | 0 | 保留原有未跟踪文件，未提交/推送 |
| `npm test`（子智能体先写测试，获准沙箱外） | 1 | 原52项通过，新增file-tools.test.ts因缺file-tools.js报ERR_MODULE_NOT_FOUND；共53项、1失败，确认先测试后实现 |
| `npm run typecheck` / `npm test`（首次实现检查） | 2 / 1 | file-tools.ts残留数组逗号导致语法错误；修正后继续验收，未绕过检查 |
| `npm run typecheck` / `npm test`（子智能体修复后） | 各0 | 66项具名测试通过 |
| `npm test` / `npm run typecheck`（补齐提交前取消断言后） | 各0 | 66项具名测试通过 |
| `npm run typecheck`（主智能体最终验收） | 0 | strict检查通过 |
| `npm test`（主智能体最终验收，获准沙箱外） | 0 | 66项具名测试通过，0失败/取消/跳过；相对M2.1新增14项 |
| 逐文件`git diff --no-index --check /dev/null <file>`（Python内联脚本汇总） | 0 | 本次7个源码/测试/文档文件无空白错误，覆盖未跟踪文件；按no-index语义处理0/1且要求无诊断输出 |

验收：T01真实相对路径、symlink父/叶、Unix socket拒绝与外部哨兵不变；T02保护文件不可写、非白名单删除/越界拒绝；T03零/多/重叠匹配不改、单次替换、原子失败清理；T04缺失文件、参数、字节边界、长输出与1000项列表；K04文件工具注册回滚及工作区隔离通过。工具实现不读取variant，四组复用同一插件；四组runtime端到端集成仍待后续工单，未声称已跑四组。所有调用由上层串行await，未实现Agent Loop或请求预算；不承诺恶意外部并发或断电持久化。未请求API、运行题目preflight或真实实验。

本工单完成时下一子工单为M3.1，结果见下。

### M3.1：模型插件、共享计量与模型事件（2026-09-24，DONE）

前置证据：用户要求下一步，M2类型检查与66项具名测试通过。核对README、00/02/03/08/09/10/11、既有Session和接口以及Git状态；保留原有未跟踪文件。两个GPT-6 Sol（medium）子智能体分别实现模型/计量和事件校验，主智能体补13项独立边界测试并审阅、验收。按openai-docs技能核对官方Chat Completions字段，出处记录在02-contracts；仅本地fake HTTP使用测试密钥，无真实provider调用。

接口决定Q-M3.1-01：用户明确批准ModelRequest.contextMetrics只输入五项投影指标，计量包装器生成requestChars与observationSeq。主智能体调整src/types.ts、02/03及open-questions；完整WorkerContextMetrics不变。未实现ContextManager、Agent Loop、CLI或C/O机制。

新增src/accounting.ts、model-protocol.ts、model-events.ts、src/plugins/model-common.ts、http-model.ts、mock-model.ts及tests/models.test.ts、model-events.test.ts、model-boundaries.test.ts；更新src/journal.ts及上述类型、README/契约/流程/未决问题/本进度。无新增依赖或脚本。

交付：每runtime独立Accounting复制预算并提供共同deadline，worker/optimizer/summary共享额度；持久化请求意图成功后才预留并调用provider，已调用的失败请求也计数。按输入/输出分别保留缺失用量null和known总数，结构非法但usage有效的HTTP响应也保留独立用量证据。编码实际body并记录长度，worker硬超限先记录观测但不进入已发请求统计。HTTP使用完整endpoint、环境变量key、非流式单choice文本/function工具协议，无retry/redirect；headers与body均受signal控制。模型错误脱敏，关闭或日志失败后服务封存。

日志新增context_observation/request/response，校验明确payload、观测长度/估算关联、单次观测引用、串行请求和唯一响应配对；completed不得有未响应请求。完整RunResult计数重算仍留M4。非法结构的原始响应不保存为规范response，合法length/other保留诊断响应后抛model_error。模型返回后若在response保存期间取消，包装器仍拒绝迟到成功，不修改已保存的响应事件。

审阅修复与回归：调用输入快照避免日志await期间更改kind/messages；替换Session失败也封存，不仅依赖默认Session；取消等待底层provider结束而非放任后台回调；HTTP拒绝状态关闭未消费body；局部取消、共同deadline及最后一次合法额度分别检查；生命周期关闭旧引用；响应落盘期间取消的失败用例修复。预先验证指标等价关系和JSON可序列化性，避免将输入错误误判为io_error。

| 实际命令/操作 | 退出码 | 结果与证据 |
| --- | --- | --- |
| `git status --short` | 0 | 保留原有未跟踪文件，无提交/推送 |
| `node --import tsx --test tests/models.test.ts`（模型子智能体先测） | 1 | 缺model-protocol.js，确认先测试后实现 |
| `node --import tsx --test tests/model-events.test.ts`（事件子智能体先测） | 1 | 缺model-events模块；沙箱内运行不据文件级结果作具名验收 |
| `npm run typecheck`（事件首次集成） | 2 | 并行实现中的accounting.ts可选signal字段违反exactOptionalPropertyTypes，修正后再验收 |
| `npm test`（中间集成，获准沙箱外） | 1 | 当时81项中80通过；事件测试fixture序号先触发sequence gap，修正fixture以实际覆盖缺失观测引用 |
| `node --import tsx --test tests/model-events.test.ts`（事件修正后，获准沙箱外） | 0 | 4项具名测试通过；事件子智能体typecheck随后退出0 |
| `node --import tsx --test tests/model-boundaries.test.ts tests/models.test.ts`（取消回归，获准沙箱外） | 1 | 当时17项中16通过，复现response持久化期间取消却返回成功 |
| `node --import tsx --test tests/model-boundaries.test.ts tests/models.test.ts tests/model-events.test.ts`（修复后，获准沙箱外） | 0 | 26项具名用例/子用例通过 |
| `npm run typecheck` / `npm test`（模型子智能体最终检查） | 各0 | 92项具名用例/子用例通过 |
| `npm run typecheck`（主智能体最终验收） | 0 | strict检查通过 |
| `npm test`（主智能体最终验收，获准沙箱外） | 0 | 92项具名用例/子用例通过，0失败/取消/跳过；相对M2新增26项，含headers/body两个独立超时子用例 |
| 逐文件`git diff --no-index --check /dev/null <file>`（Python内联脚本汇总） | 0 | 本次16个源码/测试/文档文件无空白错误，覆盖未跟踪文件；按no-index语义处理0/1且要求无诊断输出 |

验收边界：R02共享请求限额、R04 HTTP超时/取消/429/重定向/非法JSON/不合法完成原因、R05模型分项计数与未知usage、R06模型层持久化失败封存、R07请求体长度与观测统计、K04模型关闭部分通过。实际HTTP收到body与日志完全相同，诊断字段/key不进入body；错误正文/key不进入事件。R01完整读改final、R03工具前缀预算、R05非法工具调用计量、ContextManager的真实历史轮次/阈值生成、Loop终止结果及A02 CLI仍待M3.2/M3.3。没有运行真实模型、题目preflight、baseline或四组实验。

本工单完成时下一子工单为M3.2，结果见下。

### M3.2：完整上下文投影与Agent Loop（2026-09-24，DONE）

前置证据：用户要求下一步；M3.1类型检查与92项具名测试通过。核对README、00/02/03/08/09/10/11、接口及Git状态，保留原有未跟踪文件。三个GPT-6 Sol（medium）子智能体分别实现完整上下文、循环和工具事件，主智能体编写15项独立边界用例/子用例并审阅、验收。无公共服务接口变更，无新增依赖或脚本。

新增src/plugins/context-manager.ts、agent-loop.ts、src/tool-events.ts及tests/context-manager.test.ts、agent-loop.test.ts、tool-events.test.ts、loop-boundaries.test.ts；更新src/journal.ts、src/plugins/model-common.ts以及README、02-contracts、03-runtime和本进度，共13个文件。

交付：ContextManager保持完整历史、system和工具定义，按完整assistant/tool轮次计算olderRounds、阈值及可压缩观测；不丢历史、不调用摘要模型。Loop每实例只运行一次，记录原始任务、assistant/tool消息和唯一run_end，工具串行执行。参数错误和权限拒绝消耗工具额度；预算外后缀记录未执行，不伪造工具消息、不再调用worker。最后一次合法模型响应仍可执行工具；已派发工具取消后等待其结束。可选Optimizer只有既有服务接口连接及注入测试，未实现机制插件。

工具事件校验调用内容、顺序、start/end关联、结果消息一致性，拒绝未回传结果就继续调用和终止错误后继续派发；旧版仅message日志仍可只读检查。返回RunResult与保存的run_end一致，持久化失败立即终止且不尝试伪造结束记录。完整计数重算仍留M4。

审阅修复：模型日志失败不得再尝试run_end；替换Tools返回值须先校验；runOptions.signal在调用入口快照；共同deadline在model-common中优先于合并的请求signal识别为timeout，避免响应记cancelled而最终结果记timeout。真实文件夹具补finally清理Context及临时目录。

| 实际命令/操作 | 退出码 | 结果与证据 |
| --- | --- | --- |
| `git status --short` | 0 | 保留原有文件，未提交/推送 |
| Context子智能体先写测试后的失败验证 | 1 | 新模块尚不存在；随后实现。中间阈值fixture不符预期，修正仅该测试窗口，未改默认窗口/断言规则 |
| `npm test`（中间集成） | 1 | 当时121项中113通过，7项循环fixture缺model依赖、1项上下文fixture阈值断言失败；修正后再验收 |
| `npm run typecheck` / `npm test`（Context集成后） | 各0 | 当时121项具名测试通过 |
| `node --import tsx --test tests/agent-loop.test.ts tests/loop-boundaries.test.ts`（审阅回归） | 1 | 当时22项中18通过、4失败，复现模型日志失败、非法工具结果、signal可变引用和超时分类问题 |
| 同上（四项修复并新增真实文件链路后） | 0 | 23项具名用例/子用例通过 |
| `node --import tsx --test tests/tool-events.test.ts tests/model-events.test.ts tests/session.test.ts`（日志顺序修复后） | 0 | 20项具名测试通过，typecheck退出0；子智能体另报告新增的结果消息顺序及终止错误后派发断言在修复前失败（退出1） |
| `npm run typecheck` / `npm test`（循环子智能体最终检查） | 各0 | 127项具名用例/子用例通过 |
| `npm run typecheck`（主智能体最终验收） | 0 | strict检查通过 |
| `npm test`（主智能体最终验收，获准沙箱外） | 0 | 127项具名用例/子用例通过，0失败/取消/跳过；相对M3.1新增35项 |
| 逐文件`git diff --no-index --check /dev/null <file>`（Python内联脚本汇总） | 0 | 本次13个源码/测试/文档文件无空白错误，覆盖未跟踪文件；按no-index语义处理0/1且要求无诊断输出 |

验收边界：R01用脚本模型和真实文件工具验证read→edit→final、文件内容及完整JSONL回放；这不是CLI验收、外部功能评分或真实模型成绩。R02/R03覆盖请求与工具预算；R04覆盖取消、等待在途工具和共同超时分类；R05覆盖错误调用计数；R06覆盖各持久化失败边界及事件关联；R07覆盖完整历史轮次/阈值投影；K04覆盖重复运行、关闭旧引用和独立状态。runtime装配、finally清理、CLI/A02留M3.3；Evaluator/完整verify留M4。未运行真实模型、题目preflight或baseline/四组实验，未实现C/O算法。

本工单完成时下一子工单为M3.3，结果见下。

### M3.3：Baseline Runtime与单次CLI（2026-09-24，DONE）

前置证据：用户要求下一步，M3.2类型检查与127项具名测试通过。核对README、00/02/03/08/09/10/11、既有插件/API及Git状态，保留原有未跟踪文件。两个GPT-6 Sol（medium）子智能体分别实现runtime和CLI，主智能体编写7项独立边界回归并审阅。新增装配API沿用既有服务接口，无服务契约变更、生产依赖或C/O机制。

新增src/runtime.ts、src/cli.ts、tests/runtime.test.ts、tests/cli.test.ts、tests/runtime-boundaries.test.ts；更新package.json（agent入口）、.env.example、README、02-contracts、03-runtime及本进度，共11个文件。

交付：createRuntime在首个await前校验/复制配置、捕获模型工厂及取消信号；按既有插件顺序装配，共享Accounting，默认HTTP，可显式替换脚本模型。组开关读取specs，仅baseline开放。run仅一次并finally清理，运行中dispose取消且等待在途provider，清理失败仍释放其他服务并拒绝调用；已保存run_end不被改写。固定BASE_SYSTEM仅含任务和文件操作规则，无规划器或结束前验证门禁。

CLI支持config与input/input-file、help，JSON结果输出、固定脱敏错误及0/2/1/130退出码；SIGINT等待取消和清理完成。相对路径按启动cwd解析，校验先于路径解析，目录预先存在，日志在workspace外且不可覆盖；不自动加载.env。外部Node验收只在测试中运行，CLI本身不执行评分。

审阅修复：CLI不得先把空workspace解析为cwd后再校验；改为parseRunConfig后由runtime解析路径，合法组开关仍取variantFlags。空路径回归使用日志在cwd外的布局，确认按配置错误拒绝且日志未创建，避免被另一个路径约束掩盖。CLI测试从临时cwd启动时使用绝对tsx loader，并为子进程加超时、SIGINT等待同时监听提前退出，避免失败用例永久挂起；临时目录和本地HTTP服务均清理。

| 实际命令/操作 | 退出码 | 结果与证据 |
| --- | --- | --- |
| `git status --short` | 0 | 保留原有文件，无提交/推送 |
| `npm run typecheck`（runtime先写测试） | 2 | runtime模块尚不存在，另有测试TestContext类型笔误；实现/修正后再验收 |
| `npm test`（runtime子智能体中间集成） | 130 | CLI临时cwd下不能解析tsx，另一个CLI用例等待请求挂起，约100秒后中断；未认定通过 |
| `node --import tsx --test tests/runtime.test.ts`（runtime子智能体） | 0 | 5项通过，真实文件修改后外部Node测试成功；其typecheck退出0 |
| `node --import tsx --test tests/runtime-boundaries.test.ts`（主智能体初轮） | 0 | 最初5项通过 |
| 同上（追加signal快照和两工作区隔离） | 1 | 7项中6通过；关闭Tools后schemas按既有契约抛错，测试误期望空数组 |
| 同上（按既有关闭契约修正断言） | 0 | 7项通过，关闭旧服务拒绝调用，另一工作区可正常写入 |
| `npm run typecheck`（主智能体集成检查） | 0 | strict检查通过 |
| `npm run agent -- --help` | 0 | 新增脚本与真实CLI入口可运行，不读取密钥或调用模型 |
| `node --import tsx --test tests/cli.test.ts`（CLI首次验证） | 1 | 子智能体报告未实现入口/受限监听失败；不以沙箱文件级输出作为具名验收 |
| `node --import tsx --test --test-isolation=none tests/cli.test.ts`（CLI子智能体，获准沙箱外） | 0 | 5项具名测试通过，随后审阅调整配置校验和失败fixture；其typecheck退出0 |
| `npm test`（主智能体完整验收，获准沙箱外） | 0 | 144项具名用例/子用例通过，0失败/取消/跳过；相对M3.2新增17项 |
| `npm run typecheck`（主智能体最终验收） | 0 | strict检查通过 |
| `node --import tsx --test tests/cli.test.ts`（主智能体最后fixture调整后，获准沙箱外） | 0 | 5项通过，覆盖completed 0、request_limit 2、配置1和SIGINT 130；空workspace不建日志 |
| 逐文件`git diff --no-index --check /dev/null <file>`（Python内联脚本汇总） | 0 | 本次11个源码/测试/文档文件无空白错误，覆盖未跟踪文件；按no-index语义处理0/1且要求无诊断输出 |


验收边界：A01/A02的严格启动检查、CLI退出码/信号/清理、输入文件与日志拒绝覆盖通过；R01脚本模型及本地fake HTTP完整read→edit→final后，实际文件修复且外部Node断言通过，正常JSONL完整；K02/K03/K04覆盖清理异常、启动失败、两工作区/预算独立及关闭旧引用；R04/R06覆盖等待在途模型和Session失败后的清理。既有R02–R07与T01–T04回归保留。工程验证不代表真实模型能力；完整计数重算、评测评分/verify及任务资产仍待M4/M5，C/O实现仍受M6门槛约束。未调用真实provider、未创建题库资产、未运行preflight、baseline或四组实验。

本工单完成时下一子工单为M4.1，结果见下。

### M4.1：任务资产加载、独立副本与快照（2026-09-24，DONE）

前置证据：用户要求执行下一步，M3类型检查与144项具名测试通过。核对README、00/02/05/08/10、TaskSpec与评测契约及Git状态；保留全部已有未跟踪文件。两个GPT-6 Sol（medium）子智能体分别实现资产加载/副本和快照/changes，主智能体编写独立smoke资产及6项跨模块边界用例并审阅。未修改src运行时，不添加评测平台或研究机制。

新增eval/assets.ts、eval/workspace.ts、tests/assets.test.ts、tests/workspace.test.ts、tests/eval-assets-boundaries.test.ts及tests/fixtures/README.md、eval-smoke下task.json/prompt.md/workspace两文件/acceptance/reference六文件；同步README、02-contracts、05-evaluator与本进度，共16个文件。无新增依赖、入口脚本或Git提交。

交付：从全包一致快照解析任务，校验必需路径、ID、资产类型、工作区与隐藏材料分离；整个包拒绝symlink/特殊文件。全包相对路径/类型及原字节hash生成稳定taskHash，隐藏或附加文件与task.json格式变化均参与，绝对目录/mtime不参与。materialize重新核对任务及元数据，独占创建目标，只复制workspace文件/目录；副本和原资产独立，既有目标不覆盖，失败仅清理本次拥有的目录。

快照保留排序路径、原字节SHA-256和内容（合法UTF-8含BOM/CRLF，其他字节base64），不遍历symlink或读取FIFO。changes保留增删改前后证据，完整性检查拒绝非writable文件变化及任意symlink/特殊项；纯空目录变化不扩大既有文件评分规则。重复/越界路径、缺失父目录、内容/hash不一致不能进入比较。返回结构供后续runner落盘，本阶段没有生成attempt报告。

审阅修复：task.json/prompt从同一assets快照解析，避免内容与taskHash来自不同读取时点；prompt的BOM保留而非解码时丢失。普通磁盘文件名与配置白名单校验分离，避免TEMPLATE或方括号文件名导致after证据无法记录；精确writable仍拒绝通配/占位值，并用Array.from拒绝稀疏数组。

| 实际命令/操作 | 退出码 | 结果与证据 |
| --- | --- | --- |
| `git status --short` | 0 | 保留已有未跟踪文件，无提交/推送 |
| `node --import tsx --test tests/assets.test.ts`（资产先写测试） | 1 | 缺assets模块，确认测试先于实现 |
| `node --import tsx --test --test-isolation=none tests/assets.test.ts`（资产首次实现） | 0 | 4项通过；typecheck退出0 |
| 同上（新增BOM回归） | 1 | 5项中4通过，prompt的BOM丢失断言失败 |
| 同上（同快照读取/BOM修复后） | 0 | 5项通过；typecheck退出0 |
| `node --import tsx --test tests/eval-assets-boundaries.test.ts`（主智能体初轮，获准沙箱外） | 0 | 6项通过；独立副本、全资产hash、隐藏canary、元数据伪造、symlink与拒绝覆盖验证 |
| `node --import tsx --test tests/workspace.test.ts`（文件名/稀疏数组审阅回归，获准沙箱外） | 1 | 8项中6通过、2失败，复现普通磁盘文件名被拒及稀疏白名单未拒 |
| 同上（修复后） | 0 | 8项通过；快照子智能体typecheck退出0 |
| `npm run typecheck`（主智能体最终验收） | 0 | strict检查通过 |
| `npm test`（主智能体最终验收，获准沙箱外） | 0 | 163项具名用例/子用例通过，0失败/取消/跳过；相对M3新增19项 |
| src→eval依赖检查（rg，完整命令见下） | 1 | 无匹配，src未导入eval；此退出码表示无匹配，不是测试失败 |
| 逐文件`git diff --no-index --check /dev/null <file>`（Python内联脚本汇总） | 0 | 本次16个源码/测试/夹具/文档文件无空白错误，覆盖未跟踪文件；按no-index语义处理0/1且要求无诊断输出 |


依赖检查实际命令：

```sh
rg -n 'from .*eval|import\(.*eval' src
```

验收边界：E01覆盖两个独立材料副本、相同初始快照、修改不串到另一副本或原任务；完整矩阵留M4.3。E02通过实际runtime脚本模型列文件/read/edit/final，核对每个请求均无acceptance/reference canary，公开测试独立执行通过；隐藏评分副本由M4.2实现。E03仅完整性检查部分通过，尚未形成综合passed评分。E05仅快照/changes输入一致性基础，完整run verify留M4.4；E07仅资产hash与重载漂移检查，Git/冻结manifest检查留M4.3/M5。真实磁盘symlink、FIFO、二进制及BOM/CRLF均有用例；可信自建任务，不声称对恶意外部并发进程提供OS沙箱。

本工单完成时工程smoke不属于Benchmark题库，未运行judge/preflight、冻结检查、真实模型、baseline或消融实验。下一子工单为M4.2，结果见下。

### M4.2：外部judge与preflight（2026-09-24，DONE）

前置证据：用户要求下一步，M4.1类型检查与163项具名测试通过。核对README、00/02/05/08/09/10及当前契约和Git状态，保留全部已有未跟踪文件。两个GPT-6 Sol（medium）子智能体分别实现外部check和judge；主智能体负责reference补丁应用、preflight、独立边界回归及架构审阅。

新增eval/check.ts、check-worker.mjs、judge.ts、reference.ts、preflight.ts，以及tests/check.test.ts、judge.test.ts、reference.test.ts、preflight.test.ts、judge-boundaries.test.ts；更新README、02-contracts、05-evaluator、tests/fixtures/README及本进度，共15个文件。未修改src、依赖、入口脚本或既有smoke题包，无Git提交/推送。

交付：runCheck使用独立Node进程和真实测试事件，单独管道返回完成摘要，不把stdout中的伪TAP或提前exit(0)认作成功。零测试、语法错误、未完成和超时均失败；超时清理进程组，日志保留错误消息/堆栈并计算原字节hash。检查工作区、测试和输出目录的路径及祖先，日志独占创建；子进程环境白名单不传API密钥。进程组和临时目录不构成OS沙箱，仅执行可信自建任务。

judge重新核对任务与初始快照，沿用checkIntegrity评分；只把允许的候选变化应用到两个全新副本。公开测试和隐藏验收各自独立，使用原始测试资产；公开测试副作用不污染隐藏副本。保留两份测试日志，清理临时副本。functionalPass与主passed分开；主passed同时要求completed终止、完整性通过和两项测试通过，终止/完整性/公开/隐藏失败原因按约定优先级记录。

reference支持严格文本unified diff子集：精确上下文、多文件、创建/删除、无尾换行及CRLF，不做模糊匹配；拒绝越权、越界、重复目标及不支持的二进制/rename/copy/权限变更。preflight先确认初始公开测试真实完成、初始隐藏验收实际失败，再在快照应用reference，要求修复后两项测试和完整性通过；输出initial/reference日志与preflight.json，不覆盖旧输出。

审阅修复：输出路径检查覆盖祖先symlink；日志写入失败仍关闭文件；writable文件变为空目录沿用共享完整性规则并在副本正确删除旧文件，不添加评分条件；失败事件序列化保留Error消息/堆栈/cause，避免失败日志只有空对象。

| 实际命令/操作 | 退出码 | 结果与证据 |
| --- | --- | --- |
| `git status --short` | 0 | 保留全部已有未跟踪文件，无提交/推送 |
| `node --import tsx --test --test-isolation=none tests/check.test.ts`（先写测试） | 1 | check模块尚不存在 |
| 同上（首次实现） | 0 | 5项通过 |
| 同上（祖先symlink回归／修复后） | 1／0 | 先复现未拒绝，修复后5项通过；typecheck退出0 |
| judge子智能体定向测试（先写测试／最终审阅修复后） | 1／0 | 先缺judge模块，最终8项通过；含E03三种主评分失败与副本隔离 |
| `node --import tsx --test tests/reference.test.ts`（先写测试／实现后） | 1／0 | 先缺reference模块，实现后4项通过 |
| `node --import tsx --test tests/preflight.test.ts`（先写测试／实现后） | 1／0 | 先缺preflight模块，实现后10项具名用例/子用例通过 |
| `node --import tsx --test tests/judge-boundaries.test.ts`（主智能体独立回归） | 0 | 4项通过：未完成、伪输出/环境、后代进程超时清理、保护测试及日志hash |
| `npm test`（主智能体首次完整回归） | 0 | 194项通过，随后追加错误日志回归 |
| `node --import tsx --test --test-isolation=none tests/check.test.ts`（Error日志回归／修复后） | 1／0 | 先复现失败消息缺失，修复后6项通过；typecheck退出0 |
| `npm run typecheck`（主智能体最终验收） | 0 | strict检查通过 |
| `npm test`（主智能体最终验收） | 0 | 195项具名用例/子用例通过，0失败/取消/跳过；相对M4.1新增32项 |
| `rg -n 'from .*eval|import\(.*eval' src` | 1 | 无匹配，src未导入eval；不是测试失败 |
| 逐文件`git diff --no-index --check /dev/null <file>`（Python内联脚本汇总） | 0 | 本次15个源码/测试/文档文件无空白错误，覆盖未跟踪文件；按no-index语义处理0/1且要求无诊断输出 |

验收边界：E02隐藏验收仅注入外部副本，使用原始测试、保留候选证据且副本互不污染。E03覆盖公开通过/隐藏失败、越界但功能通过、预算终止但功能通过，主passed均false且原因独立。E04覆盖初始全过、reference失败/越权、零测试、语法错误、提前exit(0)、挂起和超时；smoke初始隐藏失败、reference两项通过。B01仅完成预检能力及smoke验证，尚无S8/H4十二题逐题证据，不能标Benchmark验收通过。调度/逐次结果/冻结检查留M4.3，汇总报告和完整verify留M4.4；真实题库与Git冻结留M5。未调用真实provider、未运行baseline/消融实验、未实现C/O。

本工单完成时下一子工单为M4.3，结果见下。

### M4.3：评测调度、逐次证据与冻结校验（2026-09-24，DONE）

前置证据：用户要求下一步，M4.2类型检查与195项具名测试通过。核对README、00/02/05/07/08/09/10、AGENTS及当前实现/Git状态，保留全部既有未跟踪文件。两个GPT-6 Sol（medium）子智能体分别实现benchmark/Git校验和schedule/attempt/runner；主智能体实现CLI/smoke入口、独立边界与本地假HTTP集成并审阅验收。

新增eval/benchmark.ts、schedule.ts、attempt.ts、runner.ts、cli.ts、smoke.ts和tests/benchmark.test.ts、schedule.test.ts、attempt.test.ts、runner.test.ts、eval-cli.test.ts、eval-boundaries.test.ts、eval-http.test.ts；更新eval/contracts.ts、package.json、README、02-contracts、05-evaluator、tests/fixtures/README及本进度，共20个源码/测试/文档文件。无新增依赖、src改动、项目Git提交或推送。临时测试Git提交仅用于校验器回归，不是本项目benchmark-v1。

交付：参数覆盖先合并/校验，保存实际配置；纯schedule按specs唯一组顺序、任务ID及repeat轮换，完整顺序先于模型请求落盘。runner只接受baseline，smoke显式注入mock；真实模式使用HTTP、要求密钥、执行代码所属Git根与clean实现提交。每次创建独立workspace/runtime/Session/预算，保存journal、before/after/changes、原始测试日志及result；模型/预算/工具失败不删除、不retry，继续后续attempt。异常停止保留已有产物和脱敏error.json，已存在目录/文件不覆盖。

冻结校验严格检查manifest全部任务（包括未选题）的ID/suite/taskHash，记录manifest原字节benchmarkHash；benchmarkCommit取最后修改manifest的祖先提交，逐文件核对冻结Git树，不以当前实现HEAD代替。选中题全部preflight后再次检查Git和任务，首模型请求前保存manifest/schedule。输出不得位于任何题包内，路径逐段拒绝symlink；真实输出须在忽略目录或仓库外，smoke允许dirty并记录真实HEAD/null状态。这里不创建M5题库、冻结提交或C/O机制。

审阅修复：同步复制配置/入口选项和schedule稀疏数组校验，防调用方异步修改；日志转存使用EXCL防覆盖。修正误收窄的outputDir规则，绝对目录和按projectRoot解析的相对目录均支持；smoke不再丢失已有HEAD，也不因其输出造成dirty而被误拒。真实模式拒绝将无关干净仓库的SHA记作运行中实现版本，CLI集成从临时Git中的完整代码副本执行验证。

| 实际命令/操作 | 退出码 | 结果与证据 |
| --- | --- | --- |
| `git status --short` | 0 | 保留全部已有未跟踪文件，无项目提交/推送 |
| `node --import tsx --test tests/benchmark.test.ts`（先写测试／首次实现） | 1／0 | 缺模块后实现，首次6项通过 |
| 同上（Git元数据、配置快照及未选题输出边界回归后） | 0 | 子智能体先复现回归失败，再修复，最终8项通过；其typecheck退出0 |
| `node --import tsx --test tests/schedule.test.ts`（先写测试） | 1 | schedule模块尚不存在；attempt/runner先写测试亦报告缺模块退出1 |
| `node --import tsx --test tests/attempt.test.ts tests/runner.test.ts tests/schedule.test.ts`（子智能体初次验收） | 0 | 5项通过，后由独立边界补充审阅 |
| `node --import tsx --test tests/eval-cli.test.ts`（主智能体先写测试） | 1 | CLI模块尚不存在 |
| `npm run typecheck`（中间集成） | 2 | runner文件尚未完成及测试assert.throws参数类型错误；完成模块并修正测试调用后通过 |
| `node --import tsx --test tests/eval-boundaries.test.ts`（主智能体独立回归） | 1 | 3项中2项因绝对outputDir被误拒失败，未绕过断言 |
| `node --import tsx --test tests/eval-cli.test.ts tests/eval-boundaries.test.ts`（修复后） | 0 | 7项通过，含实际smoke CLI、首请求前manifest、失败后继续、独立预算/快照、配置捕获及路径拒绝 |
| `node --import tsx --test tests/runner.test.ts`（smoke dirty与实现归属回归） | 1 | 子智能体先复现两项失败，随后修复 |
| `node --import tsx --test tests/runner.test.ts tests/eval-boundaries.test.ts tests/attempt.test.ts tests/schedule.test.ts`（子智能体最终验收） | 0 | 10项通过；typecheck退出0 |
| `node --import tsx --test tests/eval-http.test.ts`（主智能体本地假HTTP集成） | 0 | 临时clean Git、独立freeze/implementation SHA、参数覆盖、首轮429失败/次轮修复成功、dirty拒绝均通过；共4个本地请求，无真实provider |
| `npm run check`（主智能体最终验收） | 0 | typecheck及218项具名用例/子用例全部通过，0失败/取消/跳过；相对M4.2新增23项 |
| `npm run eval -- --help` | 0 | 实际入口与覆盖参数帮助可用，无API请求 |
| `npm run eval:smoke` | 0 | 创建下述本地mock运行，固定2次独立attempt |
| Python内联核对该smoke的manifest/result/产物/输出hash | 0 | 2次均passed，每次3模型请求/2工具调用，before/after/changes/journal齐全、输出SHA一致、临时工作区已清理；非完整verify |
| `rg -n 'from .*eval|import\(.*eval' src` | 1 | 无匹配，src未导入eval；此码表示无匹配 |
| Python汇总逐文件`git diff --no-index --check /dev/null <file>`及Markdown链接/围栏检查 | 0 | 本次20个文件无空白错误，覆盖未跟踪文件；更新文档的本地链接与围栏有效 |

保留的离线证据：`runs/2026-09-24T12-01-44-904Z-c105ba91-b7eb-4074-8a7d-ae37d9a17dda/`（Git忽略）。manifest记录phase=smoke、provider=mock、implementationCommit=null、dirty=true、benchmarkCommit/hash=null；初始题包未修改，该题预检及两次候选评分均基于原始资产。该结果仅验证工程流程，不是冻结题库或真实模型能力成绩。

验收边界：E01/E02覆盖多重复独立初始快照/工作区/Session/计量和hidden canary隔离；E06本阶段完成baseline单组manifest/schedule/result及明确mock标记，真实四组与report可重算尚未完成。E07覆盖全部manifest任务、suite/hash/冻结字节/提交关系、dirty和输出重叠拒绝；完整verify仍待M4.4。S02完成子集/轮换与缺usage保持null；S01/S03统计、E05验证器未实现。实际S8/H4题库与Git冻结留M5，真实baseline/报告/分析留M6，四组及C/O仍受对应门槛约束。未启动付费实验或发布远程仓库。

本工单完成时下一子工单为M4.4，结果见下。

### M4.4：汇总报告、完整verify与M4收尾（2026-09-24，DONE）

前置证据：用户明确要求一次性做到M4收尾，M4.3已通过typecheck和218项具名测试。核对README、00/02/05/07/08/09/10、AGENTS、既有事件/评测契约与Git状态，保留所有原有未跟踪文件及旧run。两个GPT-6 Sol（medium）子智能体实现journal计量复算与summary/report；主智能体实现verify、历史冻结检查、报告落盘/诊断、CLI及独立篡改回归，并完成架构审阅。计量子智能体另进行只读verify审阅。

新增eval/journal-metrics.ts、report.ts、verify.ts、finalize.ts、verify-cli.ts、preflight-cli.ts及tests/journal-metrics.test.ts、report.test.ts、verify.test.ts、eval-finalize.test.ts；更新eval/contracts.ts、check.ts、benchmark.ts、runner.ts、tests/check.test.ts、eval-http.test.ts、package.json、README、02-contracts、05-evaluator、09-acceptance、tests/fixtures/README和本进度，共23个文件。没有src策略改动、新增依赖、项目Git提交或远程操作。

交付：inspectJournal从完整journal重新计算实际派发请求/kind、工具/错误、token已知量和contextStats，对照run_end及Agent结果，检查body/config/观测关联、预算和回答；缺usage保持null，不漏辅助成本。summarize按组及S/H/总体统计严格成功率、full-baseline百分点差、请求/工具、token完整率、Agent与验收耗时、请求加权上下文、压缩次数和失败分布。纯统计测试使用明确的手工mock多组数据，不执行未实现机制。

verify只读核对manifest/schedule与精确attempt集合、同版本/配置/任务身份、原任务和before/after/changes完整性、两类测试输出原字节hash与末尾结构化结果、全部preflight材料、journal计量/主评分及summary/report重算。路径固定到本attempt，拒绝symlink或越界引用。真实证据检查历史实现/题库提交及当时manifest、全部冻结题包，不要求当前实现HEAD仍停留在旧SHA；须保留原题包路径和该版本资产。校验是内部一致性，不能证明所有本地证据从未同时重写。

runner完成矩阵后先检查底层证据，再独占写summary/report并verify；不完整时保留原attempt并只写diagnostic，不产生完整成功率表。既有报告不会被覆盖，旧M4.3运行未补写产物。新增eval:verify与eval:preflight入口；CheckResult可选durationMs记录真实验收wall time且参与输出hash，新产物有值，旧证据缺失保持unknown。

审阅修复：放宽无法从journal推导的外部取消/超时判断，避免在assistant持久化后取消被误拒；仍严格要求完整计量。修正单侧usage缺失时combined.known丢失已知部分，以及未知验收耗时sum被写成0的问题。summary独立校验合法phase矩阵、provider和评分，拒绝把两组当ablation。报告写入诊断前先检查所有父目录，独立失败测试复现并修复symlink输出写穿问题。原始评分与运行时策略不变。

| 实际命令/操作 | 退出码 | 结果与证据 |
| --- | --- | --- |
| `git status --short` | 0 | 原有未跟踪文件保留，无项目提交/推送 |
| `node --import tsx --test tests/journal-metrics.test.ts`（先写测试／最终审阅后） | 1／0 | 先缺模块，最终6项通过；真实runtime日志、缺usage、计数/长度篡改、辅助遗漏、预算/工具/overflow/timeout/cancel覆盖 |
| `node --import tsx --test tests/report.test.ts`（先写测试／最终审阅后） | 1／0 | 先缺模块，最终8项通过；25%/75%/50pp、S/H分层、失败成本、加权上下文、缺usage、未知耗时及非法矩阵/评分拒绝 |
| `node --import tsx --test tests/check.test.ts tests/verify.test.ts`（主智能体先写测试） | 1 | 新duration断言失败及verify模块不存在，原有其余check测试通过 |
| `node --import tsx --test tests/eval-finalize.test.ts`（主智能体先写测试） | 1 | 未对不完整日志拒绝出表、preflight-cli不存在，2项失败 |
| 子智能体中间typecheck | 2 | 并行模块尚未落盘及测试optional signal类型错误；修正后各自typecheck退出0 |
| `npm run typecheck`及`node --import tsx --test tests/check.test.ts tests/verify.test.ts tests/eval-finalize.test.ts tests/eval-http.test.ts`（首次集成） | 各0 | 23项具名用例/子用例通过；含14项verify总用例/子用例与本地假HTTP完整链路 |
| `node --import tsx --test tests/eval-finalize.test.ts`（symlink审阅回归） | 1 | 3项中1失败：错误诊断沿symlink写入目标；随后修复父路径检查 |
| `npm run check`（主智能体最终验收） | 0 | typecheck与249项具名用例/子用例全部通过，0失败/取消/跳过；相对M4.3新增31项 |
| `npm run eval:smoke`（最终代码的新运行） | 0 | 新runId见下，2次独立mock attempt，自动summary/report及verify成功 |
| `npm run eval:verify -- --run runs/2026-09-24T12-18-32-191Z-aaa4f30a-7d26-47e5-b02b-a9c397242b8f` | 0 | 返回passed=true、errors=[]，独立命令只读复核 |
| `npm run eval:preflight -- --help` | 0 | 新脚本入口可用；实际单题执行与坏summary的verify退出1在CLI集成中通过 |
| `rg -n 'from .*eval|import\(.*eval' src` | 1 | 无匹配，src不导入eval；不是失败 |
| Python汇总逐文件`git diff --no-index --check /dev/null <file>`、Markdown及旧run保留检查 | 0 | 本次23个文件无空白错误；文档本地链接/围栏有效，旧M4.3运行仍无补写报告 |

保留最终离线证据：`runs/2026-09-24T12-18-32-191Z-aaa4f30a-7d26-47e5-b02b-a9c397242b8f/`，含manifest、preflight、2次全部attempt、summary.json与report.md。报告明确provider=mock/phase=smoke、未提交实现与未冻结题库；两次均passed，共6次worker请求、4次工具调用，0辅助/压缩。旧`runs/2026-09-24T12-01-44-904Z-c105ba91-b7eb-4074-8a7d-ae37d9a17dda/`保持原样，无报告补写或成绩替换。运行输出由Git忽略，不能冒充真实baseline报告。

M4整体验收范围：

| 验收项 | M4结论与实际边界 |
| --- | --- |
| E01/E02 | baseline多重复独立工作区/Session/预算、初始hash一致、隐藏材料不进入请求；完整四组运行留后续机制实现 |
| E03/E04 | 保护测试与独立验收、主评分/functional区分、预检真实初始失败/reference通过、空测试/提前退出/超时拒绝均回归通过 |
| E05 | 删除失败attempt、篡改summary/report/快照/changes/测试日志/Agent计数/phase/path/taskHash/preflight及symlink均被拒；不完整journal只出诊断，verify不修复原件 |
| E06 | baseline单组完整manifest→attempt→summary/report→verify通过，mock标签明确；手工多组统计通过，四组实际模型/机制矩阵尚未执行 |
| E07 | 冻结manifest/全题包hash/suite/提交一致性、dirty启动拒绝、历史实现前进后仍可只读复核及错freeze提交拒绝通过；真实题库由M5交付 |
| S01–S03/R07 | 25%/75%差50pp、失败成本、S/H分层、子集轮换、缺usage/零请求/零压缩、请求加权context、混phase/commit拒绝通过 |

M4.1–M4.4全部DONE。B01–B03的S8/H4实际资产、十二题preflight与benchmark-v1提交仍待M5；F01–F04/S04真实baseline九项分析、索引/trace及Git里程碑仍待M6及后续。未实现C/O、未调用真实provider或启动付费实验。下一阶段M5创建并冻结实际题库；当前无需API Key或远程仓库地址。

## 初始规划静态检查（实施前记录）

规划链接、Markdown代码围栏、JSON示例、38个原有验收编号引用、S8/H4共12题、36次baseline与144次四组矩阵、共同预算/窗口一致性均已检查。没有执行运行时代码测试、题目preflight或真实模型实验。

## M6门槛补充（本次仍仅规划）

新增13-baseline-milestone，固定三个输出路径、九项分析内容、重复调用与增长统计口径、trace选择规则和假设ID。M6报告/索引/摘录须单独Git提交，progress记录其真实SHA后才可DONE；后续C/O提交与消融报告关联该证据。当前baselineAnalysisCommit不存在，M6仍NOT_STARTED，未创建任何完成报告。

本次M6规格检查通过：固定输出路径、九项必备分析、Git门槛、报告模板和工单引用一致；40个验收ID唯一且引用有效；Markdown链接/围栏与JSON可解析。这些是规划静态检查，不代表F01/F02/F04真实里程碑已通过。


### M5.1：Benchmark-S 实际资产（2026-09-24，DONE）

前置证据：用户要求完成M5；M0–M4已有249项工程测试和验收记录。先阅读README、00、06、08、09、10、13和AGENTS，确认不实施C/O、不运行付费实验。初始工程均未跟踪、没有Git提交；先以 `chore: record M0-M4 baseline harness` 保存既有工程，真实提交为 `3a508238825a9856c7cb16f20b82dd1dba0c67f0`（`git commit`退出0）。未配置或推送远程。

两个GPT-6 Sol（medium）子智能体分工创建S8，主智能体独立审阅公开需求、验收和参考补丁。每题含task.json、prompt、初始workspace、public test、外部acceptance和严格文本reference patch。先建立测试，再生成参考解答；初始源码保留真实错误，不把参考解答写回workspace。

审阅修正：b03配置合并的own `__proto__` / `constructor`键不能触发原型setter或继承字段合并；公开输入约定、增加验收并修复reference。主智能体通过Node内联脚本逐题调用 `loadTask` / `preflight`，退出0，证据 `/tmp/m5-s-review-n8i48Y/<id>/preflight.json`：S8初始acceptance均失败，reference公开/隐藏均通过。确认此前置通过后才委派M5.2。

### M5.2：Benchmark-H 实际资产（2026-09-24，DONE）

GPT-6 Sol（medium）子智能体分工实现H01/H02和H03/H04，主智能体逐题审阅。H01公开完整配置issue、优先级/false/0/安全整数/嵌套保留/旧格式；H02以有限文法实现引号和CRLF跨chunk场景及两个消费者；H03实际入口/新旧路由/注册表优先级；H04完整issue描述共享规范化与四个消费者、序列化和兼容API。

H01/H02各12个workspace文件；H03/H04各14个。无关模块有实际职责：H01标识符/缓存键/日志级别，H02slug/checksum，H03路径/查询/响应头/统计，H04日期/分页/标签展示。可写文件分别3/2/2/5个。未加入随机文本、强制回读、search/Shell/规划器或其他运行时能力。

审阅修正均发生在冻结和真实实验之前：H01统一环境变量数字语法、前导零和安全整数范围；H03公开合法records/参数名范围与同优先级顺序，补跨调用params独立性；H02增加逐字符切块与空chunk交错、doubled quote组合。H01另经第二个子智能体只读交叉审阅，未发现重要不一致。所有隐藏断言均有公开需求或已有兼容代码依据。

子智能体最终 `loadTask` / `preflight` 均退出0，reference公开/隐藏通过，初始acceptance真实失败；作者证据分别位于 `/tmp/m5-h01-preflight-C51m0U/h01-config-pipeline/`、`/tmp/m5-h02-preflight-3zTzVa/h02-chunk-parser/`、`/tmp/mini-harness-m5-h03-module-navigation-review2-20260924/`、`/tmp/mini-harness-m5-h04-issue-refactor-20260924/`。最终统一证据以下一工单为准，不依赖这些临时路径交付。

### M5.3：12题预检与manifest（2026-09-24，DONE）

全部资产完成并审阅后，以Node内联脚本按baseline配置的12个ID调用 `loadTask`，独占创建 `benchmark/v1.json`（退出0）：每题真实suite/path/taskHash，S8/H4，没有占位hash。新增三个小型离线复核脚本位于benchmark内，调用已有eval接口；未修改src、eval、依赖或实验预算。

| 实际命令/操作 | 退出码 | 证据与结论 |
| --- | --- | --- |
| `node --import tsx benchmark/preflight.mjs benchmark/evidence/preflight-v1` | 0 | 12/12预检通过；初始acceptance全部有真实断言失败，参考补丁仅改白名单，36项公开+75项隐藏测试全过 |
| Node内联审计：重算12个taskHash、60个证据文件SHA/字节数、调用48次 `inspectCheck`、检查参考补丁changedPaths | 0 | `benchmark/evidence/preflight-v1/audit.json`；原始JSON和日志由index.json相对路径索引 |
| `node --import tsx benchmark/check-extension.mjs benchmark/evidence/extension-v1` | 1 | mock attempt及verify通过；脚本误要求Markdown正文含taskHash而失败，完整首轮产物保留 |
| `node --import tsx benchmark/check-extension.mjs benchmark/evidence/extension-v2` | 0 | 修正检查为report runId→manifest/result taskHash关联；新增第13题无需改runtime即可读/改/完成并评分，两个独立mock运行均verify通过，prompt增加1字节改变hash |
| Node内联脚本独立调用两次 `verify` 并检查before快照 | 0 | extension-v2两报告均通过，模型工作区只有源码和public test，不含acceptance/reference |
| `npm run check > /tmp/mini-harness-m5-check.log 2>&1` | 0 | TypeScript与249项具名工程测试通过、0失败/跳过；输出复制至 `benchmark/evidence/engineering/npm-check.txt` |
| `node --check benchmark/preflight.mjs` / `node --check benchmark/check-extension.mjs` / `node --check benchmark/check-freeze.mjs` | 各0 | 三个离线脚本语法检查通过 |

| 题目 | workspace文件 | 可写文件 | 公开测试 | 隐藏验收 |
| --- | ---: | ---: | ---: | ---: |
| b01-normalize | 2 | 1 | 3 | 5 |
| b02-counter | 2 | 1 | 3 | 5 |
| b03-config | 2 | 1 | 3 | 8 |
| f01-tags | 2 | 1 | 3 | 5 |
| f02-pagination | 2 | 1 | 2 | 4 |
| f03-ranges | 2 | 1 | 2 | 5 |
| m01-report | 3 | 2 | 2 | 5 |
| m02-options | 4 | 3 | 2 | 4 |
| h01-config-pipeline | 12 | 3 | 4 | 10 |
| h02-chunk-parser | 12 | 2 | 5 | 9 |
| h03-module-navigation | 14 | 2 | 4 | 8 |
| h04-issue-refactor | 14 | 5 | 3 | 7 |

验收B01/B02通过。扩展检查的b13仅是证据目录内的mock fixture，不属于v1的12题，也不是新增研究任务；extension-v2目录名不是benchmark-v2。全部日志保留原始字节和绝对生成路径，索引提供相对路径/原始hash。未运行真实provider；这些通过率不能用作M6/M9成绩。上下文8192/0.75/4、模型请求16、工具24保持不变。

### M5.4：benchmark-v1 Git冻结（2026-09-24，DONE）

`git commit -m "benchmark-v1"` 退出0，完整实际任务资产、manifest、原始预检证据和离线复核脚本已提交。真实冻结提交：

- **benchmarkCommit：`9fd463f618edfe25e8a683a62b7f540f3e644f90`**
- benchmark/v1.json原始SHA-256：`d3d3321d3347017e58be60215e00a7ceb8e75fee5d4d77a2c07b0677160165a2`
- `node --import tsx benchmark/check-freeze.mjs` 退出0：干净Git、S8/H4、全部task字节/suite/hash与冻结Git tree一致，`verifyFrozenInputs`通过；错误benchmarkHash与commit被拒绝。结果记录于 `benchmark/evidence/freeze-check.json`。
- `git diff --cached --check -- . ':!benchmark/evidence/**' ':!benchmark/tasks/**/reference/*.diff'` 退出0：源码/测试/文档无空白错误；原始证据（含故意新增一字节的B02 fixture）与合法unified diff上下文空白不做格式清理。

B01/B02/B03与E07的M5验收通过；E07的错suite、任务字节变化、脏工作区拒绝也由本次249项工程检查中的既有边界测试覆盖。全程未改变src/eval实现、variants、模型提示、预算或上下文窗口。冻结后用独立文档提交记录上述真实SHA；没有amend冻结提交或原地改题。

M5整体DONE。下一步为M6真实baseline（默认12题×3次=36 attempts）；需要provider endpoint、model ID、环境变量HARNESS_API_KEY及付费实验授权后才启动。未读取密钥、未调用真实provider、未产生真实分数或baselineAnalysisCommit，M7/M8保持未开始。远程仓库地址仅在用户要求推送时需要。


### M6前置工程：DeepSeek协议适配（2026-09-24，DONE；真实实验待授权）

用户已创建 `experiments/baseline-deepseek.json` 并确认本地 `.env` Key可加载。初始 `git status --short` 仅显示该实验配置未跟踪；保留其全部原字节。主智能体解析并比较模板：仅model改变，endpoint=`https://api.deepseek.com/chat/completions`、id=`deepseek-flash`、temperature=0；12题×3次=36 attempts，预算与上下文设置不变。此轮没有加载/读取 `.env`、输出密钥或调用真实provider。

按先前提供的非思考模式接入方案完成基础协议修复：GPT-6 Sol（medium）先写4项回归测试观察失败，再修改 `src/model-protocol.ts` 和 `eval/journal-metrics.ts`；主智能体审阅并独立增加 `tests/deepseek-http.test.ts`。不新增公共配置字段/依赖/插件框架，不修改Agent策略、C/O或冻结题库。

官方endpoint匹配限定HTTPS origin `https://api.deepseek.com`及`/chat/completions`、`/v1/chat/completions`路径。该协议发送 `max_tokens` 和显式 `thinking: {type: 'disabled'}`，不发送n/max_completion_tokens；其他端点继续旧协议。共享计量层先编码再记录/发送，HTTP插件不改body。verify按端点独立检查请求字段、额度和思考模式，拒绝混用额度字段、启用/漏记thinking、额外reasoning_effort。既有普通端点的日志仍可核验。该选择已记录ADR-013，后续四组必须一致；当前不支持reasoning_content回传。

依据：[DeepSeek API参数](https://api-docs.deepseek.com/api/create-chat-completion/)、[输出额度兼容说明](https://api-docs.deepseek.com/quick_start/agent_integrations/oh_my_pi/)。官方协议说明不等于真实服务已验证；Key、余额、实际模型可用性及线上兼容性仍未通过本项目调用确认。

| 实际命令/操作 | 退出码 | 结果与证据 |
| --- | --- | --- |
| Node内联脚本 `parseEvalConfig` + 与模板除model外逐字段比较 | 0 | 用户配置合法，计划36 attempts；没有载入Key或发送请求 |
| `node --import tsx --test tests/deepseek-protocol.test.ts`（子智能体先写测试） | 1 | 实现前4项失败，暴露字段/verify不兼容 |
| 同上（实现后） | 0 | 4/4通过，含精确端点、工具消息、日志/发送一致与协议篡改拒绝 |
| `npm run typecheck` / `npm test`（子智能体首轮） | 各0 | strict检查与253项测试通过 |
| `node --import tsx --test tests/deepseek-http.test.ts`（主智能体独立验收） | 0 | 全程拦截fetch、仅临时假Key；真实HTTP插件完成读→改→final，3次请求/2次工具，wire body与日志/长度一致，usage复算和verify计量一致，Key不落日志 |
| Node内联脚本对 `benchmark/evidence/extension-v2/index.json` 的两个历史mock运行执行verify | 0 | 两份旧报告保持通过，未修改或重跑历史产物 |
| `npm run check > /tmp/mini-harness-deepseek-check.log 2>&1`（主智能体最终） | 0 | TypeScript检查与254项具名测试全部通过，0失败/跳过 |
| `git diff --check` | 0 | 当前已跟踪修改无空白错误；提交前再含新增文件核对 |

文档已提供显式Node `--env-file=.env`的正式命令；应用本身仍不自动加载.env。实现与用户实验配置已独立提交：`beaab9dbf97445edd3b3269414d6c8739433f530`（`git commit -m "fix: support DeepSeek non-thinking chat protocol"`退出0）。提交后Node内联脚本对实际配置执行 `loadEvaluationInputs`、`verifyFrozenInputs` 和 `buildSchedule`，退出0：工作树干净、冻结仍为 `9fd463f618edfe25e8a683a62b7f540f3e644f90`、12题/36 attempts，providerCalls=0。没有真实baseline run、分数、分析报告或baselineAnalysisCommit；本项DONE不表示M6完成。执行真实36次矩阵仍需用户明确付费授权。


### M6.1–M6.6：真实baseline与失败分析（2026-09-24，DONE）

前置：用户明确要求“开始M6”，授权执行已说明的12题×baseline×3次付费矩阵；凭据由Node `--env-file=.env`加载，不回显或保存密钥。M5冻结与前置254项工程检查已通过。按配置统一使用DeepSeek `deepseek-flash`、temperature=0、非思考模式、单次输出4096；预算16次模型/24次工具/120000ms/128000输入字符、窗口8192/0.75/4保持不变。真实运行开始时实现提交干净。

- baselineRunId：`2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b`；phase=`baseline-diagnostic`；provider=`http`。
- baselineImplementationCommit：`8d848c165546727585878e3b6b6613b647087781`。
- benchmarkCommit：`9fd463f618edfe25e8a683a62b7f540f3e644f90`；manifest SHA-256：`d3d3321d3347017e58be60215e00a7ceb8e75fee5d4d77a2c07b0677160165a2`。
- **baselineAnalysisCommit：`93d075b80ce15616ca019f71153935b5d3ad51cb`**（已经产生并完成F04核验；本进度在后续独立提交记录）。
- [数值报告](../reports/baseline-report.md)、[失败分析](../reports/baseline-failure-analysis.md)、[证据索引](../reports/evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/index.json)。原始`runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/`全部315个文件保留在本地，仍由Git忽略；交付可复核材料时须同时交付该目录。

GPT-6 Sol（medium）子智能体分别实现离线计量脚本、审阅原始trace与最终报告；主智能体复核口径、生成固定产物、检查哈希并完成Git门槛。没有修改运行时、评测器、模型提示、题库、配置或预算；没有重跑、删失败或增加provider调用来生成分析。原始事件保持不变。

| 实际命令/操作 | 退出码 | 结果与证据 |
| --- | --- | --- |
| `node --env-file=.env --import tsx eval/cli.ts --config experiments/baseline-deepseek.json` | 0 | 完整36次HTTP真实运行；退出0指矩阵完成，主passed为23次 |
| `npm run eval:verify -- --run runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b` | 0 | 独立复算passed=true/errors=[]；报告整理后再次执行仍通过，输出保存于evidence下verify.json |
| `node --import tsx reports/evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics.mjs runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b reports/evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics` | 0 | 36/36完成，228条请求、13条工具错误、78条回读；新目录输出，不覆盖run |
| `node reports/evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/counter.mjs runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b reports/evidence/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b/metrics` | 0 | 从原始result与tool_start独立汇总，matchingDerived=true |
| `python3 /tmp/build-m6-reports.py` | 0 | 两份报告、全部36次映射和固定3例完整区间trace生成；没有模型调用 |
| `python3 /tmp/index-m6-evidence.py` | 0 | 315个原始文件、54个派生文件逐项大小/哈希一致；3份trace事件与原journal一致；报告链接存在，凭据模式扫描无匹配 |
| `node /tmp/mini-harness-m6-analysis/audit-reports.mjs`（子智能体） | 0 | 36行摘要/重复表/原因表、13行工具错误、首改及结束seq、文件变化与链接对照通过；额外人工复核S/H/总体数字与HYP推断边界 |
| `git diff --cached --check` | 0 | 分析与证据提交无空白错误 |
| `git commit -m "m6-baseline-analysis"` | 0 | 独立产生上述真实分析SHA；仅55个reports文件，无C/O代码 |
| Python内联调用`git diff-tree`、`git cat-file -e`、`git merge-base --is-ancestor`、`git diff --exit-code <implementation> <analysis> -- src eval benchmark specs experiments` | 0 | 确认固定报告/index存在、提交仅含reports、分析为HEAD祖先、实验实现/题库/配置完全未变 |

数值：S20/24（83.33%）、H3/12（25.00%）、整体23/36（63.89%）；功能两层通过30/36，7次因tool_limit不满足主评分。228次worker尝试、226次成功响应、optimizer/summary均0；410次已派发工具、13次工具错误；输入615407/output75033 token，usage完整率100%。上下文阈值13次、可压缩条件11次，仅分布4个attempt，baseline实际压缩0。

九项分析覆盖全部成功与失败：cause none23/resource_limit9/missed_constraint4，其余枚举0；客观termination completed27/tool_limit7/model_error2分列，后者是h02两次finish=length输出额度。正常结束但隐藏验收失败4次，不能混为模型错误。重复调用和回读保留中间修改/可见输出差异；不得仅凭重复或上下文长断言浪费/遗忘。精确可写列表未显式注入worker的事实作为权限发现限制保留，未事后改题。代表trace固定为h01 r1、m01 r1及成功对照b01 r1。

F01/F02内容与真实证据验收通过；F04已在独立分析提交后通过。S04真实日志复算及重复/上下文解释已覆盖；E05/E07沿用已通过工程检查并由本次真实verify核对完整矩阵和冻结资产。本次仅分析/文档修改，未重跑此前254项工程测试，不将未运行项目记为新通过。

HYP-001（C降低长交互长度）inconclusive；HYP-002（O重述公开边界约束）supported仅表示值得检验；HYP-003（C/O直接解除固定额度）unsupported。尚未证明C/O收益。M6整体DONE；M7/M8开始前须核验上述分析提交为HEAD祖先并关联HYP，M9仍须新跑包含baseline的四组。当前未开始M7/M8/M9、未推送远程。


### M7.1：Context机制依据与前置核验（2026-09-24，DONE）

用户要求完成M7。开始时工作树干净；已阅读README、00、10、03、08/09及M6报告。`git merge-base --is-ancestor 93d075b80ce15616ca019f71153935b5d3ad51cb HEAD`退出0；固定报告及index已在该独立分析提交，F01/F02/F04在M6完成记录中通过。`npm run eval:verify -- --run runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b`本次退出0，passed=true/errors=[]。

baselineAnalysisCommit=`93d075b80ce15616ca019f71153935b5d3ad51cb`。M7主要关联HYP-001（inconclusive）：4个attempt的13次阈值/11次可压缩观测仅支持存在自然触发机会，不证明遗忘或成功率收益。HYP-003说明C不直接解除工具24/输出4096额度。按03实现同模型摘要、保留近期完整轮次与增量历史边界，summary占共享16请求；默认8192/0.75/4、题库及系统任务规则保持不变。用离线mock长历史验收工程行为，真实收益留M9；本次不启动付费实验。

本项完成后按M7.2核心→M7.3接线推进，结果见下；M8/M9未开始。

### M7.2：增量摘要核心（2026-09-24，DONE）

前置M7.1已核验。子智能体先新增C01–C03测试，`node --import tsx --test tests/context-compaction.test.ts`退出1，4项因旧插件拒绝enabled选项失败。实现后主智能体独立运行`node --import tsx --test tests/context-manager.test.ts tests/context-compaction.test.ts`退出0，11项通过；`npm run typecheck`退出0。子智能体含Session相关回归的26项聚焦检查通过；最终整体验收随M7.3接线记录。

contextManagerPlugin新增内部enabled/maxOutputTokens选项，默认关闭兼容baseline；同ModelService、每build至多一次min(512,maxOutputTokens)摘要，仅处理未压缩的旧完整轮次，保留原user/system和近期call/results。新增context_compacted严格解析及summary请求/响应引用检查；摘要落盘后推进边界，Session历史完整保留。M7.3负责开放context装配、Loop压缩计数、评测独立复算与端到端额度/失败验收。

### M7.3：context组接线、独立复算与整体验收（2026-09-24，DONE）

依赖M7.2聚焦验收通过后开始。baselineAnalysisCommit=`93d075b80ce15616ca019f71153935b5d3ad51cb`；机制关联HYP-001/HYP-003。GPT-6 Sol（medium）子智能体分别负责接线与评测复算，主智能体补独立边界/端到端测试，另一子智能体只读架构审阅。

交付：runtime/runner/attempt支持baseline/context，optimizer/full继续拒绝，phase矩阵不改；Loop订阅成功落盘的context_compacted计数并在清理时退订。eval独立核对summary固定指令/无工具/min(512,额度)、增量完整轮次边界、请求/响应引用与文本、worker投影、压缩前后指标及compactions。新增context-events与journal校验是使摘要可持久化/复核的必要支持，未改公共服务接口、Model计量层、内核或新增策略。

审阅修复：端到端测试发现attempt遗留baseline门禁；取消发生在空摘要response持久化时，必须保留cancelled而非强制model_error；同长度篡改worker system原本能躲过长度校验，现对无O的请求核对BASE_SYSTEM。没有通过弱化断言或减少验收覆盖来开放context。

| 实际命令/操作 | 退出码 | 结果与证据 |
| --- | --- | --- |
| `node --import tsx --test tests/context-runtime.test.ts`（先红） | 1 | 旧runtime拒绝context导致2项失败，baseline兼容项通过 |
| 上述接线后及runtime/runner/CLI聚焦检查 | 0 | 子智能体16项通过；未调用provider |
| `node --import tsx --test tests/context-evaluation.test.ts`（主审端到端先红） | 1 | 定位eval/attempt.ts仍拒context；修复后通过完整两组运行/报告/verify |
| `node --import tsx --test tests/attempt.test.ts`（门禁修复后） | 0 | 2项通过，context可运行、optimizer/full在物化前拒绝 |
| `node --import tsx --test tests/context-boundaries.test.ts` | 0 | 6项通过：summary前预算耗尽、摘要后worker硬超限、摘要中取消、摘要落盘后取消、摘要事件IO失败、summary输入自身硬上限 |
| `node --import tsx --test tests/context-journal.test.ts`（先红→修复） | 1→0 | 原worker完整历史断言拒绝合法双次压缩；独立边界/投影复算后通过，保留篡改拒绝 |
| 同文件worker system等长篡改回归（先红→修复） | 1→0 | 旧verify漏判；固定系统规则核对后通过 |
| `npm run typecheck`（并行接线中间检查） | 2 | 临时Message类型/可选artifact路径类型错误；显式类型与断言修复，最终检查通过 |
| `npm run typecheck && node --import tsx --test tests/context-*.test.ts tests/journal-metrics.test.ts`（主审阶段检查） | 0 | 当时36项聚焦全部通过，后续再补system公平性回归 |
| `npm ci --offline --ignore-scripts --no-audit --no-fund` | 0 | 按lock离线安装6包，未改依赖 |
| `npm run check > /tmp/mini-harness-m7-check.log 2>&1` | 0 | 审阅补system断言前typecheck与280项具名测试通过 |
| `npm run check > /tmp/mini-harness-m7-final-check.log 2>&1` | 0 | 最终typecheck与281项具名测试全部通过，0失败/跳过 |
| `npm run eval:verify -- --run runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b` | 0 | 新实现下原M6真实日志仍passed=true/errors=[]，没有重跑模型或改原始证据 |
| `node --import tsx /tmp/mini-harness-m7-smoke.mjs` | 0 | 使用测试中相同长历史mock策略，执行两组实际文件读/改/外部检查并verify，原始新run保留 |
| `node --import tsx benchmark/preflight.mjs runs/m7-preflight-2026-09-24-01` | 0 | 全12题初始验收失败/参考两层通过及完整性检查通过；新目录保存证据，不改冻结资产 |
| Python内联：Git祖先与冻结路径diff、索引315原始文件大小/SHA、src无eval依赖 | 0 | M6分析为祖先；benchmark/specs/experiments/reports未改；全部原始哈希匹配，依赖边界保持 |

保留的M7工程运行：`runs/2026-09-24T14-45-06-709Z-ca780118-d0ae-4cdc-ac8a-089ce6063025/`，phase=smoke、provider=mock、dirty=true（实现提交前检查，如实保留）。固定默认8192/0.75/4，16次模型总预算：baseline 7 worker/0 summary/0 compactions；context 7 worker+2 summary=9请求/2 compactions。两次attempt都通过功能判定及verify。这只是自建smoke夹具的工程证据；长内容仅由测试脚本生成，未加入Benchmark v1，不是C提升真实模型成绩的证据。可重复工程验收代码在tests/context-evaluation.test.ts，使用新目录避免覆盖此run。

C01/C02/C03/R07通过，E06覆盖本阶段baseline/context两组链路，四组E06留M8。readJournal新增摘要引用校验，eval另独立重建边界/投影；历史完整保留且摘要不进入Session消息。原任务/system规则不变；取消与失败保留已消耗summary请求/用量；summary失败不免费重试或退回baseline。当前固定system与完整历史通常令summary输入短于上一worker，不能制造不可达日志冒充超限正例：独立Context预载长历史测试证明硬上限，完整journal中伪造无证据overflow被拒。

M7整体验收DONE。下一步M8关联同一baselineAnalysisCommit及HYP-002实现一次需求改写；M9再执行同版本四组真实实验。没有启动新付费实验、修改M6报告或推送远程；机制提交及实际contextImplementationCommit见下方已完成的Git核验。

### M7机制提交与后续引用

- **contextImplementationCommit：`42427e9d5e6e11d37352ba19b3aa9b2dbcdc89ec`**（`feat: add incremental context summarization`）。
- 提交正文关联baselineAnalysisCommit=`93d075b80ce15616ca019f71153935b5d3ad51cb`以及HYP-001/HYP-003。`git commit -F /tmp/mini-harness-m7-commit.txt`退出0；提交前`git diff --cached --check`退出0。
- `git merge-base --is-ancestor 93d075b80ce15616ca019f71153935b5d3ad51cb 42427e9d5e6e11d37352ba19b3aa9b2dbcdc89ec`退出0；先分析后机制的历史关系成立，未amend或重写M6。
- 机制提交后的干净工作树运行`node --import tsx benchmark/check-freeze.mjs`退出0：12题S8/H4、原冻结提交`9fd463f618edfe25e8a683a62b7f540f3e644f90`与原manifest hash一致，错误hash/commit拒绝，无模型调用。
- 本条在机制提交生成后通过独立文档提交记录真实SHA；M8/M9引用上述分析与机制提交。M7 DONE，M8/M9 NOT_STARTED。


### M8.1：Optimizer依据与前置核验（2026-09-24，DONE）

用户要求完成M8；开始时工作树干净，已阅读README、00/10、03和M8工单。baselineAnalysisCommit=`93d075b80ce15616ca019f71153935b5d3ad51cb`、contextImplementationCommit=`42427e9d5e6e11d37352ba19b3aa9b2dbcdc89ec`分别执行`git merge-base --is-ancestor <SHA> HEAD`均退出0。对M6真实run `2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b`及M7 mock run `2026-09-24T14-45-06-709Z-ca780118-d0ae-4cdc-ac8a-089ce6063025`各执行`npm run eval:verify -- --run runs/<runId>`均退出0，passed=true/errors=[]。

M8关联HYP-002：m01的行乘积溢出与m02 r1异常类型遗漏对应公开约束，值得检验一次需求重述；m02另外两次baseline成功，不能宣称必须O或已证明收益。HYP-003继续限制结论：O不增加工具/输出额度。按03只对原始任务做一次简短改写，无工具、不计划/选算法/选文件/写代码/增加要求；原user与系统规则保留，建议低优先级。辅助请求使用同ModelService、计入16次共同预算，输出至多min(512,maxOutputTokens)。默认窗口/预算、题库与M6报告不变；本次只做离线工程验收，不启动M9付费实验。

M8.2已完成核心验收（见下），M8.3开始，M9 NOT_STARTED。

### M8.2：一次性Prompt Optimizer（2026-09-24，DONE）

GPT-6 Sol medium子智能体先新增6项测试，`node --import tsx --test tests/prompt-optimizer.test.ts`因模块缺失退出1；实现后同命令退出0（6/6），`npm run typecheck`及`git diff --check`退出0。主审再次运行聚焦测试与typecheck均退出0。插件通过model服务发送唯一optimizer请求，只带原user、固定OPTIMIZER_SYSTEM和空tools，输出上限min(512,配置额度)。空白/工具调用/非法finish显式失败，无重试；ModelCallError原样保留。并发、重复调用、取消、dispose等待及非法参数已覆盖。未改变公共接口或Context策略。


### M8.3：四组装配、共同计量与离线验收（2026-09-24，DONE）

GPT-6 Sol medium子智能体分别负责runtime/eval接线与journal复算，另一子智能体独立只读审阅；主智能体补充跨层边界、默认窗口四组S/H重复矩阵、审阅修复并验收。runtime按specs/variants.json仅在optimizer/full注册O；runner/attempt/CLI移除阶段性实现门禁，原phase矩阵、权限、工具、模型和共同预算不变。Loop只新增现有SUGGESTION_LABEL导出，不新增策略或组分支。eval复核唯一O请求的精确body、原任务、空tools、cap、响应到每个worker system的对应关系，以及失败/预算/取消的终止证据。full压缩后仍保留原user和低优先级建议。

审阅修复两项：1）合法O成功后首worker输入硬超限只有observation，没有worker请求，旧收尾检查误拒；2）只信观测长度会接受“短建议+伪造巨大观测”的超限日志。第二项先由独立审阅用真实日志副本复现，再补回归，现使用原task、固定system/建议及五工具schema重编码核对六项metrics和真正超限。file-tools仅抽出同一份schema供注册与复核，JSON序列与ToolsService严格相等、返回副本；未改工具行为或公共服务接口。

| 实际命令/操作 | 退出码 | 结果与证据 |
| --- | --- | --- |
| `node --import tsx --test tests/optimizer-runtime.test.ts tests/attempt.test.ts tests/runner.test.ts tests/eval-cli.test.ts tests/runtime.test.ts`（接线前→后） | 1→0 | 缺SUGGESTION_LABEL导出/旧门禁先失败；接线后18项通过，随后另加四组runner案例通过 |
| `node --import tsx --test tests/optimizer-boundaries.test.ts`（主审先红） | 1 | 8项均被旧runtime门禁拒绝；接线后7/8，发现合法首worker overflow误拒 |
| 同上（修复后，包含于最终检查） | 0 | 8/8：最后一次额度、O输入超限0派发、建议导致worker超限、缺usage、工具调用、响应落盘取消、IO失败、dispose等待 |
| `node --import tsx --test tests/optimizer-journal.test.ts`（先红→修复） | 1→0 | 旧cap/超限证明拒绝合法日志；独立审阅补伪造超限回归先Missing expected exception，再重编码拒绝篡改 |
| `node --import tsx --test tests/file-tools.test.ts`（先红→抽取schema后） | 1→0 | 导出缺失先失败；6/6通过，schema JSON序列与实际注册一致且副本隔离 |
| `npm run typecheck`（并行开发中间检查） | 2 | 新测试usage:null类型及窄化的termination联合类型不符，修正为字段null及RunResult显式类型；未绕过类型检查 |
| `npm run typecheck && node --import tsx --test tests/optimizer-*.test.ts tests/prompt-optimizer.test.ts` | 0 | 当时24项通过；之后增加伪造超限回归也通过 |
| `node --import tsx --test tests/optimizer-evaluation.test.ts` | 0 | 默认8192/0.75/4，S/H两夹具×四组×2次，16次真实文件操作/外部验收/报告/verify通过，provider=mock |
| `npm ci --offline --ignore-scripts --no-audit --no-fund` | 0 | 从lock离线安装6包，依赖未改 |
| `npm run check > /tmp/mini-harness-m8-final-check.log 2>&1` | 0 | 最终typecheck及307项具名测试通过，0失败/跳过 |
| `npm run eval:verify -- --run runs/2026-09-24T13-25-30-131Z-e441166e-f602-430b-a3f8-c14c091d777b` | 0 | 原M6真实baseline passed=true/errors=[]，未重新调用模型 |
| `npm run eval:verify -- --run runs/2026-09-24T14-45-06-709Z-ca780118-d0ae-4cdc-ac8a-089ce6063025` | 0 | 原M7 mock passed=true/errors=[] |
| `node --import tsx /tmp/mini-harness-m8-smoke.mjs` | 0 | 使用tests/optimizer-fixture.ts保留四组S/H重复运行，16次功能验收及verify均通过 |
| `node --import tsx benchmark/preflight.mjs runs/m8-preflight-2026-09-24-01` | 0 | 全12题初始验收失败/参考两层通过及完整性检查通过 |
| Python内联：Git祖先、冻结路径diff、manifest SHA | 0 | M6/M7提交为HEAD祖先；benchmark/specs/experiments/reports未改；原manifest hash保持d3d3321d3347017e58be60215e00a7ceb8e75fee5d4d77a2c07b0677160165a2 |
| Python内联：原始证据索引大小/hash与src依赖检查 | 1→0 | 初次脚本误用size字段失败；改为索引实际sizeBytes后315个原始文件大小/SHA全部匹配，src无eval依赖 |
| `git diff --check` | 0 | 无空白错误 |

保留的M8工程run：`runs/m8-engineering-2026-09-24-01/runs/2026-09-24T14-58-58-214Z-e589e9d6-48ed-428d-bc0a-ba1cd64ad16a/`，phase=smoke、provider=mock、dirty=true（实现提交前如实记录），夹具也保留在其上级tasks。固定默认窗口、16次总模型/24次工具预算。S每次3 worker，各组均0 compactions，O组额外1 optimizer；H每次7 worker，context/full额外2 summary及2 compactions，optimizer/full额外1 optimizer，因此H总请求baseline/context/optimizer/full分别7/9/8/10。full与baseline功能评分相同，这是工程预期，不是O有效或无效的真实实验结论。合成长历史仅存在测试夹具，未进入Benchmark v1。

验收O01/O02、E06四组mock、S01/S02/S03通过：报告既有固定25%/75%对照、失败样本、未知用量、S/H分层与跨phase/commit混样拒绝均在307项全量检查中。M8 DONE；M9 NOT_STARTED，真实四组144次必须新run重新跑包括baseline在内全部组。未读取/打印密钥，未启动付费实验或推送远程。真实optimizerImplementationCommit将在机制提交生成后另行记录，不回写M6分析。
