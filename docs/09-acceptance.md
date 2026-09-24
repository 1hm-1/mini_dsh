# 09 首版验收用例

以下为分期验收要求；M0–M4已执行范围与证据见progress.md，未到期条目仍待后续里程碑。每个ID对应可检索测试名；mock验证工程，真实模型验证能力，不能混淆。

| ID | 输入/操作 | 必须断言 |
| --- | --- | --- |
| A01 | 非法variant、负预算、缺model、未知字段、TEMPLATE | 启动失败，无模型调用或文件修改 |
| A02 | CLI正常/预算/配置错误/取消 | exit 0/2/1/130；finally释放资源 |
| K01 | 缺依赖、重复插件/服务 | 明确报错，不覆盖原服务 |
| K02 | 插件逆序dispose；一项抛错；再次dispose | 顺序正确，其他清理继续，每项只执行一次 |
| K03 | setup部分注册后失败；换mock provider | 插件自清理和已加载插件清理均执行；替换不改Loop |
| K04 | 两runtime、工具插件注册与清理 | 无共享状态；清理后schema和handler均消失 |
| R01 | scripted read→edit→final | 实际文件修复，匹配tool results，completed，外部测试通过 |
| R02 | 请求额度2，模型一直调用工具 | 实际恰好2请求，第三次未发，request_limit |
| R03 | 同一响应3个calls，只剩1工具额度 | 仅前1个执行，其余未执行，tool_limit，不发缺结果的下一请求 |
| R04 | HTTP挂起/429/错误JSON/length | timeout或model_error，无自动retry，无迟到工具写入 |
| R05 | usage缺失/辅助请求/非法工具参数 | 缺失为null；辅助均计总数；参数错误占工具额度且有结果 |
| R06 | Session写失败/日志断尾/正常结束 | io_error停后续动作；断尾incomplete；正常run_end唯一 |
| T01 | ../、绝对路径、symlink父/叶、特殊文件 | 读写拒绝，目录外哨兵不变 |
| T02 | 改公开测试、删除非白名单、新建越界 | permission拒绝，受保护内容不变 |
| T03 | edit匹配0/2/1次；写入中注入失败 | 前两者不改，后者一次；失败后原文件完整 |
| T04 | 大文件/长输出/缺失文件/错误工具参数 | 有界输出或明确错误；四组行为相同 |
| C01 | 开启C，历史超阈值且有可摘要完整轮次 | 调一次summary；保留原任务/近期call-result；Session不删 |
| C02 | 关闭C/未到阈值/历史不足 | 不发summary；投影符合开关；compactions=0 |
| C03 | 连续压缩/summary失败/摘要后仍超硬限 | 边界推进不重复；失败显式终止；context_overflow不放宽上限 |
| O01 | 有/无Optimizer插件 | 1/0 optimizer请求，原需求保留，额外token和时间计入 |
| O02 | optimizer空输出/tool calls/耗尽总请求 | model_error或request_limit，不免费继续或静默退回baseline |
| E01 | 两组多重复 | 独立workspace/Session，初始hash相同，无前次改动 |
| E02 | acceptance/reference各放唯一canary | Agent文件列表和全部请求无canary，外部验收才能访问 |
| E03 | 公开过独立验收败、越界但功能过、预算停但功能过 | 主passed均false，原因与functionalPass分开 |
| E04 | 初始全过/reference失败；测试超时/提前exit(0)/零测试 | preflight拒绝坏题；grader不误判通过 |
| E05 | 删除attempt、改summary、漏辅助调用、篡改snapshot | verify失败并定位；不输出完整比较表 |
| E06 | baseline及四组mock完整矩阵 | manifest/schedule/result/report可重算，明确mock标签 |
| S01 | baseline=[0,0,1,0] full=[1,0,1,1] | 成功率25%/75%，差50百分点；失败样本计入token/耗时 |
| S02 | 子集选择、轮换顺序、缺usage、C未触发 | 顺序可复现；总量null有完整率；触发0不解释为能力收益 |
| B01 | S8/H4共12题逐一preflight | 初始acceptance失败，reference公开与独立验收通过，补丁不越界 |
| B02 | 添加第13题与修改原题一个字节 | 新题不改runtime即可运行；旧题hash改变，报告可区分 |
| R07 | baseline/C的逐请求上下文观测、无worker请求、硬超限 | 估算与真实请求匹配；无请求均值null；超限长度有日志；不拿累计token当长度 |
| E07 | 冻结manifest与task字节不符、错suite或benchmarkCommit | 真实运行拒绝、verify失败；smoke仅明确不冻结的测试配置可运行 |
| S03 | S全部通过/H部分失败、混入诊断baseline | 分层与总体计数正确；最终ablation拒绝不同phase/实现commit样本 |
| B03 | 只有任务规格或占位hash；M5完成资产后 | 前者不可标frozen；后者preflight与真实Git SHA/文件hash一致 |
| F01 | M6真实baseline完整矩阵及两个固定路径报告 | runs与reports路径符合13；九项分析全部覆盖，HTTP证据/长度/termination齐全，verify通过；mock不能替代 |
| F02 | failure分析的支持/无证据/全成功案例 | 每条判断引用journal/断言；推测与事实分开，不能为M7伪造失败 |
| F03 | M9四组最终矩阵 | 四组同实现/任务/模型配置，包含新跑baseline；辅助请求共享预算；S/H分表 |
| F04 | 报告未提交、虚假SHA、C/O先实现、有效M6提交 | 前三者不能标M6 DONE；M6时核验已有报告/索引/摘录提交和无机制抢跑；后续分别核验M7/M8的HYP引用、M9的commit关联，不要求M6时存在未来提交 |
| S04 | read(a),read(a),write(a),read(a)；给定token/长度序列 | exact重复2、连续重复1、成功回读2且标注中间改动；逐请求增长/峰值与日志一致，不把累计token当context，不自动把重复判成浪费 |

A02的Agent退出0只表示completed。eval完成矩阵（包含任务失败）退出0，配置/环境/证据错误退出1；verify不一致退出1。不要将任务失败误认为runner崩溃。

K/R/T为运行时与工具基础保障；C/O验证研究因素；E/S/B是评测核心；F为真实证据门槛，不能由离线mock声明通过。分期执行按08，尚未实现的部分标待执行，不以空测试占位通过。

## CI

每次改动执行安装、typecheck、必要单元/集成测试、mock smoke和verify；完整任务资产存在后加入preflight。无需容器、外部仓库下载或API key。真实模型实验手动按需执行，不要求每次CI跑完整矩阵，也不要求full赢baseline。
