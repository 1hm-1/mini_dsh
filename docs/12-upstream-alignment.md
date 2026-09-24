# 12 与mini-dsh、DeepSeek Harness的关系

参考 [DeepSeek官方仓库](https://github.com/deepseek-ai/deepseek-harness) 与 [官方架构说明](https://deepseek-harness.github.io/deepseek-harness/en/reference/)，以及本地mini-dsh的插件/服务实现。上游资料于2026-09-24核对；本次仅收敛自己的规划，不新增上游兼容性承诺。

遵循的原则：产品能力作为插件提供；服务接口和provider分开；Agent Loop自身可替换；完整Session和模型Context投影分离；注册能力随清理释放。mini自写小型内核，不依赖或兼容Cordis，不复刻上游所有扩展点。

| 方面 | 本版与mini-dsh的关系 |
| --- | --- |
| 插件内核 | 接近：Context、服务注册、依赖检查、逆序清理 |
| Model/Tools/Permission/Session/Loop | 相同职责划分，独立编写实现 |
| Context Manager | 同类思路：估算长度、模型摘要、近期消息保留 |
| Prompt Optimizer | 同类思路：任务前简洁改写，不变成规划器 |
| 四组消融 | baseline/context/optimizer/full，因素定义对齐 |
| 评测重点 | 新实现统一任务协议、预算计量、独立验收、完整结果核对 |
| 工具范围 | 对齐文件工具评测；不要求首版实现原项目所有Shell/交互CLI能力 |
| 额外平台能力 | 不增加热替换、复杂profile、评测插件系统 |

本版可以称“架构思想与主要功能仿照mini-dsh，从零实现并优先设计评测”。不能称完全复刻DeepSeek Harness，也不能把mini-dsh结果当新项目成绩。

只有实际实现通过09验收后才能说已实现插件化；当前交付仍是规划。

最新修订仅调整评测证据顺序与任务结构：S8/H4题库在增强机制之前固定，先取得baseline报告，再实现C/O，最后2×2消融。相较mini-dsh不新增runtime研究因素或平台；这套先后流程是本项目决定，不归为上游已经采用的实验方法。
