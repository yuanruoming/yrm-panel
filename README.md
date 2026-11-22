# YRMPanel

**面向个人 Ubuntu / Debian Server 的 Web Desktop 与 NAS 管理面板。**

YRMPanel 通过浏览器提供桌面式窗口、文件管理、存储、SMB、Docker、网络及系统设置入口。它使用 Linux 已有的文件系统与系统服务，不是一套新操作系统，也不自行实现 Docker Engine 或 SMB 协议。

> **当前源码版本：** `1.0.0-beta.12.2`（以 [`YrmPanel.csproj`](YrmPanel/YrmPanel.csproj) 为准）。  
> **发布状态：** 开发测试阶段（Dev）；不能仅凭现有源码或自动化流程推断已通过正式版验收。  
> **项目详情、现状、已知问题、验收计划及交接：** [`PROJECT_HANDOFF.md`](PROJECT_HANDOFF.md)。

## 功能概览

| 功能 | 目前源码提供的能力 |
|---|---|
| Desktop | 壁纸、顶部状态栏、Taskbar、可管理的桌面窗口 |
| Files | Linux 真实目录浏览、My Files、Quick Access、上传、下载、文件操作及原生媒体预览 |
| SMB | 基于系统 Samba 的共享创建、查看、停止共享及只读选项 |
| Storage | 磁盘/分区发现、已有文件系统挂载与卸载；受控空盘初始化功能 |
| Docker | 通过 Docker Engine Socket 查询容器、状态、日志及受配置约束的启停操作 |
| Monitor | CPU、内存、网络等指标，使用服务端事件（SSE）和回退读取机制 |
| Settings | Overview、Storage、Network、Dynamic DNS、Firewall、Certificates、Appearance、About & Updates |
| Security | Linux PAM 登录、HTTPS、受限制的特权 Helper、防火墙与证书管理 |
| Updates | Dev / Stable 发布通道、Release 资产校验、安装失败恢复机制 |

表格仅描述**源码中存在的功能**，不代表所有功能已经在目标 Ubuntu 主机完成实机验收。Docker 的完整 Compose/Stack 编辑与生命周期、媒体转码、ACME 自动证书签发等不属于当前已确认的完整功能。

## 技术组成

```text
浏览器（桌面外壳、原生 JavaScript、CSS）
          │
          ├── Razor Pages / HTML 导航
          └── JSON / Fetch / SSE（部分动态接口）
                     │
             ASP.NET Core 10
                     │
       C# Services / 受控系统 Helper
                     │
 Linux 文件系统 / systemd / Samba / Docker / UFW
```

当前界面为 **Razor Pages + 原生 JavaScript**，不是 Vue/React SPA。Files、Settings 等导航仍有 HTML 请求、解析与局部 DOM 替换流程。性能和交互一致性仍属于需要验证和改进的项目目标；具体数据流与已知限制见交接档案。

## 运行环境

- **操作系统：** 使用 systemd 的 Ubuntu / Debian（安装脚本会检查）。
- **处理器：** AMD64（`linux-x64`）或 ARM64（`linux-arm64`）。
- **Linux 身份：** 选择一个**已经存在的普通 Linux 用户**；Web 服务不以 root 身份直接运行。
- **依赖：** 安装脚本检查并按需要配置 Docker Engine / Compose Plugin、Samba、UFW 及基础系统工具。执行安装前应了解它对系统服务和软件包的影响。
- **端口：** 默认 HTTP `6080`、HTTPS `6081`；实际安装值可配置。涉及 Linux 登录和管理操作时使用 HTTPS。

## 安装与更新

从 [GitHub Releases](https://github.com/yuanruoming/yrm-panel/releases) 核对目标通道及发布资产。初次安装脚本和运行脚本见 [`scripts/`](scripts/)；安装时需使用已有 Linux 用户，不要直接以 root 作为 Panel 用户。

开发通道的示例（需要在可信的 Ubuntu / Debian 主机上执行；请先核对脚本来源与内容）：

```bash
curl -fsSLo install.sh https://raw.githubusercontent.com/yuanruoming/yrm-panel/master/scripts/install.sh
sudo bash install.sh --repo yuanruoming/yrm-panel --branch master --channel dev --user <EXISTING_LINUX_USER>
```

已安装实例的更新入口由安装程序提供：

```bash
sudo yrm-panel-update
```

更新命令按照 `/etc/yrm-panel/source.env` 中的通道与参数执行。**首次安装、更新和稳定通道部署是不同流程**；稳定通道需要相应的已发布版本，不能仅靠把源码版本号改为 `1.0.0` 即视为正式发布。更新前应备份重要配置与数据，并确认当前 Release 和回滚能力。

当前源码的发行方式包括：

- `dev-release.yml`：主分支触发；依赖 E2E 和安装生命周期工作流，再构建/上传 Linux x64、ARM64 资产。
- `stable-release.yml`：由符合条件的版本 Tag 触发，并检查 Tag 与项目版本一致。
- `release.json`、SHA-256：用于资产完整性校验。**当前安装脚本中的 Minisign 可信公钥列表为空，不能宣称已强制实施数字签名验证。**

完整配置、数据路径、更新与恢复边界见 [`PROJECT_HANDOFF.md`](PROJECT_HANDOFF.md)。

## 验证与发布说明

源码中包含 Python 回归测试、JavaScript / Shell 检查、.NET 文件操作测试，以及 Ubuntu + Chromium E2E 与安装/升级/回滚/卸载生命周期工作流。

这些检查需要在对应提交的 GitHub Actions 页面查看**实际运行结果**；工作流文件存在不等于某次运行已经通过，也不等于特定实际服务器上的所有功能都已验证。正式版准入条件、未解决的问题及验收项目统一记录在 [`PROJECT_HANDOFF.md`](PROJECT_HANDOFF.md)。

## 文档及许可

- **本文件 `README.md`：** 项目对外定位、功能、安装与状态。
- **[`PROJECT_HANDOFF.md`](PROJECT_HANDOFF.md)：** 当前架构、技术决策、风险、测试范围、历史变更及后续工作记录。
- **[`LICENSE`](LICENSE)：** 项目许可；第三方组件许可文件仍按其原有目录保留。

版本历史以 Git 提交、Tag、Releases 和交接档案中的摘要为准，不再在根目录维护重复的 Beta 说明文档。
