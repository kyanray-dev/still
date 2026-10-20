# macOS 1.2.1

## 安装

系统要求为 macOS 14 Sonoma 或更新版本，包含 Apple Silicon 与 Intel 两种架构。
打开 `Still-1.2.1-macOS-universal.dmg`，把「留白.app」拖到 Applications，再从「应用程序」打开。也可完整解压 ZIP 后复制应用。

默认构建使用完整 app bundle 的 ad-hoc 签名；它能够检测应用内容被改动，但不是 Apple Developer ID 签名，尚未经过 Apple 公证。首次打开被阻止时，在确认来源及 SHA-256 后，使用「系统设置 → 隐私与安全性 → 仍要打开」。不要关闭 Gatekeeper 或 SIP。Apple 的说明：https://support.apple.com/102445 。

## 本次修复

旧包的 mac 二进制实际 deployment target 为 14.0，但 Info.plist 与下载说明宣称支持 13；现统一为 14.0。旧包只保留 arm64 linker 的临时签名，没有将 Info.plist 和资源封入完整 app 签名，Intel slice 没有签名。新包在 macOS 上完成整个 bundle 签名，并通过所有架构的严格校验，再生成 DMG 与保留权限、符号链接的 ZIP。

另一个独立问题是启动后原生崩溃。macOS 15.3.1 上，`objc_getProtocol("NSApplicationDelegate")` 可能返回空指针。Neutralino 6.10.0 未检查便调用 `class_addProtocol`，系统将空协议写入动态类的协议表；随后 AppKit 的 Touch Bar 路径执行 `conformsToProtocol:` 时发生 `EXC_BAD_ACCESS / 0x44`。已用不创建窗口的最小程序复现旧行为，并为 webview 和 tray 中的全部四处协议注册添加空值保护。只在协议存在时声明符合协议，已有 delegate 方法及回调保持正常。

补丁：[neutralino-null-protocol.patch](../installer/macos/neutralino-null-protocol.patch)。上游为 Neutralino 6.10.0，固定提交 `4361b63eb1157fc7dedb29b92815a08ec0002767`，依旧遵循上游 MIT 许可。原创项目仍为 0BSD。

此外修复 Retina 屏幕将 Cocoa points 再乘 backingScaleFactor 的重复缩放，以及窗口位置坐标混用物理像素的问题，避免窗口过大或移到屏幕外。补丁：[neutralino-cocoa-points.patch](../installer/macos/neutralino-cocoa-points.patch)。增加系统标准编辑菜单，支持 ⌘X/C/V/A；⌘Q 使用应用的未保存确认。

还修复 Intel 的 `CGRect` 结构体返回值调用约定：x86_64 使用 `objc_msgSend_stret`，arm64 保留 `objc_msgSend`，防止退出时保存窗口位置或截取窗口时崩溃。补丁：[neutralino-intel-rect-abi.patch](../installer/macos/neutralino-intel-rect-abi.patch)。非 UI 回归检查实际返回的矩形坐标与尺寸。

## Finder 打开 Markdown 文档

2026-10-20 补齐文件关联支持。安装包现在在 Info.plist 声明 Markdown（`.md`、`.markdown`、`.mdown`、`.mkd`）的 Editor 角色及导入 UTI，并声明可编辑纯文本。处理优先级为 Alternate；安装本身不会把所有纯文本默认应用改成留白。

原生补丁 [neutralino-open-files.patch](../installer/macos/neutralino-open-files.patch) 接收 AppKit 的 `application:openFiles:` 请求。首次启动时先缓存文件路径，前端安装 `filesOpened` 监听器后通过 `stillOpenFilesReady` 握手按顺序接收；已启动时直接在当前窗口打开，保留已有文档和草稿。不能只修改默认关联：缺少类型声明时系统拒绝打开，缺少原生事件处理时文件路径不会传入编辑器。

前端回归见 `tests/native-open.test.ts`；安装包回归校验实际 plist 的扩展名、角色和 UTI。实际验证需分别覆盖退出后打开文件、已启动时继续打开、同时打开多个文件及中文和空格路径。

本次本机验证：93 项单元测试、安装包/签名校验与原生协议/矩形 ABI 检查通过；四个原生补丁可从固定上游源码重新应用，结果与编译源码一致。在 Apple M1 上通过系统默认关联实际验证冷启动 `.md`、运行中 `.markdown`、一次打开多个文件及中文/空格/特殊字符文件名，并成功重新打开先前报错的原文档；SHA-256 确认原文档和测试文档内容均未改动。

## 可复现构建

需要 Node.js、Git、CMake 3.16+ 与 Xcode Command Line Tools，在 macOS 执行：

```sh
npm ci
npm run native:update
npm run test:mac-protocol
npm run build
npm run package:mac
npm run test:mac-package
```

`npm run build` 在 Mac 上自动从固定提交构建并应用原生补丁，目标为 `arm64;x86_64`、macOS 14.0。设置 `CMAKE` 可指定 CMake 完整路径。构建缓存位于 `.build-cache/neutralino-macos`；缓存中的提交、补丁与运行时摘要需要匹配，`native:update` 覆盖运行时后会重新安装补丁版。其他平台继续使用原有 Neutralino 构建方式。

输出为 DMG、ZIP 和 `SHA256SUMS-macOS.txt`。`npm run test:mac-package` 检查 plist、双架构、最低系统、签名、资源封装、校验文件、ZIP 解压、DMG 只读挂载、复制安装与卸载，并确认篡改资源后校验失败。结果位于 `test-results/macos-package/results.json`。签名测试通过不表示已通过 Gatekeeper 或 Apple 公证。

如有有效 Apple Developer ID 证书，可设置 `STILL_MACOS_SIGN_IDENTITY` 进行 hardened-runtime 签名；本脚本不自动执行公证，需要发布者另行提交并 staple。默认临时签名没有 Developer ID 与公证的系统信任。

## 验证范围

本地 macOS 15.3.1 / Apple M1：87 项单元测试、42 项 WebKit 界面测试通过；原生协议回归执行 4,000,000 次协议符合性检查通过。安装包结构与签名等自动检查单独记录。已从最终 DMG 复制到 `/Applications/留白.app`，核对安装后可执行文件与发布包摘要相同；实际验证中文路径读取、可视/源码编辑、⌘V 中文粘贴、⌘S 磁盘保存、重开读取、窗口关闭提示、⌘Q 保存确认、取消退出与保存后退出（退出码 0）。Intel slice 也在本机 Rosetta 下打开已保存内容并正常退出。完整交付记录见安装包旁的 `macOS-validation.json`。

未在物理 Intel Mac 或 macOS 14 机器上验证；双架构文件与最低系统要求由 Mach-O load commands 检查。未验证系统输入法组合输入与打印对话框。强制退出或 Dock 退出等路径仍可能绕过未保存提示，请先主动保存。
