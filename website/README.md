# 留白 Still 官网

官网域名为 **https://still.kyan.uno/**。这是独立的 Vite 静态网站，以 Three.js 纸面和真实应用截图展示留白，并通过同域 `/downloads/` 提供安装包。

页面没有登录、文档上传或服务器业务后端。脚本、样式、字体、Three.js 和图标都随构建产物提供；访问网站无需第三方字体或脚本 CDN。

## 本地开发与构建

在仓库根目录执行以下命令。Node.js 应满足根目录 `package.json` 的 `engines` 要求；推荐 Node.js 22.22.2+ 的 22.x 或 24.15+ 的 24.x。

```sh
cd website
npm ci
npm run prepare:downloads -- --macos-source ../release
npm run verify:downloads
npm run build
npm run preview
```

`--macos-source` 指向含有下表两个已验证 macOS 产物的目录。开发时运行 `npm run dev`，预览构建产物时运行 `npm run preview`，以终端输出的本机地址为准。两者默认仅监听 `127.0.0.1`。`npm run build` 输出到 `dist/`，并将 `public/` 内资源复制进去；构建不会自行下载缺失的安装包，发布前需先完成准备和校验。

## 安装包与完整性

macOS 与 Windows 目前分别提供 **1.2.1** 和 **1.2.0**，页面分别标注，不将源码版本等同于所有平台的公开最新版本。

| 文件名 | 版本 | 大小（字节） | SHA-256 |
| --- | --- | ---: | --- |
| `Still-1.2.1-macOS-universal.dmg` | macOS 1.2.1 | 3,004,539 | `3fe3f86f5c366fd43aaba0e27d599eec756fa1ffa5e1fe5fed9323f7b6e8719c` |
| `Still-1.2.1-macOS-universal.zip` | macOS 1.2.1 | 2,769,447 | `980ab5bd7caf193cdaeb816c2b6ad354b70a803eb7ccbc117506c2d1a4c756fe` |
| `Still-1.2.0-Windows-x64-Setup.exe` | Windows 1.2.0 | 5,289,619 | `5cbc0ee3a568141c57c02607edcd14f3ad154fb1fc047ca05ed51605849b927f` |
| `Still-1.2.0-Windows-x64.zip` | Windows 1.2.0 | 2,008,740 | `ecf30648b5668f22e6740a698e9ad8b8990bc222d2dc7cfd56ce7f3b9cd69231` |

`scripts/prepare-downloads.mjs` 固定上述文件名、大小、摘要和 Windows 官方 GitHub 发行下载地址。准备流程会：

1. 校验 `public/downloads/` 中已有文件，完整匹配时直接复用。
2. 从指定源目录复制 macOS 包；从 `kyanray-dev/still` 的 `v1.2.0` 官方发行页下载 Windows 包。
3. 对所有新增文件完整核对字节数和 SHA-256，成功后才以正式文件名落盘。
4. 生成 `public/downloads.json` 和 `public/downloads/SHA256SUMS.txt`。

macOS 源目录按 `--macos-source <目录>`、环境变量 `STILL_RELEASE_DIR`、仓库的 `release/` 顺序选择。后者相对于 `website/` 为 `../release`。也可这样使用环境变量：

```sh
STILL_RELEASE_DIR=../release npm run prepare:downloads
```

`npm run verify:downloads` 只读校验四个包和两个 manifest，不联网下载、不修改文件。安装包和生成的校验文本被 `website/.gitignore` 忽略；`public/downloads/.gitkeep` 与 `public/downloads.json` 参与版本管理。新的部署环境需重新准备安装包，不能只依赖 Git 检出。

所有安装包地址均为 `/downloads/<原始文件名>`，摘要入口为 `/downloads/SHA256SUMS.txt`。macOS 要求 14 及以上，支持 Apple Silicon 与 Intel，当前包为临时签名且未经 Apple 公证；Windows 要求 Windows 10 / 11 x64，包未签名。Windows ZIP 需要已有 WebView2 Runtime；安装版缺少运行时时会启动微软官方引导程序联网安装。

更新下载版本时，同步调整准备脚本的固定元数据、`index.html` 中的平台信息与下载链接、`src/main.js` 中的推荐地址和本表，然后重新生成、验证和构建。不要将私钥、个人原文档、服务器 IP、真实本机绝对路径或部署配置放入 `public/` 或 `dist/`。

## 外观与动效

网站默认跟随系统浅色/深色外观，导航中的切换按钮可覆盖选择；偏好保存在本机 `localStorage` 的 `still-site-theme` 中。真实产品截图随外观切换。

Three.js 在浏览器空闲时延迟加载两层画面：首屏纸面以约 10.8 秒的周期起伏，卷角与侧光同步变化，最高约 30 帧/秒、像素比最高 1.7；全屏背景是 GPU 变形的三维波面，以缓慢流动的光影衬托静止文字，最高约 24 帧/秒、桌面像素比最高 1.25、手机最高 1。纸面离开视口时停止连续绘制；两层画面在标签页进入后台时均暂停，页脚暂停按钮同时控制它们。系统启用 `prefers-reduced-motion` 时两层保持静态，并关闭平滑滚动和入场动画。

WebGL 不可用、场景初始化失败或渲染上下文丢失时，显示 CSS 静态纸面。禁用 JavaScript 后仍可阅读页面和点击各平台下载链接。自动推荐按钮仅为桌面 Windows 或 macOS 选择对应安装包；其他平台和识别为 iPad 的设备保留下载区入口。

## 部署

将经过页面检查与安装包校验的静态产物部署到现有服务器，正式域名为 `still.kyan.uno`。Nginx 配置、证书申请与续期、安装包独立目录、发布验证和回滚步骤见 [deploy/README.md](deploy/README.md)。`npm run preview` 仅用于本地预览。

源文件主要位于 `index.html`、`src/main.js`、`src/style.css` 与 `src/paper.js`、`src/ambient.js`；设计约束见 [DESIGN.md](DESIGN.md)。应用截图与图标来自本仓库现有公开产品资源。
