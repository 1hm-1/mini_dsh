# 03 共享循环与两个可选能力

## 循环

1. runtime装配并校验配置，创建含共同deadline的Accounting；Loop.run写run_start与原始user任务。
2. 有PromptOptimizerService时调用一次optimize，结果作为“任务表述建议”system段；原始user任务保留，系统规则优先。
3. 调用ContextManager.build取得system/messages/tools。
4. 经共享ModelService请求worker，统一记录和计量。
5. 无calls且finish=stop：保存assistant，返回completed。不自动验证最终回答。
6. 有calls：保存assistant，按返回顺序串行执行；每次先检查工具预算，再记录开始、执行与结果，回到步骤3。
7. 预算、超时、取消或模型错误返回明确termination，由Loop保存唯一run_end；已知持久化失败不再尝试写结束事件。Runtime.run在finally逆序关闭插件；独立使用Loop的调用方负责同样的清理。

Loop不判断variant；仅检查可选Optimizer服务。M8已开放四组：baseline完整投影，context按下述策略摘要，optimizer仅加一次需求重述，full组合两者。Session始终保留完整历史。baseline可以正常读、写、修正错误和迭代。

## 共同计量

ModelService包装器先检查signal、deadline、请求额度、输入JSON长度，再预留一次请求。已发起HTTP无论成功失败均计数，按worker/optimizer/summary分项。HTTP headers/body读取均受signal控制，辅助调用不得直连fetch绕过包装器。

工具参数校验前计数，因此非法参数/越权也占额度。多个calls超过剩余额度，只执行允许的前缀，其余标未执行并tool_limit终止，不再向模型发不完整工具轮次。

无自动retry。usage缺失记null并单列已知token。durationMs包含optimizer/summary，验收耗时另记。输入请求体超过maxInputChars则context_overflow，各组同限制。

## Prompt Optimizer（O）

仅一次简短需求改写：保留原意、澄清目标和已有约束；不选文件/算法、不写代码、不制定详细计划、不增加需求。只输入原始任务，无工具，输出最多min(512,maxOutputTokens)。指令固定写入插件并纳入实现版本。

原始任务不替换。空输出、tool calls、模型错误显式终止，不静默退回baseline。一次优化调用及token/时间计入共同预算。

## Context Manager（C）

接近mini-dsh：用相同模型摘要早期历史，保留近期完整轮次；不采用旧草案的纯裁剪方案。

1. 基础投影为共享system、可选优化段、原始user任务、当前摘要、尚未摘要的历史。原任务与优化段永远保留。
2. 估算tokens=ceil(JSON.stringify({system,messages,tools}).length/4)。只是粗估，不能替代API usage。
3. enabled=false保留完整历史；enabled=true且低于窗口×triggerRatio则原样发送当前投影。
4. 达阈值时，把assistant及其全部tool results作为完整轮次，保留最近keepRecentRounds轮。不能切开call/result。
5. 有可压缩旧轮次才请求summary，输入“前一摘要+新待摘要完整轮次”；输出上限min(512,maxOutputTokens)。要求仅总结已有事实、改动、错误、待办，不声称未执行测试通过。
6. 得到合法文本后，提交新摘要、历史边界，记录context_compacted。下次只摘要边界后的新增旧轮次，不能反复处理同一范围。
7. 每次build最多一次summary；摘要请求不触发递归压缩。全部历史与辅助请求仍留在日志，但summary请求不进入worker聊天历史。
8. 重建worker请求，仍超过硬上限就context_overflow。无旧轮次可摘要时不发空请求。summary请求本身也受同一maxInputChars上限，不悄悄截断。

工具输出的通用限制对四组相同。compactions仅计成功更新摘要，不计阈值检查。小题未触发压缩就记录0，不为full获胜缩小baseline窗口。

## 日志与异常

实际请求投影可从日志核对。Session写失败停止后续动作，返回io_error，不伪造run_end已落盘。普通工具错误可反馈继续，取消/超时不可降级成普通工具错误。已成功写入的文件保留在证据中。

v1只读回放：核对事件顺序、call/result、计数和结束记录。末行损坏或缺run_end标incomplete，不自动恢复执行或覆盖日志。

## 在baseline阶段就记录长度

M3的完整投影已计算02定义的contextMetrics，包括估算输入长度、当前完整轮次和潜在压缩条件；只记录，不调用summary。M6据此诊断，而不是等C实现后才补测baseline。C已在M7按既定算法实现，O已在M8实现一次需求重述；候选能力收益仍待M9。模型长度不足以推断遗忘，分析引用具体行为和验收证据。

ContextManager提供五项投影指标；模型计量包装器在每次worker投影的硬上限检查前写context_observation事件，保存02定义的长度/轮次/阈值字段；即使context_overflow导致没有HTTP请求，诊断也可看到被拒请求的长度。RunResult.contextStats只汇总实际发出的worker请求，拒绝请求作为独立失败证据，避免混淆分母。
