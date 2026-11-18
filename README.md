# Agent Journal · Agent 日报周报助手

一款**零依赖、免构建、本地优先**的 Chrome / Edge 浏览器扩展。你在支持的 Agent 网页中发送问题后，扩展只记录提问原文，并在本地整理为可搜索、可筛选、可导出的日报与周报。

> 标题和摘要由本地文本规则提炼，不调用 AI，不上传内容，也不会伪装成 AI 生成结果。

## 功能

- 发送提问时自动记录：兼容发送按钮点击与 Enter；Shift+Enter 换行不会误记。
- 支持 textarea 与 contenteditable，使用事件委托适配 SPA 页面切换。
- click / Enter / click 连续触发自动去重，空内容不记录。
- 日报按本地自然日，周报按周一至周日；支持上一期、下一期与回到当前。
- 问题总数、活跃天数、使用 Agent 数统计；按时间分组查看。
- 搜索标题、摘要、原文与会话标题，或按 Agent 筛选。
- 查看本地摘要与提问原文；删除单条记录前有确认。
- 导出当前日报 / 周报为 Markdown；备份和导入完整 JSON。
- 导入时校验格式、合并并按内容指纹去重。
- 自动记录总开关、各 Agent 独立开关、浅色 / 深色 / 跟随系统主题。
- 点击浏览器工具栏中的扩展图标即可打开 Dashboard，无需启动服务器。

## 支持站点

| Agent | 域名 |
| --- | --- |
| ChatGPT | `chatgpt.com`、`chat.openai.com` |
| Claude | `claude.ai` |
| Gemini | `gemini.google.com` |
| DeepSeek | `chat.deepseek.com` |
| Kimi | `www.kimi.com`、`kimi.moonshot.cn` |
| 豆包 | `www.doubao.com` |
| 腾讯元宝 | `yuanbao.tencent.com` |
| 通义 | `www.tongyi.com`、`tongyi.aliyun.com` |

每个站点结合常用稳定属性、站点选择器与通用选择器兜底。网站改版后仍可能需要更新选择器，详见[贡献指南](CONTRIBUTING.md)。

## 安装：无需 npm，无需构建

### 方式一：下载源码 ZIP

1. 在 GitHub 项目页面点击 **Code → Download ZIP**，下载后解压。
2. Chrome 地址栏打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
3. 打开页面右上角的 **开发者模式**。
4. 点击 **加载已解压的扩展程序**，选择包含 `manifest.json` 的项目根目录。
5. 建议固定扩展图标。之后点击图标即可打开 Dashboard。

### 方式二：Git 克隆

```bash
git clone https://github.com/<your-name>/agent-journal.git
```

随后按上面第 2～5 步加载项目根目录。安装和使用都不需要执行 `npm install`。

## 使用

1. 在支持网站正常登录并提问。扩展只观察输入区域与发送动作，不读取 Agent 回答。
2. 点击工具栏的 Agent Journal 图标，查看今日日报。
3. 切换“日报 / 周报”或使用箭头导航历史周期。
4. 用搜索框和 Agent 下拉框缩小记录范围；展开“查看提问原文”核对内容。
5. 点击“导出本期 Markdown”保存当前周期；点击“备份全部数据”导出 JSON。
6. 在另一浏览器配置中，通过“导入 JSON”合并备份。重复记录会被跳过。
7. 在“记录设置”中暂停全部记录、停用单个 Agent 或切换主题。

## 隐私与安全

- 数据只保存在 `chrome.storage.local`，没有远程后端、分析脚本、远程代码或 CDN。
- 仅申请 `storage` 权限和支持站点的 host 权限；导出使用浏览器 Blob，不申请 `downloads` 权限。
- 只在发送动作发生时读取当前提问输入，**不读取回答或整页对话**。
- URL 仅保留 HTTP(S) 的协议、域名和路径，移除账号凭据、查询参数及 hash，降低泄露 token 等敏感信息的风险。
- Dashboard 中用户文本统一通过 `textContent` 渲染；Markdown 对 HTML 与标记字符转义，并使用安全代码围栏展示原文。
- 本地存储不等于加密。共用浏览器用户配置的设备上，请自行评估物理访问风险，并定期备份后清理敏感记录。

## 目录结构

```text
agent-journal/
├── manifest.json          # MV3 配置与最小权限
├── background.js          # 点击图标、集中写入与二次开关校验
├── content.js             # 提问事件捕获、站点适配与短时去重
├── dashboard.html         # Dashboard 与设置界面
├── dashboard.css          # 响应式明暗主题样式
├── dashboard.js           # 渲染、导航、筛选、导入导出
├── lib/
│   ├── core.js            # 日期、摘要、聚合、校验等纯逻辑
│   └── storage.js         # chrome.storage.local 异步封装
├── icons/                 # 本地 PNG 图标
├── tests/core.test.js     # Node 内置测试，不是扩展运行依赖
└── MANUAL_TESTING.md      # 最小手工验收清单
```

## 自动化测试

需要 Node.js 18 或更新版本，仅用于开发验证；运行扩展不需要 Node。

```bash
node --test tests/core.test.js
npm test
npm run check
```

测试覆盖日期与周边界、摘要、统计筛选、URL 清洗、导入校验、合并去重及 Markdown 安全。网站真实 DOM 交互仍需按 [MANUAL_TESTING.md](MANUAL_TESTING.md) 在浏览器验证。

## 常见问题

**发送后没有记录？** 确认 Dashboard 的总开关和对应 Agent 开关已开启；刷新 Agent 网页后再试。网站若刚改版，选择器可能失效，请查看贡献指南。

**为什么标题和摘要比较简单？** 这是刻意的隐私设计：只使用本地截句与长度边界规则，不请求大模型。

**会记录回答吗？** 不会。内容脚本只读取发送时的提问输入控件。

**为什么原页面链接缺少参数？** 为避免把会话 token、搜索内容等敏感参数写入备份，所有 query 和 hash 都会被移除。

**清除浏览器数据会怎样？** 可能同时删除扩展本地数据。重要记录请定期使用“备份全部数据”。

**可以同步到其他设备吗？** 当前版本不自动同步，以避免远端依赖；可通过 JSON 手动迁移。

## 发布到 GitHub

1. 在 GitHub 新建空仓库，例如 `agent-journal`，不要添加冲突的初始文件。
2. 在项目根目录执行：

```bash
git init
git add .
git commit -m "feat: initial Agent Journal release"
git branch -M main
git remote add origin https://github.com/<your-name>/agent-journal.git
git push -u origin main
```

3. 在 GitHub **Releases → Create a new release** 创建 `v1.0.0`，写清功能与已知限制。
4. 可使用 GitHub 自动生成的 Source code ZIP 作为免构建安装包；上传前本地验证 ZIP 解压后可直接加载。
5. 后续选择器修复请更新版本号、README 支持情况和发布说明。

## 贡献与许可

欢迎修复站点选择器、补充纯逻辑测试和改进可访问性。提交前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，不要提交真实提问备份或包含敏感信息的测试数据。

本项目使用 [MIT License](LICENSE)。
