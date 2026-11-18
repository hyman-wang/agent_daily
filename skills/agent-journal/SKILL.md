---
name: agent-journal
display_name: Agent Journal 日报周报
display_name_en: Agent Journal
description: 打开、重建、检查或导出本地 Agent 日报和周报；不负责自动采集。
description_zh: 打开、重建、检查本地 Agent 日报和周报。
description_en: Open, rebuild, and inspect local Agent daily and weekly reports.
version: 0.1.0
author: Agent Journal contributors
---

# Agent Journal 手动入口

自动采集由本地 Hook 完成，不要依赖本 Skill 逐条记录。

当用户要求“打开日报/周报”“重建报告”“检查 Agent Journal 状态”时，使用本地命令：

```bash
python ~/.agent-journal/agent-journal.py open
python ~/.agent-journal/agent-journal.py report
python ~/.agent-journal/agent-journal.py status
```

如果数据目录经过自定义，优先使用安装时输出的实际目录，不要假定默认路径。

说明：
- `open`：重建并打开静态 HTML 报告索引。
- `report`：从本地 JSONL 重建日报、周报和索引。
- `status`：检查数据目录、记录数量以及 Hook 安装状态。
- 不要上传问答内容，不要启动 HTTP 服务。
