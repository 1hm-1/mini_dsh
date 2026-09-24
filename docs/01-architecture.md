# 01 接近 mini-dsh 的最小插件架构

## 未来目录

```text
src/
  plugin.ts              MiniPlugin与Disposer
  context.ts             use/provide/get/has/dispose
  service-registry.ts    服务注册、重复检查与移除
  plugin-registry.ts     按给定顺序加载、依赖检查、逆序清理
  runtime.ts             createRuntime：只装配插件
  config.ts              配置解析、预算验证、variant映射
  cli.ts                 参数、调用runtime、打印结果、finally清理
  services/              model/tools/permissions/session/persistence/events
                         context-manager/prompt-optimizer/agent-loop
  plugins/
    http-model.ts mock-model.ts
    permissions.ts tools.ts file-tools.ts
    memory-session.ts jsonl-persistence.ts events.ts
    context-manager.ts prompt-optimizer.ts agent-loop.ts
  accounting.ts          所有模型请求共用的预算与用量包装器
  types.ts               请求、结果、事件等共享数据类型
eval/
  task.ts                任务协议、加载与校验
  workspace.ts           副本、快照、改动记录
  judge.ts               外部测试进程与受保护文件核对
  preflight.ts           初始/参考验证
  run.ts                 配对顺序、逐次运行、产物
  report.ts              纯统计和Markdown/JSON报告
  verify.ts              逐次证据与汇总核对
benchmark/tasks/<id>/    S/H任务：task.json、prompt、workspace、acceptance、reference
benchmark/v1.json        M5实际冻结后生成：任务路径、suite、hash
specs/                   当前规划中的JSON示例
experiments/             运行配置示例；后续可选研究模板
runs/<run-id>/           原始产物，可gitignore但必须保留
reports/                M6两报告/M9消融报告及证据索引、代表trace，Git跟踪
tests/                   对应模块测试
```

评测器是普通TypeScript模块，调用createRuntime，每次创建独立Context；无需给grader、reporter再建插件系统。CLI/runtime装配层也是普通入口；业务能力通过插件提供。纯统计、哈希等函数不强制插件化。

## 依赖方向

`CLI/eval → runtime装配 → plugins → services接口`；插件使用MiniContext；内核不能import业务插件，src不能import eval/benchmark。Loop只通过服务调用模型、工具、Session、Context和Optimizer，不直接请求HTTP或访问文件。

ModelService通过accounting包装后注册给消费者，worker、optimizer、summary均走同一入口，因此不能漏记辅助调用。包装器是模型插件内部公共辅助实现，不另建服务平台。

## 固定加载顺序

1. events、jsonl-persistence、memory-session。
2. permissions、tools、file-tools。
3. http-model或mock-model（二选一）。
4. context-manager、可选prompt-optimizer。
5. agent-loop。

依赖服务未提供就直接报错，不自动拓扑排序、不等待服务出现。runtime持有非敏感run配置和accounting实例。加载失败清理已成功加载插件。完整依赖表见11。

## 组别装配

- baseline：context-manager配置enabled=false；不挂载prompt-optimizer。
- context：enabled=true；不挂载prompt-optimizer。
- optimizer：enabled=false；挂载prompt-optimizer。
- full：enabled=true；挂载prompt-optimizer。

Loop不判断组名。它通过可选Optimizer服务完成一次任务改写，再总是调用ContextManager.build。组别→配置由specs/variants.json统一生成，实际插件名、配置和模型参数写入run manifest。无需profile继承、动态patch和插件图hash。

## 扩展的正确方式

新增模型：实现ModelService并换装模型插件。新增工具：插件向ToolsService注册schema和execute，返回清理函数。换持久化：替换Persistence provider。换循环：换AgentLoop插件。验证这些替换不要求改消费方源码即可证明插件架构成立。

## 实现顺序限制

这里列出最终架构，不表示C/O先于Benchmark实现。M3只有完整投影；M5固定S8/H4全部资产；M6得到真实baseline证据；M7开启摘要；M8接入Optimizer。详见08。
