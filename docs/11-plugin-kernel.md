# 11 小型插件内核

保留mini-dsh级别的插件/服务划分，不做Cordis兼容层、复杂作用域系统或动态依赖图。

M1.1已实现src/context.ts的Context、src/service-registry.ts的泛型ServiceRegistry及src/plugin-registry.ts的PluginRegistry。测试见tests/kernel.test.ts和tests/kernel-boundaries.test.ts；当前仅覆盖内核行为，实际Session/Tools/Loop的集成验收随后续工单完成。

## API

```ts
type Disposer = () => void | Promise<void>;
interface MiniPlugin {
  name: string;
  dependencies?: string[];
  setup(ctx: MiniContext): void | Disposer | Promise<void | Disposer>;
}
interface MiniContext {
  use(plugin: MiniPlugin): Promise<void>;
  provide<K extends keyof ServiceMap>(name: K, service: ServiceMap[K]): Disposer;
  get<K extends keyof ServiceMap>(name: K): ServiceMap[K];
  has(name: string): boolean;
  dispose(): Promise<void>;
}
```

ServiceMap在服务契约层定义，内核用泛型注册表，不import具体模型/Agent策略。get缺失和provide重复均报错。provide返回移除该注册的函数，由插件disposer调用。

按runtime给定顺序await use，不自动拓扑排序。先校验名字唯一、dependencies全部存在，再setup。setup只初始化/注册，不请求模型或启动Agent。成功保存disposer；失败清理此前成功插件并中止启动。

setup内若已产生副作用后失败，该插件用try/catch释放自己资源；不实现内核事务。dispose按加载逆序执行，单个cleanup抛错仍清理其他，最后报告首个错误；幂等调用不能重复清理。运行结束或先取消并等待run settle后才能dispose，首版无运行中热卸载。

加载校验或setup失败均中止该Context，并等待此前成功插件清理；若清理也失败，对调用者保留原始启动错误。正常dispose在全部清理后抛出遇到的首个清理错误，包括非Error抛出值。清理进行中的重复dispose等待同一次清理；结束后再次dispose不重复执行或重抛历史错误。

关闭状态在调用任何插件清理函数前生效，此后use/provide拒绝。清理期间get/has仍可访问尚未移除的上游服务，全部清理后清空注册表；清空注册表不替代插件释放文件句柄等外部资源。移除函数绑定单次注册身份，旧disposer不能删除之后同名、甚至同对象的新注册。调用者必须串行await use；setup期间再次use或dispose会报错，不引入并发队列。

ToolsService.register和EventsService.on也返回disposer。没有通用effect/hook系统，没有动态profile替换或嵌套Context继承。

## 固定依赖

| 插件 | 提供服务 | 依赖 |
| --- | --- | --- |
| events | events | 无 |
| jsonl-persistence | persistence | 无 |
| memory-session | session | persistence |
| permissions | permissions | 无 |
| tools | tools | permissions |
| file-tools | 注册工具，无服务 | tools |
| http-model / mock-model | model，含accounting包装 | session |
| context-manager | contextManager | session、model、tools |
| prompt-optimizer（可选） | promptOptimizer | model |
| agent-loop | agentLoop | session、model、tools、contextManager、events |

Loop通过has读取可选Optimizer。accounting由runtime创建，为模型包装器与Loop共享额度；它是辅助类，不是新增插件框架。JSONL provider可换memory，模型可换mock，Loop可换测试实现；Context无论是否压缩都提供相同接口。插件列表/config记录到manifest即可，不需要图hash。

## 最小验收

- 换模型或持久化provider，Loop源码不改。
- 注册工具后schema/execute可用，整体dispose后都移除。
- 缺依赖、重复插件/服务报错，不静默覆盖。
- 逆序/失败清理、幂等dispose有测试。
- 两runtime的Session、权限、工具、预算互不共享。

Agent Loop本身必须由插件提供，不能只将模型和工具包成插件，却让内核负责循环。
