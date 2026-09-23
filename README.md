# ⚠️ 重要声明

本项目为个人业余AI辅助开发项目，是 [Caread 桌面版](https://gitee.com/star-movement-three-autumn/Caread)的平板/移动端打包工程。**本仓库完全独立**：已内置全部网页资源与离线词典，克隆后无需桌面版仓库即可构建 APK。

- 项目**可运行**，但可能存在未知问题或边界情况
- **深度使用**或用于**商业生产环境**时，请自行评估风险
- 欢迎 fork、修改、提PR，但不承诺提供长期维护支持

> 你已被充分告知。:)

 <img src="assets/ic_launcher.png" width="128" valign="middle" alt="Caread"> 

 # Caread Mobile

> Caread 的 **Android 平板端**：基于 [Capacitor](https://capacitorjs.com/) 把桌面版的 Web 资源打包成 APK，在平板上提供点词查义、荧光标注、画笔批注等完整精读体验。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Capacitor](https://img.shields.io/badge/Capacitor-7-119EFF.svg)](https://capacitorjs.com/)
[![Platform](https://img.shields.io/badge/Platform-Android-green.svg)]()

---

## 工作原理

仓库内已包含**可直接构建的完整产物**（`www/` 与瘦身词典均已入库），克隆后无需任何生成步骤：

```
www/（网页资源 + Quill/mammoth + 38MB 瘦身词典，已入库）
   │
   │  npx cap sync   复制进安卓工程 assets
   ▼
android/（Capacitor 原生工程）→ Gradle Build → app-debug.apk
```

`build-dict.js` / `build-www.js` 两个脚本仅供**开发者**使用：网页源码维护在[桌面版仓库](https://gitee.com/star-movement-three-autumn/Caread)中，改动后通过脚本重新组装 `www/` 并提交更新（见[日常更新流程](#日常更新流程)）。

## 目录

- [环境要求](#环境要求)
- [首次构建](#首次构建)
- [日常更新流程](#日常更新流程)
- [命令行构建（免开 Android Studio）](#命令行构建免开-android-studio)
- [平板端特性](#平板端特性)
- [项目结构](#项目结构)
- [常见问题](#常见问题)
- [许可证](#许可证)

---

## 环境要求

- [Node.js](https://nodejs.org/) ≥ 18（含 npm）
- [Android Studio](https://developer.android.com/studio)（自带 JBR/JDK，首次用于同步 Gradle 与出正式包）
- Android SDK（Android Studio 首次启动时会自动安装）
- Android 6.0+（minSdkVersion 23）的平板或手机；建议保持系统 WebView 为最新版本

## 首次构建

```bash
# 1. 克隆本仓库（独立仓库，无需桌面版）
git clone https://gitee.com/star-movement-three-autumn/caread-mobile.git
cd caread-mobile

# 2. 安装依赖
npm install

# 3. 构建 APK
npm run open        # 打开 Android Studio → Build → Build APK(s)
```

APK 产物路径：`android\app\build\outputs\apk\debug\app-debug.apk`

安装到设备：把 APK 拷到平板安装（需允许「未知来源」），或 USB 连接后：

```bash
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

## 日常更新流程

> 面向开发者。普通用户只需拉取本仓库，无需关心桌面版。

网页代码在[桌面版仓库](https://gitee.com/star-movement-three-autumn/Caread)中修改（需与本工程同级目录，如 `D:\EngRead` 与 `D:\CareadMobile`），然后：

```bash
cd D:\CareadMobile
npm run sync        # 重组 www + 同步进安卓工程
```

把更新的 `www/` 提交入库，再 Build APK 安装即可。

## 命令行构建（免开 Android Studio）

系统未配置 `JAVA_HOME` 时，直接运行 `gradlew` 会报 `JAVA_HOME is not set`（找不到 java）。使用 Android Studio 自带的 JBR：

```powershell
$env:JAVA_HOME = "D:\Android Studio\jbr"   # 或任意 JDK 17 路径
cd android
.\gradlew.bat assembleDebug
```

首次构建如卡在 Gradle 下载，本工程已配置国内镜像：

- Gradle 分发包：腾讯云镜像（`gradle\wrapper\gradle-wrapper.properties`）
- Maven 依赖：阿里云镜像（`android\build.gradle`）

若仍卡住，可清理缓存后重试：删除 `C:\Users\27707\.gradle\wrapper\dists` 下对应版本文件夹。

## 平板端特性

与桌面版的功能差异与触屏适配：

| 场景 | 行为 |
| --- | --- |
| 选词菜单 | 触屏无右键，**长按**选中文字后点浮动「⋯」按钮，功能与右键菜单一致 |
| 查词 | 点词出释义卡片；词典首次查询时懒加载进内存（约 1~2 秒），之后秒查 |
| 缩放 | 底部状态栏缩放滑条，与桌面版一致 |
| 画笔 | Pointer Events 实现，手指与触控笔均可；触控笔书写时手掌防误触 |
| 作画手势 | 画布区域禁用滚动/缩放手势干扰 |
| 页面手势 | 禁用双击/捏合缩放，避免误触 |
| 窗口按钮 | 隐藏最小化/最大化/关闭按钮（非 Electron 环境） |
| 开始页 | 启动只有开始页、无标签，首次产生内容时自动创建标签（与桌面版一致） |
| 应用图标 | 标题栏与开始页显示应用图标；安卓桌面为自适应图标（「C」标志前景 + 深蓝背景层） |
| 文件导入 | 使用系统文件选择器；Word 导入懒加载 mammoth |
| 工作区保存 | 保存到相册/文件，或 OPFS 本地存储 |
| 在线导入 | 优先走 Capacitor 原生 HTTP（无 CORS 限制），纯浏览器环境降级 fetch |

## 项目结构

```
CareadMobile/
├── build-dict.js           # 词典瘦身脚本：桌面版全量 ECDICT → data/dict-slim.json
├── build-www.js            # www 组装脚本：从 ..\EngRead 复制网页资源与应用图标进 www/
├── capacitor.config.json   # Capacitor 配置（appId: com.caread.app, webDir: www）
├── package.json            # 脚本：build:dict / build:www / sync / open
├── data/                   # 构建中间产物（dict-slim.json 不入库，用 build:dict 重新生成）
├── www/                    # 网页资源 + 瘦身词典（已入库，开发者改动后重新生成提交）
└── android/                # Capacitor 生成的原生安卓工程（Android Studio 打开）
    ├── build.gradle        # 阿里云 Maven 镜像
    ├── gradle/wrapper/     # 腾讯云 Gradle 镜像
    └── app/
```

## 常见问题

**Q: 首次查词慢？**
正常现象。38MB 瘦身词典在首次查询时才加载进内存，约 1~2 秒，之后为内存 Map 直查。

**Q: 克隆后没有词典？**
不会，随 APK 打包的瘦身词典已直接入库（位于 `www/data/`，仓库约 40MB）。仅开发者在改了桌面版网页代码后，才需按 [日常更新流程](#日常更新流程) 执行 `npm run sync` 重新生成并提交。

**Q: npm install 报漏洞警告？**
当前依赖存在约 18 个 npm audit 提示，不影响功能，可忽略。

**Q: 支持手机竖屏吗？**
以平板横屏使用为主，窄屏下侧栏暂未做抽屉式适配（路线图）。

## 许可证

[MIT](LICENSE) © 2026
