# 截图交互研究（2026-10-29）

本轮围绕用户要求的长截图、贴图双击关闭/右键菜单、横竖辅助线查阅公开资料。QQ 和 Snipaste 结论来自官方页面；微信新截图能力仅找到官方发文的媒体转述，证据强度单独标注。没有运行竞品截图、读取聊天记录、捕获真实桌面、反编译竞品或复用竞品代码/素材。本文的设计建议不等于功能已经实现；源码和验收以产品说明、验证记录为准。

## 已核实的功能与交互

| 产品与证据范围 | 可核实的交互 | 对星镜的启发 |
| --- | --- | --- |
| QQ 9.1.5，腾讯客服历史教程 | 先框选普通截图，再从功能栏进入长截图；滚轮连续选择内容，随后编辑并完成 | 长截图放在现有选区工具条，沿用复制、保存、贴图、更多编辑出口 |
| PCQQ，腾讯 ISUX 2019 设计说明 | 以普通截图为入口，减少首次选择负担；滚动时显示结果预览，失败时提示纠正选区 | 显示当前长图、累计高度和是否接上；拼接失败保留进度，告诉用户保留重叠内容重试 |
| Snipaste，官方基础操作文档（网页未标统一适用版本） | 截图可直接复制、保存、贴图；支持像素微调、放大镜和取色；贴图滚轮缩放、Ctrl+滚轮调透明度，Esc/双击关闭，右键菜单含操作 | 高频动作直接可用；低频动作放右键菜单。菜单和关闭操作不应触发拖动 |
| 微信，2026-07-14“微信派”文章的媒体转述，原文与平台适用范围待核实 | 报道列出标注、文字提取/翻译、一键打码、鼠标位置色值、选区像素比例 | 把结果处理放在截图附近；隐私识别仍需要候选复核。不能据此断言各端当前都具有完全相同的能力 |

来源：[QQ 9.1.5 超长截图教程](https://kf.qq.com/faq/190624amau22190624ArMrE7.html)、[腾讯 ISUX：QQ 截图全新设计（2019-07-16）](https://isux.tencent.com/articles/qq-screenshot.html)、[Snipaste 基础操作](https://docs.snipaste.com/zh-cn/getting-started)、[IT之家对微信派文章的转述（2026-07-14）](https://www.ithome.com/0/976/379.htm)。前三项通过网页正文核对，其中 QQ 客服和 Snipaste 文档另经 Ego 浏览器读取。

Snipaste 文档还区分关闭单张、隐藏全部和销毁；这说明动作名称需要和真实结果一致。星镜当前会话最多六张、长期历史交给星笺的产品分工不因竞品具备历史/分组能力而改变。Snipaste 从剪贴板贴图的设计也不改变星镜“不读、不监听剪贴板”的约定。

## 本轮采用与后续建议

1. **长截图**：从选区工具条进入；显示拼接预览、累计尺寸、完成与取消。先支持用户手动滚动后明确采集下一屏，采集时隐藏控制窗口；重叠不足、重复帧、反向滚动、尺寸变化和资源上限均给出可恢复的反馈。本轮源码包含简单固定头尾处理及原创像素测试；自动滚动、复杂固定页眉与动态页面支持不能由首版拼接推定已具备。
2. **贴图**：按用户要求改为双击关闭，右键集中现有动作；空格仍能控制工具条。原生拖动可能吞掉 DOM 双击，须额外核对实际按下序列，并测试右键菜单键盘导航、边缘不出屏和误拖动。
3. **辅助线**：指针位置显示一横一竖细线，选区确定后降低干扰，提供快捷键显隐；线、放大镜、尺寸提示只属于覆盖层，不能进入导出像素。这是星镜本轮设计选择，不声称复刻某竞品的具体算法。
4. **后续候选**：独立全文 OCR 复制可复用现有本地 OCR 路径；翻译需要另行产品决策。显式复制色值已于2026-11-05补入工作区，见下节。截图流畅、错误恢复、双平台 DPI 与窗口交互验收优先于继续堆工具。

QQ 的教程明确针对旧版本，不能据此声称当前 QQ NT/macOS 的具体按钮、快捷键或长截图行为已原生验证。微信 Windows 官方主页在本次访问显示 4.2.0，并链接 2026-10-27 更新说明；该说明仅写修复已知问题，无法补足上述截图功能的平台/版本矩阵。来源：[微信 Windows 官方主页](https://pc.weixin.qq.com/)、[4.2.0 更新说明](https://weixin.qq.com/updates?platform=windows&version=4.2.0)。

## 快捷键、提示与屏幕四角补充（2026-11-05）

用户提供的Snipaste截图显示底左操作提示与鼠标旁取色提示。另核对[官方快捷键文档](https://docs.snipaste.com/zh-cn/key-bindings)及其[Markdown正文](https://docs.snipaste.com/wiki/Key-Bindings.md)：截图中右键可重选或退出，Ctrl+A选全屏、Ctrl+T贴图；放大镜可见时C复制颜色、Shift切换格式，Alt临时显示放大镜。文档注明macOS使用Cmd替代Ctrl。[基础操作](https://docs.snipaste.com/zh-cn/getting-started)及其[Markdown正文](https://docs.snipaste.com/wiki/Getting-Started.md)说明默认F1截图、F3贴图。这些是公开交互约定，未据此推定竞品内部事件实现或热角处理方法。

星镜工作区采用以下规则，保留自身Tab逐级扩大和方向键调整设计，不宣称快捷键全面等同竞品：

- 已有选区或正在框选时，右键清除本次选区、标注及撤销历史，仍停留截图覆盖层；无选区时右键退出。底左提示随状态变化且`pointer-events:none`，提示区域仍可开始框选。
- ⌘/Ctrl+A选当前显示器全图，⌘/Ctrl+T贴图；放大镜可见时C复制颜色，轻按Shift切换HEX/RGB，选区确定后按住Alt临时显示。Shift拖动、Tab或其他组合键不额外切换色值格式。鼠标旁显示像素坐标、取色提示与复制结果。
- `copy_capture_color`仅授予capture窗口，核对活跃且已显示的会话、点位与格式，从Rust保留的冻结原图读取对应像素后写剪贴板；不读取剪贴板、不重新截图，不使用覆盖层装饰或标注后的颜色。
- 设置页提供F1/F3预设填入按钮，只修改表单草稿；点击保存才注册并持久化，失败尝试回滚原绑定并报告错误。既有默认值和用户设置不自动迁移；F3仍是星镜的「贴最近截图原图」，不新增从剪贴板读图。

macOS四角干扰通过原生公开API处理：Apple的[disableScreenCornerInteractions](https://developer.apple.com/documentation/appkit/nsapplication/presentationoptions-swift.struct/disablescreencornerinteractions)及本机SDK `NSApplication.h`将该选项标为macOS27.0起可用，需同时使用隐藏或自动隐藏Dock选项。`capture_platform.rs`仅在macOS桌面构建编译，截图覆盖层显示前保存原presentation选项与窗口状态，再设置隐藏Dock/菜单栏、Stationary、较高窗口层级；27+额外禁用屏幕角交互。多屏共用一次原始状态，普通截图结束/失败、进入长截图、意外销毁及退出均恢复，长截图启动失败则重新保护覆盖层。原生调用限主线程，不写`defaults`、不更改用户热角设置或禁用Cmd+Tab。旧macOS只有层级与Stationary回退，不能保证所有热角都被抑制。选项约束另见[Apple presentationOptions](https://developer.apple.com/documentation/appkit/nsapplication/presentationoptions-swift.property)。

本节记录已实现源码和已通过的编译检查；本轮行为测试、原生四角效果及安装结果另见[验证记录](verification.md)，不在研究结论中提前视为通过。未为核实此功能自动捕获真实桌面。

## REA skill 安装记录与使用边界

用户请求的 rea 对应上游 [morluto/rea](https://github.com/morluto/rea) 的 `reverse-engineer-anything`。已使用内置 skill-installer 安装固定提交 `429355ca4d1078579fca7d286de85c512bed0a96` 下的 `.agents/skills/reverse-engineer-anything`；skill metadata version 为 `53`，八个文件及所有本地引用均存在。安装目标为用户技能目录中的 `reverse-engineer-anything`，不属于星镜应用依赖，不进入应用构建。

安装阶段已先阅读完整 SKILL.md；它要求按具体问题核对入口、状态变化和结果，将观察、推断、未知分开记录。仅安装 skill 提供工作指令，不会注册 REA MCP、安装反编译引擎或给当前运行的对话增加工具。当时没有安装这些额外依赖，也没有声称使用 REA 完成原生逆向；普通星镜源码分析仍使用仓库工具。

同日用户进一步要求调查悬浮预选后，已实际用REA CLI 6.7.0检查本机Snipaste 2.9.2的Mach-O/plist，并结合只读反汇编核对窗口与AX元素定位调用链；深度反编译提供方不可用，未安装额外引擎或改MCP配置。结论与静态证据边界另见[Snipaste悬浮检测调查](snipaste-detection-research.md)，不把后续调查回写为本节初始安装阶段已经完成。
