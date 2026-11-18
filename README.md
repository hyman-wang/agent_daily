# Agent Journal

本地 Agent 日报 / 周报助手：**Hook 自动采集 + 精简本地存储 + 静态 HTML 报告**。
适用于 WorkBuddy / CodeBuddy、Claude Code 等本机 Agent，不需要服务器、不需要部署。

---

## 1. 核心链路

```text
配置页 index.html
        ↓ 导出 agent-journal.config.json
python install.py
        ↓ 备份并合并 Hook
Agent 提问
        ↓ UserPromptSubmit 注入上下文
Agent 回答
        ↓ Stop 解析本轮摘要
本地 JSONL
        ↓ 需求级聚合
静态 HTML 日报 / 周报 / 索引
```

特点：

- **一次提问只调用一次主模型**：正常回答与结构化摘要在同一次请求中完成。
- **需求级聚合**：同一项目、同一需求的多次提问滚动合并，不生成流水账。
- **精简存储**：只保存问题摘要、结果摘要、关键点、涉及文件、测试状态和元数据。
- **静态报告**：双击 `~/.agent-journal/reports/index.html` 即可查看，无服务、无 CDN。
- **安全安装卸载**：安装前备份配置；卸载只移除本项目 Hook/Skill，默认保留报告数据。

---

## 2. 快速开始

### 环境要求

- Python 3.10+
- Windows 下 Agent Hook 需要 Git Bash
- 支持 WorkBuddy / CodeBuddy、Claude Code

### 安装

```bash
git clone https://github.com/hyman-wang/agent_daily.git
cd agent_daily
python install.py
```

如需自定义配置：

1. 双击 `index.html`，进入“配置中心”
2. 选择 Hook / Skill / 记忆等方式并调整参数
3. 点击“导出 JSON”，把 `agent-journal.config.json` 放到项目根目录
4. 执行：

```bash
python install.py --config agent-journal.config.json
```

安装完成后，**重启 Agent 或新开任务**，再发起一次测试提问。

### 查看报告

```bash
python -m agent_journal open
```

或直接双击：

```text
~/.agent-journal/reports/index.html
```

### 检查状态

```bash
python -m agent_journal status
```

### 重建报告

```bash
python -m agent_journal report
```

---

## 3. 目录结构

```text
agent_journal/          本地采集、存储、报告和安装器
skills/agent-journal/   手动操作 Skill
index.html              单文件配置与报告界面原型
install.py              安装入口
uninstall.py            卸载入口
tests/                  自动化测试
```

### 数据目录

默认目录：`~/.agent-journal/`

```text
~/.agent-journal/
├── data/
│   ├── turns.jsonl          # 每轮精简问题/结果摘要
│   └── requirements.jsonl   # 需求级累计摘要快照
├── reports/
│   ├── index.html           # 总索引
│   ├── daily/               # 日报
│   └── weekly/              # 周报
├── backups/                 # 安装前配置备份
├── logs/                    # Hook 本地诊断日志
└── agent-journal.py         # 手动操作入口
```

---

## 4. 报告展示

- **默认按需求聚合**，不是每次提问一条流水账
- 每条需求显示：
  - 需求标题
  - 累计摘要
  - 关键点
  - 涉及文件
  - 测试状态
  - 标签
  - 提问次数
  - 最近更新时间
- 可选展开提问明细，查看每轮问/答摘要
- 报告页为纯静态 HTML，支持 `file://` 直接打开

---

## 5. 安全与隐私

- 数据只保存在本机，无云端同步、无遥测、无远程服务
- 默认不保存：
  - 完整回答原文
  - 中间回复
  - 思考过程
  - 工具输出
  - 命令日志
- Hook 错误不会阻断 Agent 正常提问
- 安装前会备份原 Agent 配置
- 卸载只移除本项目 Hook/Skill，**默认保留报告数据**
- 模型会收到 Hook 注入的需求摘要；如果使用云端模型，这部分上下文也会发送给对应服务商

---

## 6. 卸载

```bash
python uninstall.py
```

默认只移除本项目添加的 Hook 和 Skill，保留已有配置及报告数据。

```bash
python uninstall.py --purge
```

仅在明确需要时彻底删除 Agent Journal 数据目录。

---

## 7. 测试

```bash
npm test
```

覆盖：

- Markdown 安全
- 日期与周报聚合
- 日报/周报筛选、搜索、统计
- 导入校验与去重
- Hook 输入输出协议
- 问答写入与需求聚合
- 重复 Stop 去重
- 静态报告生成
- 安装幂等与已有 Hook 保留

---

## 8. 当前限制

- 首版仅支持 WorkBuddy / CodeBuddy、Claude Code
- Codex CLI、Gemini CLI、Cursor、Windsurf 需逐项核实 Hook 与 transcript 能力后适配
- 模型偶尔可能未按约定输出结构化摘要，此时记录会标记为“待整理”，不会伪造摘要
- 网站或 Agent 界面改版后，可能需要更新适配逻辑

---

## License

MIT
