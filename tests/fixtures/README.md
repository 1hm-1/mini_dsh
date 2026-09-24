# 工程夹具

`eval-smoke`仅用于M4工程验证，不属于Benchmark-S的8题或Benchmark-H的4题，不含冻结manifest或研究成绩。

任务目录含公开prompt/workspace及带canary的独立acceptance/reference，用于验证加载、哈希和材料隔离。独立验收文件的import遵循检查副本根映射；直接运行源包内的acceptance不属于当前测试方式。M4.2已通过独立检查副本验证初始真实失败、参考版本两类测试通过；原始包保持不变。这不是M5的12题预检或Git冻结。

M4.3新增`npm run eval:smoke`：该夹具固定重复两次，脚本模型通过真实runtime读→改→final，产物标记mock且不要求冻结Git。CLI/冻结检查测试使用临时Git仓库和本地假HTTP服务验证失败保留与版本字段；这些都不是供应商真实模型成绩。

M4.4已将该离线矩阵接入summary/report与verify，测试覆盖删除失败attempt、篡改summary/report/快照/日志/计量/phase/path，以及不完整journal只输出diagnostic。单题`eval:preflight`与只读`eval:verify`均有CLI验收。手工多组数据仅验证统计公式，不代表C/O运行时或真实消融已完成。
