# 04 文件工具与权限

| 工具 | 参数 | 行为 |
| --- | --- | --- |
| list_files | path?:string，默认'.' | 递归文件列表，相对路径字典序 |
| read_file | path:string | UTF-8文本读取 |
| write_file | path:string, content:string | 白名单内创建或整文件替换 |
| edit_file | path:string, oldText:string, newText:string | oldText非空且只出现一次才替换 |
| delete_file | path:string | 删除白名单普通文件，不递归删目录 |

未知工具/参数拒绝。四组schema和描述一致，工具不调用模型。不向Agent提供check或Shell，验收由评测器在结束后执行。

M2.1已实现permissionsPlugin(writable)和toolsPlugin()。默认权限仅识别表中的五个名称，读操作也检查词法路径；写操作必须精确命中初始化时复制的白名单，空白名单拒写。list_files省略path或使用'.'表示根目录，其余路径使用不含空段/'.'/'..'的相对形式。公开测试不可写由TaskSpec排除publicTest与writable冲突，再由权限服务执行白名单；权限服务不猜测测试文件名。M2.2的fileToolsPlugin(workspace)依赖tools，在setup时realpath工作区并确认目录，再注册这五个工具；注册中途失败撤销已注册项，清理时逆序注销。

工具注册当前支持五文件工具所需的schema子集：type='object'、properties中的type='string'及可选description、required数组、additionalProperties=false。其他关键字明确拒绝；例如edit_file的oldText非空由文件handler检查，不悄悄忽略minLength。注册表复制schema和handler引用，返回schema也是独立快照，按工具名排序；旧disposer不会删除同名新注册。ToolsService可配合替换的Permission provider注册自定义工具，首版默认权限仍仅允许上述五种。

execute依次验证JSON对象、未知字段、必需字段及类型，通过权限检查后才调用handler。未知工具/非法参数/拒绝权限返回unknown_tool/invalid_arguments/permission_denied；handler普通异常返回不含原异常内容的tool_error。返回对象仅含ok/output/errorCode/truncated四字段。调用者负责按顺序await执行；signal在调用前后检查，取消和超时继续抛出，不降为普通工具错误，也不通过提前返回放任后台handler继续运行。

单文件最大256KiB，超限显式失败；不得截断后覆盖。模型可见工具输出最多16000个JS字符，尾部注明truncated，各组同规则。list最多1000项，超限标truncated，可指定子目录重试。write/edit只返回操作结果，不回显全文。

16000字符的通用上限已在M2.1 Tools.execute实现，长度包含末尾的`\n[truncated]`，已有truncated=true不会清除。文件handler按UTF-8字节数检查256KiB边界；write既检查新内容，也拒绝替换已有超限文件，edit同时检查原文与替换结果。read超限明确失败，合法文件的长文本仍经过统一输出上限。list返回工作区相对路径，以换行分隔、全局字典序排列；恰好1000项不标截断，超过时返回前1000项并追加标记，仍受16000字符总上限约束。递归扫描遇到symlink或特殊文件时整次拒绝。

## 边界规则

workspace启动时realpath；只接受相对路径，拒绝绝对路径、NUL、反斜杠、'..'段。逐段lstat拒绝symlink和特殊文件，新文件验证父目录。不能以字符串startsWith代替边界校验。

工作区不放.git、凭据、session和参考答案。写入仅限精确writable路径；publicTest不可写。无白名单默认拒写，首版不实现交互逐次批准。

write/edit用同目录临时文件+rename，独占open成功后才取得临时文件所有权；写入、关闭或rename失败时尝试清理自己创建的临时文件。使用固定短前缀与随机UUID命名，支持较长的目标文件名。父目录必须已存在，不自动创建目录。edit零次/多次匹配不得修改，重叠出现也计入多次；newText允许空字符串。delete只删普通文件，不存在返回file_missing。

handler返回file_missing、invalid_file_type、file_too_large、edit_no_match或edit_multiple_matches等明确错误码；其他I/O异常统一为tool_error且不回显系统路径。空oldText返回invalid_arguments。文件I/O与提交前检查取消信号，传播取消并等待清理；rename或unlink已提交后发生的取消不回滚操作。所有工具由调用者串行await；不承诺抵御恶意外部并发写入，也不提供断电持久化保证。

## 执行验收的边界

评测器用node子进程、shell:false、固定测试入口，cwd为新检查副本；不将模型字符串拼成命令。默认10秒超时、1MiB输出上限，signal/超时/非零退出均失败。Node权限参数限制读取到检查副本，禁止网络/子进程能力；环境白名单不含API key、SSH_AUTH_SOCK、NODE_OPTIONS。

采用node:test固定入口和结构化报告确认测试完成且至少一个测试通过，不能仅看exitCode=0；提前process.exit(0)、零测试须失败；文件级wrapper成功不能冒充实际用例通过。测试从原始可信资产重新注入，候选的测试文件修改仍使integrity失败。

这不是操作系统沙箱，不保证防御恶意程序。首版只运行可信自建夹具；外部不可信任务接入前再加容器，不将容器作为当前强制依赖。
