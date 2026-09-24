# 未决问题

规划选择已明确：小型插件架构、C/O四组、S8/H4、先冻结题库和真实baseline证据再实现机制。当前无待决定的接口问题，已解决记录见下。

M5实际任务资产和Git冻结已完成。用户“开始M6”后已完成36次真实baseline及失败分析，verify通过，baselineAnalysisCommit为`93d075b80ce15616ca019f71153935b5d3ad51cb`。当前无阻断M6的待决问题，M7尚未开始；实际证据见progress。

若真实baseline无失败/无上下文压力，按06/07记录证据不足；可保持v1做负结果，若改题则建v2重做baseline，不悄悄调小窗口。

公共歧义记录工单、位置、最小案例、建议和受影响部分；不把可选平台扩展变成必做。

## Q-M1.2-01：Session事件序号归属（用户已决定）

- 位置：02-contracts的SessionService.append(message)/record(event)，src/services/index.ts。
- 最小案例：append(user)内部写入message事件后，调用者需要record(request)，但既有接口既要求完整Event.seq，也没有暴露下一序号；后续append与record交错时容易冲突。
- 建议：Session统一生成schemaVersion/seq/elapsedMs，record接收{type,data}并返回Promise<Event>；append沿用Promise<void>，二者共享写入序列。Persistence仍接收完整Event；返回事件便于M3引用context_observation序号。
- 备选：保留record(Event)，为调用者增加读取下一序号的接口，调用者继续负责时间与序列协调。
- 影响：Session公共服务契约、本阶段Session实现/测试、M3事件生产方。Events、JSONL persistence与只读完整Event解析可独立实现。
- 状态：用户于2026-09-24明确选择“Session统一编号并返回Event”，采用建议方案。后续调用者不得自己填入seq/elapsedMs；观察序号引用使用record返回的完整事件。

## Q-M3.1-01：请求输入指标与计量层生成指标（用户已决定）

- 位置：src/types.ts的ModelRequest.contextMetrics及02-contracts的ContextProjection/计量说明。
- 最小案例：ContextManager只产出五项投影指标，但ModelRequest要求完整WorkerContextMetrics；requestChars须先编码body、observationSeq须先Session.record才存在。调用前要求完整值会迫使调用者填占位值。
- 建议：ModelRequest.contextMetrics改为Omit<WorkerContextMetrics, 'requestChars' | 'observationSeq'>；计量层编码body后生成requestChars，保存context_observation并使用返回Event.seq关联请求。完整WorkerContextMetrics和报告指标不变。
- 备选：保留原类型，让调用方传占位值，计量层仍覆盖两字段。
- 影响：ModelRequest输入类型、M3.1包装器、M3.2 ContextManager到模型的调用。HTTP编解码和独立计量逻辑可先实现。
- 状态：用户于2026-09-24明确选择“调整输入类型，由计量层补齐”，按建议修改ModelRequest.contextMetrics；完整观测与报告类型不变。
