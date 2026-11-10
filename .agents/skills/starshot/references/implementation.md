# 实现与验证要点

以下均对应仓库源码；验收结果仅在 `docs/verification.md` 维护。

| 入口 | 职责 |
| --- | --- |
| `src/project-links.ts`、`src/App.vue`、`src-tauri/src/desktop.rs::open_project_link` | 主窗右上角 GitHub 图标和关于页仓库 / Issue 链接；浏览器安全新标签，桌面仅主窗可调用固定目标白名单，不接受任意 URL、文件或命令；未新增依赖或 Star 数请求。2026-11-10 验证见 `docs/verification.md`，未替换日用应用 |
| `src/App.vue` | 主编辑器、原图与标注、美化偏好、撤销/重做、最近会话、导入/导出。`?view=capture` / `?view=pin` 分别挂载独立界面 |
| `src/editor.ts` | 预览和PNG/JPEG共用Canvas管线；标注原图坐标，裁剪只改变可见窗口；马赛克实际替换像素 |
| `src/{privacy.ts,objects.ts,preferences.ts,share.ts}` | 本地敏感规则、对象/贴纸预算、非图片偏好与原创宣传图；OCR原文不存入候选状态 |
| `src-tauri/src/{ocr.rs,ocr/,desktop_settings.rs}` | macOS Vision / Windows离线子进程识别；快捷键与开机启动事务保存 |
| `src/geometry.ts` | 选区夹取、候选命中、完整包含关系的父子路径、连续方向边缘/四边支撑启发式；`capture-regions.worker.ts`一次分析受限探测图，并非系统控件树 |
| `src/components/CaptureOverlay.vue` | 原生冻结图/明确demo分支，选择、8向调整、键盘微调、放大镜、就地标注/撤销及copy/save/pin/edit路由 |
| `src/components/PinWindow.vue` | 原生贴图拖动、缩放队列、旋转翻转、透明度、工具条显隐、双击关闭及右键菜单；焦点光圈与实际显示图片边界 |
| `src/components/DesktopSettings.vue` / `src/shortcuts.ts` | 桌面设置草稿、快捷键录入/可读显示/占用检测；有效绑定提示与草稿分离 |
| `src/components/ScrollCapturePanel.vue` / `src-tauri/src/scrolling.rs` | 手动逐屏采集控制面板与纯像素纵向重叠拼接；原生采集/生命周期在desktop.rs |
| `src-tauri/src/desktop.rs` | xcap捕获、窗口候选、多显示器覆盖层、快捷键、托盘、复制/保存/贴图和IPC |
| `src-tauri/src/desktop/tray_menu.rs` / `src/components/ShareSettings.vue` | 原生托盘分组与状态、批量贴图操作和快捷键暂停；分享文案/原创产品图预览及确认复制 |
| `src-tauri/src/capture_platform.rs` | 仅macOS桌面编译的临时截图presentation与窗口层级/行为；主线程保存与恢复，macOS27+抑制屏幕热角 |
| `src-tauri/src/window_regions.rs` / `window_regions/windows.rs` | macOS CoreGraphics几何快照与已有授权下的AX位置/尺寸；Windows窗口身份快照与受限UIA helper；初始鼠标和原生控件坐标转换 |
| `src-tauri/src/imaging.rs` | 图片解码/上限、裁切参数、坐标转换、同目录临时文件原子替换 |
| `src-tauri/{build.rs,permissions,capabilities}` | 主编辑器/捕获/贴图三类窗口最小权限；lib.rs测试生成后的ACL |
| `.github/workflows/verify.yml` | macOS Apple Silicon app/DMG与Windows x64 NSIS检查和构建；配置存在不代表远端运行通过 |
| `src/{update-api.ts,session.ts}` 与 `src-tauri/src/{updater.rs,recovery.rs}` | 签名更新与完整会话恢复；协议、签名和失败边界见 [更新要点](releases.md) |

## 2026-11-10分享预览与托盘菜单

- 2026-11-10托盘菜单入口在`src-tauri/src/desktop/tray_menu.rs`，由`desktop.rs`装配：截图/最近原图/全部贴图显隐优先，贴图管理子菜单含恢复鼠标操作、关闭全部和共享光圈开关，另有暂停全局快捷键、编辑器、偏好、检查更新、操作说明、关于及安全退出。没有截图/贴图、达到12张贴图或忙时对应动作置灰；显隐文案显示贴图数量，隐藏保留窗口和图片。批量关闭仅移除成功销毁项，部分失败保留对应状态并报错。
- 托盘快捷键提示来自已保存配置及实际本应用注册状态，使用展示文字而不重复注册menu accelerator，避免同一组合键触发两次。暂停状态仅本次运行：复用`desktop_settings::replace_bindings`事务释放本应用两项键，恢复占用失败回滚，保存设置保持暂停；不取消其他注册项。设置页通过`get_app_status.shortcutsPaused`及`shortcuts-paused`事件显示状态。光圈沿用持久化成功后广播`pin-halo`，不覆盖设置草稿。
- 托盘导航先保存`Context.pending_menu_request`再唤起主窗；`take_menu_request`只授予主窗并消费一次，前端先监听`menu-requested`，初始化后再读取，覆盖主窗尚未创建/已释放的情况。检查更新使用一次性请求，等面板初始读取及忙状态结束后检查并确认消费，重新打开设置不重放；只有用户点击菜单才请求检查，不增加启动联网。原生动作/菜单展示待实际桌面验收，当前构建和模拟IPC证据见验证记录。

- 分享入口位于「设置与帮助 → 关于」。2026-11-10源码将文案/图片均改为先展开预览，再显式确认复制；图片保存也从预览进入。`ShareSettings.vue`只生成原创宣传图，预览不写剪贴板；处理期间禁用操作，复制失败保留预览和错误，便于重试。预览沿用设置内容区，不叠加第二层弹窗。`styles.css`主按钮悬浮显式保持主题的强调背景/文字颜色，避免通用button hover覆盖背景导致文字难辨。构建与浏览器验证边界见验证记录；本轮未安装或发行。

## 必须保持的关系

- 窗口/选区传输用物理图片像素；xcap macOS窗口和显示器边界是逻辑points，覆盖层用LogicalPosition/Size。Windows用PhysicalPosition/Size，先移动到目标屏，再设置最终尺寸，避免DPI切换二次缩放。Windows v2夹具分别覆盖100%/150%及负X；生产同时多屏、跨屏切换及Mac混合DPI仍需原生验收，不能用夹具结果泛化。
- 图片导入意图在FileReader前分配版本，所有await后与错误反馈前核对；背景另记请求版本和目标图片ID，切图片/选新背景后旧结果不能覆盖。源码：App.vue `importFile`、`loadImage`、`openDocument`。
- 设置/历史弹窗开启时先处理Tab/Esc，阻断底层编辑快捷键。取消截图返回需要重新绑定画布和ResizeObserver。
- 演示SVG先栅格化PNG供区域预览，避免SVG preserveAspectRatio与选框映射不一致。demo必须显式绑定，桌面设置里的原创示例不能访问原生捕获帧。
- 输入导入24MP/32MB，原生截图每屏40MP，渲染/原生导出64MP/64MB，最长边16384；不能在截图确认关闭覆盖层后才用更低导入阈值拒绝截图。2×应实际重新计算尺寸并预先禁用超限导出。
- 保存先完整编码，再在目标同目录创建临时文件、fsync、原子替换；失败保留旧目标。JPEG以白底合成透明像素。取消原生对话框不提交编辑或丢失当前图。
- macOS系统占用Cmd+Shift+3；默认贴原图使用 `CommandOrControl+Alt+3`，开始截图 `CommandOrControl+Shift+2`。2026-11-05设置页增加F1/F3预设填入，只改草稿、保存才生效，不自动覆盖既有配置。实际冲突通过UI报错并尝试恢复原绑定，回滚失败也报告实际错误，不使启动失败。
- 新图最近会话最多6张、原图合计48MP；最多60个撤销步骤。预算不包含背景/临时渲染/快照，不代表进程硬内存上限。贴图最多12张。
- 用户反馈菜单栏原图标难辨认（2026-10-26）。托盘不再复用带底板的应用图标：`public/tray-template.svg`生成36px黑色透明模板，macOS启用icon_as_template；`public/tray-contrast.svg`生成32px紫色/白边图标供Windows。源码接入desktop.rs，已有image依赖负责解码，无新增依赖。生成命令为 `npm run tauri -- icon public/tray-template.svg --output src-tauri/icons/tray-template --png 36`，另一份替换为tray-contrast和32。此修复自0.2.1引入；系统实机效果与设计预览分开记录。

## 轻量截图改进（0.3.1已发布）

- `finish_capture`接受可选action（edit/copy/save/pin，缺省edit兼容旧调用）及仅标注时传入的PNG；原生核对活跃窗口、矩形、实际PNG格式和精确裁切尺寸。保存取消返回completed=false保留选区；失败不关闭。quick成功更新current/已有main会话但不创建或唤起main，edit才唤起。
- 每次捕获窗口使用唯一`capture-{id}-{index}`，旧请求/关闭事件不得影响后续捕获。2026-10-29按用户反馈取消“取消截图后恢复此前可见主窗”的旧行为：退出截图只清截图状态，主窗保持收起，已有图片/编辑会话不变；仅主动更多编辑或截图启动失败时显示主窗。2026-11-05右键规则改为有选区先重置、无选区才退出，叉号、Esc、长截图取消及原生关闭仍可退出；旧右键直接退出的验证仅适用于此前版本。主窗原本隐藏时不等待180ms移除动画。保存/贴图使用已持有operation锁的内部helper，不能重入外层加锁命令。
- 原生未标注选区直接裁切RGBA用于copy/save，仍编码一份PNG供最近图片和已有主窗状态；不能声称完全没有PNG编码。前端仅显示图片，不为放大镜再常驻完整CPU截图canvas；小画布每帧最多一次读色，隐藏时不读。
- 区域候选Worker在界面可交互后分析一次，探测图长边1920、算法硬上限4MP，最多256边缘候选；不再二次480跳采样。四边支撑拒绝文字/单线/密集纹理，圆角与短断边可保留；表格相连格线、严重缺边/极低对比仍可能漏检。演示卡片候选也走真实算法。
- 系统窗口保留系统返回的前后顺序，指针处只采用最前窗口及其内部候选，避免后台小窗抢选；全屏作为末级候选。0.3.1通过xcap获取窗口，2026-10-29未发布修复改为macOS直接取CoreGraphics几何快照。Tab按矩形坐标匹配当前候选（不能用Vue代理对象的indexOf），同位置点击/抬起保留键盘选择，真实移动后重新命中。
- `renderPreview`复用同一标注管线但按显示尺寸/DPR（最多2）限制4MP；坐标和导出`renderImage`保持原图像素，遮盖仍最后重绘不透明边缘。预览不能作为导出分辨率。

## 按平台编译与打包

- 用户于2026-10-29确认只将当前平台专用实现、依赖和资源打进安装包。统一仓库和源码交接快照仍保留两平台源码；Cargo.lock记载所有目标依赖也不代表运行包包含它们。用`#[cfg(target_os = ...)]`选择原生代码，避免仅运行时判断平台来隐藏无用实现。
- macOS AX/Vision使用macOS条件编译与objc2目标依赖；Windows OCR的ocrs/rten为Windows target dependencies，offline/worker模组及模型测试仅Windows编译。Mac测试不再因cfg(test)拉入Windows推理引擎和模型；Windows仍保留模型哈希/原创图识别及最终exe worker验收。UIA的windows依赖、helper与windows-uia-smoke入口也限定Windows，不增加MSAA实现。
- `tauri.windows.conf.json`只为Windows增加OCR许可/说明资源，基础tauri.conf不再通用复制。Windows模型仍由include_bytes嵌入exe，不另存一份模型资源；平台配置由Tauri按构建目标自动合并，不新增版本字段。Mac原来没有打入12.2MB模型，此次明确去掉的是无用构建依赖和25,085字节的Windows OCR许可资源，不能宣称减掉12.2MB。
- CI的模型下载仅Windows desktop job运行；Mac及Ubuntu发行校验无需模型。共享前端目前只有少量平台提示与快捷键选择，没有独占的大型前端库，无需为几个字符串拆两套界面；将来新增大型平台模块时再按构建目标静态选择。
- 验证分别检查目标依赖树和真实安装包资源；依赖树解析不等于该平台编译或原生实测。对应依据：[Cargo平台依赖](https://doc.rust-lang.org/cargo/reference/specifying-dependencies.html#platform-specific-dependencies)、[Tauri平台配置](https://v2.tauri.app/reference/config/#platform-specific-configuration)。

## 2026-10-29未发布截图交互

下列长截图三项为2026-10-29手动首版历史；2026-11-10工作区已增加主动自动滚动、横向拼接、方向锁定及累计预览/当前屏蓝框，当前操作、原生输入、时序与验证边界统一见[长截图说明](../../../../docs/scroll-capture.md)。

- 普通选区工具条的「滚动长截图」调用`begin_scroll_capture`，不接受已有标注（先长截图，再更多编辑）；选区最小64×64。原覆盖层缩成380×300逻辑控制窗，保留原显示器ID/位置/尺寸/缩放/物理裁切坐标；其余覆盖层释放。前后端释放首屏全屏PNG，保留拼接结果/上一屏及缩略图。
- 每次用户点击「采集下一屏」才调用`append_scroll_capture`，隐藏控制窗180ms后重读原屏并裁同一选区；不自动滚动、轮询或后台截图。屏幕配置变化、失败、重叠不足保留既有长图；保存取消保留进度，`finish_scroll_capture`复用真实copy/save/pin/edit出口，取消/销毁清理状态。权限仅授予capture窗口，唯一label和operation锁沿用原会话约束。
- `scrolling.rs`按受限采样搜索向下位移，再密集验证重叠；重复画面不追加、重复纹理歧义拒绝，简单固定页眉/页脚只保留一份（头尾各最多识别选区1/3）。它是像素启发式，动态内容、重复排版、复杂悬浮层可能拒绝或误判；非通用页面语义识别，不支持自动滚动、向上或横向拼接。上限100屏、单边16384/40MP，兼容现有会话40MP/48MP预算。
- 首帧和每次追加还以与最终导出相同默认的PngEncoder检查64MiB编码预算，写入有上限的计数sink，不存额外完整PNG或base64；通过后才替换image/previous/frames。高熵图可能在40MP之前触及字节上限，失败保留原结果与重叠锚点，避免到完成时所有出口都被预算拒绝。
- 选择/拖动时显示随指针移动的一横一竖辅助线，H切换；使用现有rAF节流，pointer-events:none且独立DOM，不进入导出管线。
- 贴图双击改为关闭，空格仍切换工具条。macOS原生拖动需pointerdown立即发起，可能吞掉DOM dblclick，因此另以500ms/4px屏幕坐标连续左键按下兜底（移动、Ctrl单击及菜单操作排除）；关闭请求去重，失败可重试。右键/Shift+F10菜单支持变换/透明度/缩放/穿透/关闭；2026-10-29后续工作区新增复制、另存为、送到编辑器及⌘/Ctrl+C/S/E。小窗菜单可滚动、夹取边界，Esc先关菜单。
- 用户提供的Snipaste悬浮说明图只作为交互参考。`PinWindow.vue`在图片区补多行HTML `title`及`aria-description`，说明双击关闭、拖动、滚轮缩放、修饰键滚轮透明度、右键菜单、空格与光圈设置入口；工具栏及菜单补动作、快捷键和鼠标穿透恢复方法。沿用浏览器/WebView原生提示，不增加覆盖图片的常驻层、计时器或事件拦截，不进入导出。Mac说明⌘或Ctrl，Windows说明Ctrl；双击行为并无设置项，不能把竞品路径当作本产品入口。`CaptureOverlay.vue`同时补齐重做、复制和贴图后的操作提示。
- 2026-10-29按用户提供的Snipaste参考图增加贴图焦点光圈：活跃蓝色边框/柔光、失焦灰色边框/阴影，默认开启。`desktop_settings.rs`的`pin_halo`保存到本机桌面设置，旧配置缺字段时同样默认开启；`DesktopSettings.vue`保存按钮和右键菜单`pin_action("halo",0|1)`共用全局偏好。原生先成功持久化再更新内存并广播`pin-halo`，失败保留原值；设置页只在该事件中更新光圈字段，不覆盖未保存的快捷键等草稿。
- `PinWindow.vue`使用`getCurrentWindow().onFocusChanged`监听Tauri原生焦点，事件目标限定当前Window；`get_pin_image`返回初始焦点、光圈偏好和12px逻辑边距。先注册监听再读取快照，按请求时的焦点/偏好事件计数拒绝覆盖较新事件；设置页读取或保存设置后的迟到响应也对光圈字段作同样保护。透明度通知改为`emit_to`当前窗口并以Window目标监听，避免一张贴图的透明度影响其他贴图。
- 创建、最小尺寸和缩放窗口均保留四周固定12px透明空间；关闭光圈只移除装饰，不改变显示图片尺寸。光圈跟随按当前旋转方向计算的实际图片矩形，不包围透明留白；图片透明度与光圈分离。光圈和边距仅为CSS预览，`pin_export`仍读取原始payload，仅应用旋转/翻转，不将装饰写入复制、保存或送编辑器的图片。这批光圈代码已安装本机日用应用、未公开发行；Windows原生焦点、混合DPI与显示仍待验收，实际检查层级见验证记录。
- `pin_export`只接受动作、90°整数倍旋转和翻转，图片从调用贴图窗口自身状态读取；`imaging::orient_pin`先水平翻转再顺时针旋转，与CSS顺序一致且保留alpha与原始像素。预览缩放、透明度不写入成图。保存取消/失败保留贴图，成功显示实际路径；保存时暂时取消置顶并恢复。`pin_action`用try_lock，避免文件对话框持有operation锁时同步命令卡住主线程。
- 贴图送编辑器使用单待处理请求、一次领取和导入后确认（`take_pending_pin_edit` / `finish_pin_edit`只授予main）。编码后复查忙碌，窗口创建失败真实返回；等待回执前释放operation锁，不写普通截图current。送入的是贴图扁平像素，作为新图片编辑，不重建原始标注对象。新主窗启动后领取，重复事件不重复导入；30秒到期、忙碌、解码失败或新导入取代均返回失败且保留贴图。前端在解码后提交前检查截止时间；待处理请求阻止空窗释放。
- 主编辑器`resetStyle`一次checkpoint恢复DEFAULT_STYLE并清空本地背景，保留原图、裁剪与标注；递增backgroundVersion，迟到背景读取不能覆盖重置。顶部与帮助中的快捷键都使用实际shortcuts状态，保存失败回读原生绑定后同步提示。设置组件向主页面发出两个快捷键字符串的独立快照，不共享可变的设置对象，避免未保存输入提前改变已生效快捷键提示。
- 浏览器回归入口：`tests/browser-capture-regression.mjs`、`tests/browser-pin-regression.mjs`，仅原创图和模拟IPC。原生双击事件、隐藏控制窗后实际采集、多DPI和Windows新构建须独立验证，不把模拟IPC算成原生通过。

## 2026-11-05截图键鼠与四角保护

- `CaptureOverlay.vue::rightClick`在有选区/拖动/标注草稿时调用`reset`，清除选区、标注、撤销重做及指针捕获后重新启动悬浮预选；无选区时才`cancel`，busy期间不响应。右键释放不提交正在进行的左键拖动。底左提示按选区/工具状态变化，提示与放大镜都不拦截鼠标，不写入导出像素。
- ⌘/Ctrl+A将选区设为当前冻结帧全图，⌘/Ctrl+T复用贴图出口，Enter复制、⌘/Ctrl+C/S及既有Tab父子路径继续有效。未选区默认显示放大镜，已有选区时按住Alt临时显示；放大镜可见且没有拖动/标注草稿时C复制当前颜色。Shift按下记录轻按，400ms内独立松开切换HEX/RGB；移动、其他按键或指针操作会取消轻按，保留Shift手动框选、Shift+Tab与10px微调。输入框不接管这些字符键，失焦清除修饰键状态。
- `desktop.rs::copy_capture_color`仅在capture权限开放，检查生命周期、非长截图、当前唯一窗口及`Frame.presented`；`imaging::color_at`校验原图坐标并生成大写`#RRGGBB`或`rgb(r, g, b)`，读取的是Rust冻结帧，不接受前端任意文本/图片。不重新截图、不读剪贴板，写入成功后才显示已复制；失败保留当前选区。浏览器原创示例仅复制其本地示例色值。
- `DesktopSettings.vue::fillShortcuts(true)`只把F1/F3填入表单，保存沿用原生事务注册/冲突回滚，未保存草稿不改变主界面的有效快捷键提示。默认绑定和旧配置不迁移，F3仍贴最近截图原图；不新增剪贴板读取。
- `capture_platform.rs`原生模块限定macOS+desktop；`begin`/`end`仅在AppKit主线程操作。首次`begin`保存NSApplication原presentation及每个NSWindow原level/collectionBehavior，多屏和保存失败后的重复begin不覆盖原值。隐藏Dock/菜单栏时清除互斥autoHide及依赖它的autoHideToolbar；macOS27+额外启用`NSApplicationPresentationDisableScreenCornerInteractions`（`1<<15`），旧系统不传新位。窗口使用Stationary、CanJoinAllSpaces、FullScreenAuxiliary与screenSaver层级，保留并最终恢复原配置；不改变系统热角偏好、写defaults或屏蔽Cmd+Tab。
- `desktop.rs::capture_presentation`主线程直接调用，工作线程才投递并等channel；覆盖层ready显示前begin，显示失败与`clear_capture`恢复后清理。进入长截图收缩前end，收缩失败逐屏重新begin；保存取消/失败后重升选区窗口。意外Destroyed在后台取得operation锁并检查当前label后清理，旧销毁事件不能影响新会话；RunEvent::Exit额外幂等恢复。旧系统的Stationary/层级只是回退，不能写成全部热角已禁用。
- 来源为Snipaste官方快捷键文档、Apple文档与本机SDK声明，具体链接见[交互研究](../../../../docs/screenshot-research.md)。已完成源码实现与编译检查；行为测试、平台构建与安装结果由[验证记录](../../../../docs/verification.md)分别维护，不将编译当作真实热角效果验收。

## 2026-11-05设置导航与快捷键录入

- `App.vue`左下角用`Icon.vue`齿轮打开设置，独立调色盘按钮打开五套预设主题选择；选择预设关闭自定义配色但保留其颜色值，界面主题与导出图片背景分离。设置分外观、快捷键、通用、更新与恢复、关于五个标签，默认快捷键；标签具有对应tabpanel、方向键/Home/End导航和单一Tab焦点入口。
- `DesktopSettings`使用同一组件切换快捷键/通用部分，其余标签和关闭设置只隐藏组件，不销毁桌面设置草稿。`UpdateSettings`同样持续挂载监听，切标签或关闭弹窗不丢更新事件；下载、待安装、备份安装及确认状态自动打开更新与恢复页，更新忙碌时保留关闭/切标签禁用和编辑门控。
- `shortcuts.ts::shortcutFromKey`按物理按键代码生成组合，支持修饰键、F1–F24及常用编辑/方向键，忽略输入法组合、单独修饰键与重复keydown；无修饰字母/数字/方向键不作录入，仍可文本编辑。`shortcutLabel`生成平台可读提示。点击录入先等待原生门控成功，取得组合后结束录入并检测；Esc、Tab、失焦、切标签、关闭或卸载清理，串行原生命令与请求代数处理迟到回执。
- `desktop.rs::set_shortcut_recording`及`check_desktop_shortcuts`仅授权main；开始录入和检测沿用operation、退出、更新、活跃截图门控，结束录入不受忙碌限制。原生录入标志只在main实际聚焦时拦截已注册全局快捷键，发送`shortcut-recorded`字符串而不截图或贴图；macOS应用菜单⌘Q同样回传而不退出。主窗失焦/关闭/销毁清标志，回调也复查焦点；不添加全局键盘监听，不注销原快捷键。回调读取settings使用try_lock，避免保存持锁等待主线程注册时互锁。
- `desktop_settings.rs::check_shortcuts`解析并规范化比较两个组合，分别返回`available/current/unavailable/invalid`与中文信息。`is_registered`只证明本应用登记，不能当全系统占用查询；已有注册直接返回current，候选实际注册并立即撤销，不保存草稿、不触发截图/贴图、不读剪贴板。Windows使用插件试注册，probe标记抑制动作；撤销成功移除登记后才释放标记，清理失败阻止后续检测/保存并提示重启。macOS普通Carbon登记允许跨进程共享：`macos_shortcuts.rs`使用主线程独占试注册，立即撤销，以独立签名和非插件ID避免临时事件误触；可识别已有独占注册的冲突，非独占共享不保证被拒绝，不能据此宣称所有占用均可检测。-9878明确报占用，其他错误保留OSStatus，清理失败同样要求重启。保存新增候选前再次独占检查，原绑定与回滚保持原登记方式；虚拟键映射仅macOS编译，不支持独占检测的媒体键等组合明确报错。失败按原事务回滚，只移除本次新增登记。
- `DesktopSettings.vue::refresh(false)`在保存失败后只更新主界面有效快捷键提示，保留用户输入草稿；成功保存才以真实返回替换草稿。检测请求代数拒绝输入修改后的旧结果，贴图光圈事件继续只更新该字段，不覆盖快捷键草稿。初始化读取失败保留错误并禁止默认草稿写入，提供重新读取入口。OS占用可能在检测与保存间变化；current只代表星镜已登记，available只代表当前可注册，两者均不保证没有其他监听者。不能报告占用软件名称，也不保证检测全部非独占共享或系统保留快捷键；本机原创Carbon夹具的独占冲突/非独占允许结果见验证记录，不把SDK注释推断当作全平台事实。
- 上述为源码行为；纯测试覆盖已有绑定保留、探测清理、重复/非法组合、登记/清理失败、事务回滚与权限限制。浏览器或模拟IPC不能证明真实全局热键触发、全部系统冲突与跨平台原生交互已验收；实际检查、构建和安装结果见[验证记录](../../../../docs/verification.md)。

## 2026-10-29未发布悬浮预选修复

- xcap 0.9.8的macOS窗口清单会因可选名称/共享状态而跳过有效几何；新`window_regions::snapshot`在创建覆盖层前一次读取CoreGraphics窗口的bounds/PID/layer/alpha/onScreen，不读取标题或应用名，不依赖共享状态。保持前后顺序，过滤自身PID、不可见/全透明、桌面负层、Dock标准层级及高于系统弹出菜单层的窗口。Dock可能提供全屏但alpha=1的透明系统表面，因此不能只看alpha；通过CGWindowLevelForKey(7)动态取得层级并排除，不读应用名或改目标应用设置。普通层的第三方全屏透明覆盖窗仍可能干扰命中。
- `get_capture_frame`附带实际鼠标位置。macOS Tao鼠标采用主屏缩放、窗口位置采用所在屏缩放，分别归一化再转为图片像素；负坐标/Retina/混合DPI仅有纯计算测试，原生多屏待验收。读不到或鼠标不在本屏时保留居中回退。
- `get_capture_element`仅授权捕获窗口，校验当前会话/坐标/非长截图，使用已保存最前宿主，不允许前端任意指定PID/HWND。macOS仅在`AXIsProcessTrusted()`为真时调用`window_regions/macos_elements.rs`，点命中后沿`AXParent`收集有效包含框，零高/缺失几何仍继续上行；大容器或没有内部候选时，从几何匹配的宿主`AXWindow`局部下探`AXChildren`。校验PID/窗口几何，跳过静态文字但保留输入区、图片与按钮；不读Name/Value/Text，不修改目标应用辅助功能标志，不弹权限框。总查询预算120ms，每次AX调用设置剩余通信时间，最多128节点、32层父链、24层下探、8个候选，超限保留最内4层和最外4层，避免大面板被包装节点挤掉；这是有界尽力查询而非硬实时保证。重复框、循环、越界和歧义兄弟保守回退；已取到的父链在超时后保留，generation变化丢弃全部结果。统一IPC返回小到大的包含路径，整窗由前端追加，避免同窗大容器覆盖有效像素候选。设置页只读权限状态。
- 前端80ms停止移动后查询，每个覆盖层最多一个在途请求；鼠标移动、离开当前屏、Shift手动、Tab选择、开始拖动和卸载使旧结果失效并通知原生取消。原生读取会话快照后释放operation与frames锁，等待期间不阻塞取消/退出；返回复查窗口标签、Arc会话身份、请求代数、点位、宿主及显示器。真实控件候选须包含指针且限定于宿主窗口，优先于像素框；不支持的应用或权限不足继续窗口/像素候选。macOS不含Snipaste的递归子元素备用分支，不能称同等识别率。
- 全屏框改为内侧outline，避免被stage的overflow裁掉；Worker构造或运行失败从现有受限探测canvas回读并同步检测一次，不重建全尺寸canvas。初次任务用setTimeout安排，避免非活动屏双rAF阻塞；处理中/双路径失败显示状态。WKWebView实测同源module Worker可在现有CSP与tauri协议运行，无需blob或放宽CSP。
- 2026-10-29针对启动闪屏修正覆盖层显示时序：原生创建/定位后保持hidden，前端实际截图img解码并提交DOM后调用仅capture可用的`capture_overlay_ready`。该命令在后台等待operation，核对当前唯一label，显示成功才标记Frame.presented；失败通知清理截图并报告错误。原生10秒看门检查只针对当次labels，取得operation后再查，取消或新会话不被旧超时误清理。不能依赖隐藏窗口的双rAF触发显示；隐藏主窗后的180ms合成等待仍保留。
- `captureRegionsAt`从可信初始框建立完整包含的最近外层路径，拒绝交叉框与同框，保留精确外层而不被近似去重吞掉。像素候选必须完整位于最前宿主内，不再允许±2px越界，否则像素框外扩1px会令严格包含路径排除真实窗口。Tab向外、Shift+Tab原路向内，两端停止；首次切换冻结路径，迟到Worker/原生结果不能覆盖，真实移动后重建。Tab及Shift事件先处理待执行rAF移动；Shift+Tab松开Shift仍保留选择。`tests/browser-hover-regression.mjs`与`tests/macos-capture-webview-smoke.swift`使用原创像素、模拟原生IPC，后者加载真实dist和Worker，不是截图/跨进程AX实测。规则依据及边界见[选区规则](../../../../docs/snipaste-selection-rules.md)，实际通过范围见验证记录。
- Windows v2源码已接入：覆盖层出现前保存HWND、PID、Z顺序、线程ID、进程创建时间及类atom；从保存的宿主 `ElementFromHandle` 建根，读取几何、ControlType与身份，不读Name/Value/Text、不遍历桌面。有界查询最多128节点/12层/8候选，300ms合作式预算；优先完整语义控件，无关兄弟重叠歧义时回退。目标身份或几何变化丢弃旧结果；跨PID元素被拒绝，合法多进程provider可能退回窗口/像素框。
- Windows UIA在受Job Object管理的自建helper中运行无窗口COM MTA，每次查询使用唯一槽；跨屏争用时以5ms间隔可撤销地等待至多250ms，超限回退，成功拿槽后才开始原helper流程。750ms运行期限、撤销及退出终止/回收helper，不终止目标应用、不自动提权。300ms调用间预算不是COM硬超时；750ms也不含槽位等待、进程创建/系统调度/回收的全部耗时。不新增并发helper、MSAA或全局缓存；新增等槽测试尚待Windows执行，入口及验证范围见[Windows集成记录](../../../../docs/windows-uia-integration.md)。
- 证据分层：首轮独立探针216次零误差不代表星镜集成；v2为真实UIA/Tauri/WebView2/IPC原创夹具46项检查，两屏分别运行、手工Frame和单宿主，没有生产begin_capture/窗口枚举/同时双屏；恢复阶段重启probe，不证明同一应用故障后恢复。合入版仍待Windows重验、安装和发布。Snipaste 2.11.3仅确认MSAA局部静态链与父子几何规则，其UIA使用和跨应用识别率仍未知，见[调查报告](../../../../docs/snipaste-detection-research.md)。

## 回归方式

关键实现边界（版本差异在各项注明）：

- `main.ts`按窗口动态加载界面；空白主窗关闭使用前后端握手，先锁前端输入再释放WebView。任何图片、异步导入、OCR、更新或退出工作均阻止释放；macOS Reopen重建主窗。已有编辑关闭主窗仍保留会话。
- 退出请求总是向存活编辑器取最新状态，备份失败不得退出，备份成功后先flush最新原生状态再确认。安装器重启使用专用路径，不被普通退出门控拦截。
- macOS默认预定义Quit直接走terminate:，绕过Tauri ExitRequested。2026-10-29后续工作区用普通应用菜单项接管⌘Q，复用begin_exit，保留File/Edit/View/Window/Help菜单；独立应用用原创示例验证取消保留及备份退出。Dock菜单退出尚未接管，不将此路径算作已修复；当前日用本地构建已包含该修复。
- OCR只在用户点击后运行，输入为当前裁剪与已绘制对象；异步结果校验图片ID和编辑revision。Windows worker嵌入固定模型，标准输入/输出传图与结果、90秒超时、2线程，结束后释放进程。模型来源/哈希/独立许可见 `src-tauri/models/ocrs/NOTICE.md`。Windows源码构建先运行 `npm run models:prepare`，固定字节数与SHA校验后写入Git忽略的模型路径；CI仅Windows执行同一步骤，macOS构建和测试无需模型，安装版仍完全内置离线模型。0.3.1因原S3地址403改从独立`ocr-models-v1`预览Release下载原版镜像，原哈希及两模型合计12,226,852字节不变；该构建依赖不进入应用稳定更新通道。
- `redact`使用不透明黑色，覆盖所有对象后再绘制；2×渲染后按物理像素floor/ceil补绘防止插值暴露边缘。零面积草稿不进入渲染或会话。候选预览框和选中辅助线不进入导出。
- 2026-10-28工作区补充旧会话兼容：`editor.ts::isEmptyRedaction`仅识别有限坐标、非负尺寸且至少一边为0的遮盖，共用渲染管线及内部`serializeSession`忽略这类无面积对象，不修改原状态/撤销历史；原数量限制保留。负尺寸、非有限值、坏贴纸和外部`parseSession`/Rust恢复校验仍拒绝。`App.vue`将预览错误独立保存，重绘成功或切到空会话时清除，不覆盖保存等操作失败。此补丁不属于已发布0.3.1；验证见验证记录末节。
- PNG贴纸单个2MiB/2MP，全会话按对象实例合计8MiB/8MP；导入、移动恢复和undo/redo均先校验预算。预解码缓存按当前会话及撤销/重做可达对象回收；拖动首次实际位移才创建撤销点。
- 快捷键注册、OS开机启动和设置文件采用事务与回滚；插件autostart直通权限不开放给WebView。启动到托盘与开机启动分别保存/读取实际状态。
- macOS正式包的CFBundleName/CFBundleDisplayName为`Starshot`，权限列表显示`Starshot.app`，不能只引导用户找「星镜」。2026-10-28工作区将首次检查、截图失败、手动重查统一提示`Starshot（星镜）`；`get_app_status`只做权限预检，不触发截图。系统开关开启不等于当前进程预检通过，不能直接写成截图能力已验收；同标识测试包/重复构建也不能视作同一已授权实例。
- 2026-10-29「已授权仍拒绝」经系统诊断确认为旧TCC代码要求与当前ad-hoc包不匹配。`capture_permission`每次直接调用系统API，无应用缓存；拒绝发生在调用xcap之前。仅针对`com.starshot.desktop`重置录屏授权、重新添加固定app并启动后，原生预检通过；操作需有用户针对权限修复的授权，不能默认重置所有应用。过程与验收边界见[验证记录](../../../../docs/verification.md)。


`npm test`、`npm run build`、Rust `--no-default-features` 检查固定数据；桌面改动另跑 `cargo check --locked`、`cargo test --locked --lib`、fmt和平台打包，具体命令见README。

浏览器可验证Canvas真实像素、裁切/取消/撤销、图片背景/边框和下载；不能据此宣称原生截图、录屏权限、置顶透显、快捷键和多屏通过。所有测试素材为原创，导出的截图与临时验证脚本放Git忽略的 `artifacts/`，可复用回归脚本放 `tests/`。

`tests/browser-update-regression.mjs` 在已授权的Ego space/page运行原创像素与模拟IPC，覆盖备份/恢复失败保护、确认锁、固定安装版本和陈旧进度；脚本覆盖范围不等于已经执行通过，不能替代真实安装器验收。各版本构建和回归结果见 [验证记录](../../../../docs/verification.md)。

`src-tauri/tests/macos-updater-smoke.rs`默认忽略，需`updater-smoke` feature及`STARSHOT_UPDATER_SMOKE_DIR`指定真实发行产物；以mock runtime驱动真实Tauri updater，仅替换临时应用副本，检查损坏包拒绝、旧包保留和新版codesign。`tests/windows-installer-smoke.ps1`以最终NSIS做隔离升级、固定像素OCR和卸载检查；两者均不等于原生GUI下载、自动重启与会话恢复全流程，0.3.1实际执行结果见验证记录。


## Windows v3原生验收补充

同坐标重新进入覆盖层也必须重新查询；离屏清除待执行rAF移动并取消旧代数。诊断getter不能持Frame锁调度到UI线程。`windows_integration.rs`仅验收feature编译，在像素边界替换原创图，复用生产begin_capture；同进程19组原生断言、20次启动、两组各20轮跨屏和各10次超时/取消恢复见[验证详情](../../../../docs/windows-native-v3.md)。普通构建的三个验收CLI参数显式拒绝，测试IPC不在生产handler。
