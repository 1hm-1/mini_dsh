# 06 Benchmark v1：8道基础题 + 4道Harness场景题

任务仍为可信、自建、零第三方依赖的.mjs/node:test项目；运行时不增加搜索/Shell/规划器。题目规格现在确定，实际资产必须在M5完整创建、preflight并提交冻结，早于M6 baseline与M7/M8机制实现。

## Benchmark-S：基础与功能层

保留原8题，通常1–5个文件、1–3个可写文件，用于工具/循环/评测回归和基础Coding能力；不单靠这些题证明Context Manager有效。

| ID | 类型 | 公开需求 | 验收重点 |
| --- | --- | --- | --- |
| b01-normalize | bug-fix | 去首尾空白、合并内部空白、小写 | 空串、制表符、多处空白 |
| b02-counter | bug-fix | 计数器实例互不影响 | 初值、增减、隔离 |
| b03-config | bug-fix | 两层合并、不改输入/defaults | 部分覆盖、连续调用、保留字段 |
| f01-tags | feature | 拆分/规范化标签，稳定去重 | 空项、重复、大小写、顺序 |
| f02-pagination | feature | 页码从1开始，页数据/总页数/下一页 | 空数组、末页、越界、不改输入 |
| f03-ranges | feature | 合并重叠/相接整数闭区间 | 空列表、包含、相接、分离、乱序 |
| m01-report | multi-file | parser到report的数据转换与汇总 | CRLF、空行、重复SKU、字段约束 |
| m02-options | multi-file | 新配置项贯通defaults/resolver/formatter | 默认、覆盖、兼容旧调用、新字段 |

## Benchmark-H：Harness场景层

仅增加4题，不回到大型研究题库。每题8–20个有实际含义的文件，含2–5个合理但与本次修复无关的模块；修改目标通常2–5文件。公开测试至少3项，acceptance至少6项，覆盖长约束与旧行为。

| ID | 内容与文件结构 | 必须公开的约束 | 验收重点 |
| --- | --- | --- | --- |
| h01-config-pipeline | defaults、环境映射、合并器、校验器、formatter及旧适配层（10–14文件）；修复配置覆盖跨模块不一致 | defaults<file<env优先级；false/0保留；深层字段不丢；输入不变；旧输出格式兼容 | 全链路优先级、类型转换、嵌套覆盖、跨调用隔离、兼容 |
| h02-chunk-parser | tokenizer、状态机、escape/line处理、assembler与两个消费者（8–12文件）；修复分块记录解析 | chunk边界任意；引号内分隔符和换行；转义引号；CRLF可拆块；坏记录错误语义；消费者一致 | 多分块组合、状态延续、错误传播、两消费者回归 |
| h03-module-navigation | 新旧路由/规则模块、注册表、入口与测试fixture（12–18文件）；定位真实调用链并修复规则优先级 | 明确入口行为；静态优先于动态；fallback最后；旧导出保留；不要改不相关adapter | 实际入口、新旧API、优先级、无关功能不变；旧模块自然存在但不藏指令 |
| h04-issue-refactor | 共享normalize函数和多个consumer及序列化层（10–16文件）；较长issue描述要求跨文件统一规范化 | 稳定顺序、大小写、空值语义、输入不变、旧API兼容、错误形式；约束分别出现在背景/例子/兼容说明 | 所有consumer一致、边界不丢、原行为；需求完整且无故意歧义 |

H01/H04给完整issue式长描述，把边界放在正常的背景、示例和兼容段落中，为Optimizer提供真实可整理的约束；不能靠故意模糊、隐藏需求或删去baseline信息制造差异。H02/H03的实际源码关联用于观察导航/回读和历史增长，不加入随机填充文本或强迫多余操作。

希望观察到多轮读取、信息回看和上下文增长，但**8–20文件不保证6–15轮，更不保证压缩触发**。轮数不是任务通过条件，不要求模型浪费动作。Tools仍仅list/read/edit/write/delete，没有search命令；可用list/read定位。单次可见输出限额四组相同，不为H题取消截断。

## M5必须冻结的资产

每题具备prompt.md、workspace源文件、public tests、acceptance tests、reference patch、TaskSpec及suite标签。S公开至少2项、acceptance至少4项；H见上。验收只能覆盖公开需求，含回归，不提供模型看不到的新规则。

作者流程：需求→源码→公开测试→独立验收→参考补丁→preflight全题。要求初始acceptance失败、reference公开/独立验收全过、补丁不越界；记录原始hash。benchmark/v1.json收录12题路径、suite、taskHash；Git提交说明benchmark-v1，记录完整SHA。

这个提交发生在真实baseline之前；当前仅规划，不能把占位文件或文档提交叫已冻结Benchmark。两个文件夹副本保持同步不替代Git冻结。

## 诊断、饱和与版本

M6按S/H分表记录真实worker上下文长度、达到阈值的请求数、可压缩旧轮次、成功率和失败。默认窗口8192、比例0.75、keepRecentRounds=4不变。没有压力或失败也是结果，不降低窗口或追加噪音来得到优势。

如果H仍完全饱和/没有任何可压缩上下文，v1对该能力识别不足：可以保留v1作为负结果，在新benchmark-v2提出更自然的任务并重新先跑baseline；不能原地替换H题或假装v2是未见保留集。不能保证“改Benchmark”就自动消除选题偏差；凡根据baseline调题都要记录为探索性过程。

主结果S/H分开报告，总体仅附加，避免8道容易题掩盖H上的差异。没有独立保留集，本项目仍是探索性小样本，不称盲测或普遍工程能力证明。真实仓库、容器与高级统计继续留后续。
