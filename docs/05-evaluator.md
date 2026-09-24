# 05 可实现的最小评测系统

当前M4已完成：任务加载、独立副本、快照/changes、外部judge/preflight、baseline runner/CLI、逐次证据、report及只读verify均已实现。已有离线夹具不属于冻结题库，具体证据见[进度](progress.md)。

## 输入与流程

实验配置选择taskIds、variants、repeats、model、budget、context，默认串行。可以只选baseline/full，也可跑全部四组。运行开始生成唯一runId，保存实际配置、实现commit与dirty标记、Node版本、任务哈希和顺序；普通smoke不要求clean commit或研究预注册；M5题库必须真实Git冻结，M6/M9真实实验记录干净的实现commit和benchmarkCommit。

```text
load + validate → preflight → 生成schedule
→ 每次独立workspace/runtime → Agent运行 → dispose
→ 变更检查 → 外部public/acceptance测试 → result.json
→ inspectRun证据检查 → summary.json + report.md → verify
```

一次attempt = 一个任务×一个组×一次重复。每次全新Context、Session、预算计数器和临时目录，无跨组记忆或文件复用。runtime只接收公开prompt、workspace、writable和统一配置，不接收整个Task对象。

## 任务包与preflight

```text
<id>/task.json
     prompt.md
     workspace/subject.mjs
     workspace/public.test.mjs
     acceptance/acceptance.test.mjs
     reference/patch.diff
```

publicTest对Agent可读但受保护，独立acceptance和reference不复制进Agent工作区。独立验收只测试公开需求，不加秘密功能要求；随仓库发布不等于对训练语料保密。

preflight逐题检查：结构/路径有效、初始acceptance失败、参考补丁只改writable、参考版本public和acceptance全通过、初始受保护文件未变。初始public可过或败，记录结果。失败任务不得进入矩阵。参考补丁只用于preflight，不给模型答案。实现采用严格文本unified diff子集，精确匹配上下文，拒绝越权、rename/binary/权限变更等不支持格式；支持范围见[契约](02-contracts.md)。首版不要求mutant覆盖或单独regression套件，验收测试中包含原有行为回归断言即可。

## 成功与失败

`passed = agent.termination === completed && integrity.passed && publicTest.passed && acceptanceTest.passed`。

completed不是模型自述成功；预算结束但代码通过也不算主成功，可附记functionalPass。Integrity比较before/after，任何非writable文件新增/删除/改动或symlink均失败。测试内容以原始资产为准，不信任候选工作区中的改写。

Agent结束后，在全新检查副本中复制candidate的允许修改，原始保护文件和验收文件由评测器注入；acceptance固定映射到检查副本根的acceptance.test.mjs，任务作者据此写相对import。检查副本不得与Agent并发访问。

测试通过要求正常退出、结构化完成报告、至少1项通过且无失败；超时/提前退出/语法错/缺结束报告均失败。记录public和acceptance各自输出和退出状态。先审计再执行，即使越界也可在干净副本诊断功能，但主passed保持false。

CLI使用`npm run eval -- --config <file> [--tasks id,id] [--variants baseline] [--repeats n]`，当前仅baseline开放；`npm run eval:smoke -- [--output <dir>]`执行固定离线夹具。真实模式从执行中runner所属的Git项目根启动，输出可为绝对路径或相对项目根路径，必须位于Git忽略目录或仓库外。manifest的benchmarkCommit来自最后修改题库manifest的祖先提交，并逐文件核对冻结内容；所有manifest任务均检查，只有选中任务运行preflight和矩阵。

配置、preflight或目录创建失败：停止runner并报错。attempt开始后的模型/预算/工具问题：保留失败，继续后续attempt。无自动retry，不拿重跑成功替换首次失败。用户重新运行生成新runId；首版不实现中断续跑。

## 产物

```text
runs/<run-id>/manifest.json       实际配置、版本、任务哈希、schedule
              preflight/<task>/  初始/reference检查与preflight.json
              error.json         仅异常停止时的脱敏阶段/错误码
              attempts/<task>-<variant>-<repeat>/
                journal.jsonl
                result.json
                changes.json
                before.json / after.json
                public-output.txt / acceptance-output.txt
              summary.json       完整且可复算的统计
              report.md          S/H/总体及成本、上下文、失败
              diagnostic.json    证据不完整时输出，替代主表
              diagnostic.md
```

before/after列出文件path/hash/文本内容；文件按路径排序，hash使用SHA-256。journal含真实请求/响应/工具及辅助调用；changes保留修改前后。result包含判定、计数和产物引用。配置、任务文字和源码快照可据此追溯；不要求每个插件单独计算图hash。

HTTP key/header不落盘；错误仅记状态码与脱敏信息。供应商用量缺失明确标注，不能以0隐藏缺失。

## verify

按manifest的schedule检查attempt无缺失/重复且taskHash/variant一致；核对journal的请求种类、用量、工具计数；根据termination/integrity/test结果重算passed；由逐次结果重算summary。校验before/after与changes一致，任务和输出文件hash一致。

删掉失败attempt、修改summary成功数、漏记optimizer/summary调用必须使verify失败。日志incomplete只生成诊断，不输出看似完整的比较主表。verify不调用模型或重跑测试，也不将测试结果反馈Agent。命令为`npm run eval:verify -- --run runs/<runId>`；单题预检命令为`npm run eval:preflight -- --task <task-dir> --output <new-dir>`。

报告统计见02-contracts：包含失败/辅助成本、请求加权上下文、缺usage完整率以及独立验收wall time。旧check缺duration时显示unknown，不能补0。最终写报告前先inspectRun；若日志incomplete或其他证据不符，仅保留diagnostic和原attempt，不生成成功率表。四组手工统计不代表四组机制已实现。

首版重点是可追溯和内部一致，不声称能证明产物从未被整体重写，也不建立复杂证据归档平台。只读复核历史运行允许当前实现HEAD继续前进，但要求原题包路径、manifest和冻结题目字节仍可用；移动或删除原资产需要恢复原路径/版本后再验收。

## 冻结与阶段产物

M5生成benchmark/v1.json并提交任务资产、预检证据；M6/M9启动前核对冻结manifest及全部taskHash。task新增suite=S/H，report必须分层。M6产出reports/baseline-report.md和reports/baseline-failure-analysis.md（模板在experiments），上下文指标从journal逐请求计算。M9用最终代码重跑baseline及其他三组，phase写ablation；M6 phase=baseline-diagnostic，不能混入M9主表。

真实实验实现工作树须clean（忽略的runs产物不计），模型配置保存到manifest；工程smoke可以dirty并明确标记。修任务产生benchmark-v2并先跑新baseline；修改实现只需新commit/runId，但最终比较各组同一commit。verify同时校验suite、上下文指标汇总、benchmarkHash与任务字节，拒绝与冻结v1不符的运行。

M6正式验收按[13](13-baseline-milestone.md)：eval后处理输出逐attempt的重复调用、worker轮数与token/context增长表，报告包含分类和假设的证据引用。原始runs目录保留，Git跟踪两份报告、reports/evidence/<baseline-run>/index.json及代表trace摘录。index记录原始产物路径/大小/SHA-256，verify核对索引和摘录事件来源；Git提交完成证据门槛另由F04检查，不让runner自动提交或改写Git历史。
