# 星镜版本、更新与发布

源码与下载仓库：[cpython666/starshot](https://github.com/cpython666/starshot)。用户已确认使用公开仓库承载更新下载。应用只在手动检查或下载更新时访问 GitHub，不在启动时联网，不上传图片或编辑内容。

## 版本控制

采用稳定三段版本 `主版本.次版本.修订版本`，Git 标签为 `vX.Y.Z`。`scripts/version.mjs` 同时校验 package.json、package-lock.json 的两个版本位置、Cargo.toml、Cargo.lock 与 tauri.conf.json；升版必须严格递增，不修改依赖版本。

```sh
npm run version:check
npm run version:bump -- 0.3.1
npm run version:check -- v0.3.1
```

升版后更新 CHANGELOG.md，并完成测试、构建、提交和审核。版本号一致不代表版本已经发布。

## 应用内更新与恢复

「设置 → 软件更新与会话恢复」提供手动检查、版本说明与下载进度。从0.2.2开始采用两步更新：点击更新只下载和校验签名；成功后弹出「安装并重启」，用户确认后才备份、安装并自动重启。下载失败或验签不通过不会进入安装确认。候选版本在下载与安装确认时分别固定，过期状态不能覆盖新进度。正式包通过 Tauri 官方 updater 校验签名及签名绑定的版本，只接收本仓库 Release 下载地址。

选择「稍后安装」会恢复正常编辑，本次运行中保留已验签的安装包，可再次打开安装确认；退出应用或重新检查版本会清空该缓存，需要重新下载。下载阶段不保存会话、不安装、不重启。点击「安装并重启」时才获取最新编辑状态，依次保存会话恢复点与旧应用副本，任何一步失败都会停止安装；备份失败仍可重试已下载的包。

下载、安装确认和安装过程中暂停截图、贴图和编辑操作，包含全局快捷键与托盘入口。安装确认状态由原生端持有，选择稍后安装成功后才恢复操作；重新打开确认时先检查没有正在进行的截图，避免新截图遗漏于备份。Windows 安装器接管应用退出并重新打开新版；若启动失败但应用资源已清理，将释放单实例锁并重新打开旧版，可从已保存恢复点继续。若系统连旧版进程都无法启动，需要手动重开。macOS 安装完成后自动重启，无需再点一次按钮；恢复编辑会话仍由用户手动选择本地恢复点。

恢复点保存在本机应用数据目录 `recovery/`，包含当前最多6张原图、标注、裁剪、美化配置、本地背景和界面主题，并记录版本、校验和与时间。可手动创建或恢复，恢复前先备份当前会话；解析、校验和图片解码全部成功后才替换编辑器内容。不会保存撤销历史、置顶贴图窗口，也不会自动载入或上传恢复点。0.3.0新写schema2，包含PNG贴纸与实心遮盖，读取旧schema1只在内存归一化，不改旧文件。平时仍只保留内存会话；明确备份、退出前选择备份或安装更新才持久保存图片。恢复点可能包含完整原图，应由用户妥善保管。

旧应用副本保存在 `application-backups/`，macOS 为应用包，Windows 为主可执行文件。它是故障处理留存，不等于已实现一键降级；Windows 的完整安装回退仍应使用上一版本安装包。恢复编辑会话不会自动更换应用版本。0.3.0可查看恢复点与旧应用的空间占用，明确删除一组对应文件；无默认自动清理，目录异常或符号链接会拒绝删除。

0.1.0 没有 updater，首次升级到当前新版需要手动安装；0.2.0及之后的版本才具备应用内更新能力。没有已公开的更新包时，检查会显示服务不可用/未发布等错误，不会伪报“已是最新版”。

## 签名与 GitHub Actions

星镜使用独立的 Tauri 更新签名密钥，不与其他产品共用。公钥位于 tauri.conf.json，私钥保存在仓库外的 `~/.local/share/starshot-release/updater.key`（目录0700、文件0600）以及 GitHub Actions 的 `TAURI_SIGNING_PRIVATE_KEY` Secret；当前密钥无附加密码。该本机文件应另做安全备份，Actions Secret 不能读回原值。需加密密码时另配置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。不得把私钥、备份、用户图片或日志放入 Git。

- `verify.yml`：每次推送/PR校验版本、前后端测试、格式与 macOS Apple Silicon / Windows x64 打包，不需要发行密钥；独立脚本任务执行真实 minisign 验签回归。
- `release.yml`：已有 `vX.Y.Z` 标签触发，或手动指定已有标签；版本、提交与标签匹配后构建两个平台，要求签名密钥。
- `release-manifest.mjs`：要求完整且唯一的平台产物，真实验签并核对版本绑定，然后生成 latest.json、SHA256SUMS 和发布说明。
- 流程只创建/更新 Release 草稿，不自动公开；拒绝覆盖已发布的同版本 Release 及已有草稿资产。已有资产的草稿需要重跑时，先人工检查并删除旧草稿，流程不会覆盖文件。

2026-11-10准备0.3.2时，两个旧`macos-14`作业在执行任何步骤前被取消，GitHub注释为`The configuration 'macos-14-arm64-us-default' is not supported`。GitHub已于2026-11-02停用该镜像，现将普通验证与签名发行改为`macos-15`（arm64）；来源为[官方退役公告](https://github.com/actions/runner-images/issues/13518)。已有发行标签不重写：从修正后的`main`手动运行`release.yml`并传入原标签，工作流仍检出标签所指源码并校验版本/提交。

Windows构建模型由 `scripts/prepare-ocr-models.mjs` 下载；macOS使用系统Vision，构建/测试不需要下载这些模型。Windows专用依赖由Cargo目标配置选择，模型许可资源只在`tauri.windows.conf.json`中声明，Mac包不附带。2026-10-28上游原地址返回403，现从独立的 `ocr-models-v1` 构建依赖Release获取已核验的原版副本；大小、SHA-256与0.3.0内置模型完全一致，保留作者、原始来源与CC-BY-SA-4.0许可。该Release标为prerelease，不进入应用稳定更新通道；不要将模型二进制加入Git或改成运行时下载。

0.3.1的Windows CI先校验并安装公开0.3.0，再用最终NSIS执行隔离升级，检查版本、卸载登记、固定像素OCR与卸载清理。macOS可在本机运行下列默认忽略的测试：目录中放公开0.3.0的 `Starshot.app`、候选版 `latest.json` 和对应已签名 `.app.tar.gz`，测试仅替换临时副本，并检查损坏包被拒绝、旧包不变和新版签名完整性。两项均不等同于应用GUI的下载、重启及会话恢复验收。

```sh
STARSHOT_UPDATER_SMOKE_DIR="$PWD/artifacts/release-0.3.1/macos-updater-smoke" \
  cargo test --locked --manifest-path src-tauri/Cargo.toml \
  --features updater-smoke --test macos-updater-smoke -- --ignored --nocapture
```

预期产物为 macOS 的 DMG / app.tar.gz / 签名，Windows 的 NSIS exe / 签名。`latest.json` 同时包含 `darwin-aarch64` 与 `windows-x86_64`。稳定更新地址为 `https://github.com/cpython666/starshot/releases/latest/download/latest.json`，Release 必须公开且成为最新稳定版本才能用于客户端更新。

Tauri 更新签名与平台代码签名不是同一件事。目前 macOS 默认 ad-hoc 签名，未 Apple 公证；Windows 未配置发行者证书。macOS 可配置 APPLE_SIGNING_IDENTITY、APPLE_CERTIFICATE、APPLE_CERTIFICATE_PASSWORD 以及 APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID。未取得平台证书不能声称已解决 Gatekeeper 或 SmartScreen 提示。

## 每次正式发布前

1. 升版并写变更记录；运行本地检查和双平台 CI。
2. 对候选安装包做两平台安装、旧版升级、签名损坏拒绝、备份失败停止、重启和会话恢复验收。开发构建或模拟 IPC 不能替代此项。
3. 创建并推送对应标签，让流程生成草稿；核对两平台文件、校验和、发布说明。
4. 确认验收完成后，手动发布草稿为最新稳定版。首次公开发布须由用户明确决定。

当前执行过的检查与尚未验证项以 docs/verification.md 为准。

## 当前公开版本：0.3.2

[v0.3.2](https://github.com/cpython666/starshot/releases/tag/v0.3.2)于2026-11-10 16:26:09 UTC（北京时间11月11日00:26:09）公开为稳定latest，标签源码为`54d880b`。macOS Apple Silicon与Windows x64安装包、独立Tauri更新签名、latest.json及SHA256SUMS共8个附件齐全；公开API中每个附件的SHA-256与已核验CI文件一致，匿名稳定清单下载也与CI文件逐字节一致。

普通双平台验证[42847325913](https://github.com/cpython666/starshot/actions/runs/42847325913)全部成功；签名发行[42847334356](https://github.com/cpython666/starshot/actions/runs/42847334356)的版本/测试、双平台构建和真实minisign汇总验签均成功，但两次在创建草稿时收到`Resource not accessible by integration`（403），整个签名工作流不是成功状态。当前账号预建空草稿后，CI仍不能复用它；最终由用户本次发布授权下的已登录账号上传完整验签产物并公开，没有扩大发行Secret或降低校验要求。保留原标签，不覆盖既有版本或资产。下次发布如仍遇同类权限问题，可核验完整CI产物后使用已获授权的账号完成草稿和公开操作，不把控制面失败记成构建或验签失败，也不反过来宣称整个流水线全绿。

Windows最终NSIS通过0.3.0→0.3.2隔离升级、固定原创像素OCR、登记及卸载检查；macOS最终CI包通过DMG只读挂载、版本/架构/严格codesign，以及真实updater在临时0.3.0副本上的损坏包拒绝与签名0.3.2安装。以上不覆盖原生GUI下载/重启/真实会话恢复或长截图生产采集全流程。Homebrew Cask已同步到`9ff014c`；本次没有安装或替换`/Applications/Starshot.app`，平台签名/公证和原生验收限制保留。

## 历史公开版本：0.3.1

[v0.3.1](https://github.com/cpython666/starshot/releases/tag/v0.3.1)于2026-10-28 12:15:48 UTC公开，源码标签为 `fe609e8`，`draft=false`、`prerelease=false`，已设为latest。普通验证40681522684与签名发行40683246836全部通过；公开稳定清单与CI最终文件逐字节一致，运行中的0.3.0原生应用实际显示发现0.3.1。Homebrew Tap已同步到 `98abcab`，在线审查、下载及隔离安装/卸载通过。

Windows实际安装器升级与macOS临时副本更新安装已验证。随后在用户确认当前编辑已保存、可清空后，旧Verify空会话完成了原生GUI下载、验签、安装及自动重启，用户确认界面正常。真实图片会话恢复、Windows GUI完整更新与失败后重启、混合DPI及全部原生交互仍未全部验收。独立验收包 `com.starshot.verify-030` 与正式包使用不同数据目录，不能假定旧验收恢复点自动迁移。具体包哈希与验收记录见[验证记录](verification.md)。

2026-10-29本机入口统一为`/Applications/Starshot.app`，仍标0.3.1，但含尚未公开的空遮盖兼容与权限提示补丁；它与上述公开发行包不同。随后确认旧录屏授权与新ad-hoc代码身份不匹配，按用户授权仅重置星镜并重新登记后，原生权限预检通过；尚未实际截图验收。后续补丁分发、双平台验证、稳定平台签名及临时副本管理见[本机修复版与待办](../.agents/skills/starshot/references/releases.md#本机修复版与后续待办2026-10-29)。

## 历史：0.3.0 Homebrew开发预览

用户明确要求完成Homebrew分发。[v0.3.0](https://github.com/cpython666/starshot/releases/tag/v0.3.0)已于2026-10-26 17:23:11 UTC公开为prerelease，标签对应源码 `cd7a691`。双平台安装包、Tauri更新签名与校验清单齐全，Cask已在 `cpython666/homebrew-tap` 的 `0b2d188`发布并通过隔离安装/卸载；没有设为最新稳定版。预览版不改变应用内稳定更新地址，也不等于旧版升级、平台签名或全部原生矩阵已经验收。实际发布结果见[Homebrew指南](homebrew.md)与[验证记录](verification.md)。
