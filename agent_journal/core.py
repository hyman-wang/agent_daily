"""Local storage, hook processing, and static report generation for Agent Journal."""
from __future__ import annotations

import hashlib
import html
import json
import os
import re
import time
import uuid
import webbrowser
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path

APP_NAME = "agent-journal"
SCHEMA_VERSION = 1


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def default_home() -> Path:
    return Path(os.environ.get("AGENT_JOURNAL_HOME", "~/.agent-journal")).expanduser()


def ensure_dirs(home: Path) -> None:
    for name in ("data", "reports/daily", "reports/weekly", "logs", "backups"):
        (home / name).mkdir(parents=True, exist_ok=True)


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def write_text_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".{os.getpid()}.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def write_json_atomic(path: Path, value) -> None:
    write_text_atomic(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def append_jsonl(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n"
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(line)
        handle.flush()
        os.fsync(handle.fileno())


def read_jsonl(path: Path) -> list[dict]:
    records = []
    try:
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                try:
                    item = json.loads(line)
                    if isinstance(item, dict):
                        records.append(item)
                except ValueError:
                    continue
    except OSError:
        pass
    return records


@contextmanager
def file_lock(home: Path, timeout: float = 10.0):
    ensure_dirs(home)
    path = home / "data" / ".lock"
    deadline = time.monotonic() + timeout
    fd = None
    while fd is None:
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_RDWR)
            os.write(fd, str(os.getpid()).encode("ascii"))
        except FileExistsError:
            try:
                if time.time() - path.stat().st_mtime > 120:
                    path.unlink()
                    continue
            except OSError:
                pass
            if time.monotonic() >= deadline:
                raise TimeoutError("Agent Journal data lock timeout")
            time.sleep(0.1)
    try:
        yield
    finally:
        os.close(fd)
        try:
            path.unlink()
        except OSError:
            pass


def load_config(home: Path) -> dict:
    cfg = read_json(home / "config.json", {})
    general = cfg.get("general", {}) if isinstance(cfg, dict) else {}
    return {
        "weekStart": int(general.get("weekStart", 1)),
        "reportFormat": general.get("reportFormat", "requirement"),
        "dataDir": general.get("dataDir", str(home)),
    }


def load_requirements(home: Path) -> dict[str, dict]:
    latest = {}
    for record in read_jsonl(home / "data" / "requirements.jsonl"):
        rid = record.get("requirement_id")
        if rid:
            latest[rid] = record
    return latest


def load_turns(home: Path) -> list[dict]:
    return read_jsonl(home / "data" / "turns.jsonl")


def clip(value, limit: int) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text if len(text) <= limit else text[: max(1, limit - 1)].rstrip() + "…"


def prompt_context(home: Path, event: dict) -> dict:
    project = str(event.get("cwd") or "")
    candidates = []
    for item in load_requirements(home).values():
        if project and item.get("project") != project:
            continue
        candidates.append({
            "requirement_id": item.get("requirement_id"),
            "title": item.get("title"),
            "summary": clip(item.get("requirement_summary"), 500),
        })
    candidates.sort(key=lambda x: x.get("requirement_id") or "", reverse=True)
    candidates = candidates[:3]
    contract = {
        "schema_version": SCHEMA_VERSION,
        "relation": "new 或 continue",
        "requirement_id": "continue 时从候选中选择；new 时留空",
        "title": "需求短标题",
        "question_summary": "本轮问题摘要，不超过160字",
        "result_summary": "本轮结果摘要，不超过300字",
        "requirement_summary": "合并旧摘要后的需求累计摘要，不超过600字",
        "key_points": ["最多5条"],
        "artifacts": ["最多10个文件"],
        "tests": "测试状态",
        "tags": ["最多5个"],
    }
    context = (
        "Agent Journal 已启用。请正常回答用户，并在回答末尾额外附加一个 ```agent-journal 代码块。"
        "代码块只含一个 JSON 对象，用于本地日报/周报。若本轮属于同一项目的同一需求，"
        "设置 relation=continue 并复用候选 requirement_id，同时把旧累计摘要与本轮结果整合为新的 requirement_summary；"
        "新需求则 relation=new。不要输出思考过程、工具日志或完整原文。"
        f"\n输出约定：{json.dumps(contract, ensure_ascii=False)}"
        f"\n当前项目：{project}"
        f"\n可继续的需求候选：{json.dumps(candidates, ensure_ascii=False)}"
    )
    return {
        "continue": True,
        "suppressOutput": True,
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": context,
        },
    }


def extract_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        if content.get("type") in ("tool_use", "tool_result", "thinking"):
            return ""
        return str(content.get("text") or content.get("content") or "")
    if isinstance(content, list):
        return "\n".join(filter(None, (extract_text(part) for part in content)))
    return ""


def parse_transcript(path: Path) -> list[tuple[str, str]]:
    messages = []
    for item in read_jsonl(path):
        message = item.get("message") if isinstance(item.get("message"), dict) else item
        role = message.get("role") or item.get("role") or item.get("type")
        text = extract_text(message.get("content", item.get("content")))
        if not text.strip():
            continue
        if role in ("user", "human"):
            messages.append(("user", text))
        elif role in ("assistant", "agent"):
            messages.append(("assistant", text))
    return messages


def current_turn(messages: list[tuple[str, str]]) -> tuple[str, str]:
    last_user = -1
    for index, (role, _) in enumerate(messages):
        if role == "user":
            last_user = index
    if last_user < 0:
        return "", ""
    question = messages[last_user][1]
    answer = "\n".join(text for role, text in messages[last_user + 1:] if role == "assistant")
    return question, answer


def summary_block(answer: str) -> dict | None:
    patterns = (
        r"```agent-journal\s*\n?(\{.*?\})\s*```",
        r"<agent-journal>\s*(\{.*?\})\s*</agent-journal>",
    )
    for pattern in patterns:
        matches = re.findall(pattern, answer, flags=re.DOTALL)
        for raw in reversed(matches):
            try:
                value = json.loads(raw)
                if isinstance(value, dict) and value.get("question_summary") and value.get("result_summary"):
                    return value
            except ValueError:
                continue
    return None


def fallback_summary(question: str, answer: str) -> dict:
    clean_answer = re.sub(r"```agent-journal\s*\n?\{.*?\}\s*```", "", answer, flags=re.DOTALL)
    return {
        "schema_version": SCHEMA_VERSION,
        "relation": "new",
        "title": clip(question, 60),
        "question_summary": clip(question, 160),
        "result_summary": clip(clean_answer, 300),
        "requirement_summary": clip(question + "；" + clean_answer, 600),
        "key_points": [],
        "artifacts": [],
        "tests": "未提供",
        "tags": ["待整理"],
        "summary_method": "fallback",
    }


def normalized_summary(raw: dict) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "relation": raw.get("relation") if raw.get("relation") in ("new", "continue") else "new",
        "requirement_id": str(raw.get("requirement_id") or ""),
        "title": clip(raw.get("title") or raw.get("question_summary"), 80),
        "question_summary": clip(raw.get("question_summary"), 160),
        "result_summary": clip(raw.get("result_summary"), 300),
        "requirement_summary": clip(raw.get("requirement_summary") or raw.get("result_summary"), 600),
        "key_points": [clip(x, 160) for x in (raw.get("key_points") or [])[:5]],
        "artifacts": [clip(x, 240) for x in (raw.get("artifacts") or [])[:10]],
        "tests": clip(raw.get("tests"), 240),
        "tags": [clip(x, 30) for x in (raw.get("tags") or [])[:5]],
        "summary_method": raw.get("summary_method", "model"),
    }


def handle_stop(home: Path, event: dict, agent: str) -> dict:
    ensure_dirs(home)
    transcript = Path(str(event.get("transcript_path") or "")).expanduser()
    question, answer = current_turn(parse_transcript(transcript))
    if not question:
        return {"ok": False, "reason": "no-current-question"}
    raw = summary_block(answer) or fallback_summary(question, answer)
    summary = normalized_summary(raw)
    session = str(event.get("session_id") or "unknown")
    generation = str(event.get("generation_id") or "")
    digest = hashlib.sha256((session + question + answer).encode("utf-8")).hexdigest()[:16]
    turn_id = generation or f"{session}-{digest}"
    project = str(event.get("cwd") or "")
    with file_lock(home):
        turns = load_turns(home)
        if any(item.get("turn_id") == turn_id for item in turns):
            return {"ok": True, "duplicate": True}
        requirements = load_requirements(home)
        requested = summary["requirement_id"]
        existing = requirements.get(requested)
        if summary["relation"] == "continue" and existing and existing.get("project") == project:
            requirement_id = requested
            previous = existing
        else:
            requirement_id = "req-" + uuid.uuid4().hex[:12]
            previous = {}
        timestamp = now_iso()
        turn = {
            "schema_version": SCHEMA_VERSION,
            "turn_id": turn_id,
            "requirement_id": requirement_id,
            "agent": agent,
            "session_id": session,
            "project": project,
            "question_summary": summary["question_summary"],
            "result_summary": summary["result_summary"],
            "summary_method": summary["summary_method"],
            "created_at": timestamp,
        }
        requirement = {
            "schema_version": SCHEMA_VERSION,
            "requirement_id": requirement_id,
            "title": summary["title"] or previous.get("title"),
            "project": project,
            "agents": sorted(set(previous.get("agents", []) + [agent])),
            "sessions": sorted(set(previous.get("sessions", []) + [session])),
            "turn_count": int(previous.get("turn_count", 0)) + 1,
            "requirement_summary": summary["requirement_summary"],
            "key_points": summary["key_points"],
            "artifacts": summary["artifacts"],
            "tests": summary["tests"],
            "tags": summary["tags"],
            "status": "needs_review" if summary["summary_method"] == "fallback" else "complete",
            "first_seen_at": previous.get("first_seen_at", timestamp),
            "last_updated_at": timestamp,
        }
        append_jsonl(home / "data" / "turns.jsonl", turn)
        append_jsonl(home / "data" / "requirements.jsonl", requirement)
    generate_reports(home)
    return {"ok": True, "requirement_id": requirement_id, "turn_id": turn_id}


def local_date(value: str) -> str:
    try:
        return datetime.fromisoformat(value).date().isoformat()
    except (ValueError, TypeError):
        return value[:10]


def week_range(date_text: str, week_start: int) -> tuple[str, str]:
    date = datetime.fromisoformat(date_text).date()
    diff = (date.weekday() + 1 - week_start) % 7
    start = date - timedelta(days=diff)
    return start.isoformat(), (start + timedelta(days=6)).isoformat()


def report_card(item: dict, turns: list[dict], show_turns: bool) -> str:
    points = "；".join(item.get("key_points") or []) or "—"
    artifacts = "、".join(item.get("artifacts") or []) or "—"
    body = [
        '<article class="requirement">',
        f'<div class="head"><h3>{html.escape(item.get("title") or "未命名需求")}</h3>',
        f'<span class="status">{html.escape(item.get("status") or "")}</span></div>',
        f'<p class="summary">{html.escape(item.get("requirement_summary") or "")}</p>',
        f'<p><b>关键点：</b>{html.escape(points)}</p>',
        f'<p><b>涉及文件：</b>{html.escape(artifacts)}</p>',
        f'<p><b>测试：</b>{html.escape(item.get("tests") or "—")}</p>',
        f'<p class="meta">{html.escape(item.get("project") or "")} · {item.get("turn_count", 0)} 次提问 · {html.escape(item.get("last_updated_at") or "")}</p>',
    ]
    if show_turns and turns:
        body.append(f'<details><summary>提问明细（{len(turns)}）</summary>')
        for turn in turns:
            body.append(
                '<div class="turn"><b>问：</b>' + html.escape(turn.get("question_summary") or "") +
                '<br><b>答：</b>' + html.escape(turn.get("result_summary") or "") + '</div>'
            )
        body.append('</details>')
    body.append('</article>')
    return "".join(body)


REPORT_CSS = """
:root{--bg:#0f1115;--panel:#171a21;--border:#2a2f3a;--text:#e8eaf0;--muted:#9aa3b2;--accent:#6ea8fe;--ok:#4ade80}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Segoe UI,Microsoft YaHei,sans-serif;line-height:1.6}
main{max-width:1500px;margin:auto;padding:28px}h1{font-size:25px}h2{font-size:18px}.muted{color:var(--muted);font-size:13px}
.split{display:grid;grid-template-columns:1fr 1fr;gap:20px}.pane{min-width:0}.weekly{position:sticky;top:0;max-height:90vh;overflow:auto}.daily{max-height:90vh;overflow:auto}
.requirement{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:18px;margin:14px 0}.head{display:flex;justify-content:space-between;gap:12px}.head h3{margin:0;font-size:17px}.status{color:var(--ok);font-size:12px}.summary{color:#d7dce5}.meta{color:var(--muted);font-size:12px}.turn{border-top:1px solid var(--border);padding:10px 0;font-size:13px}details{margin-top:12px}summary{cursor:pointer;color:var(--accent)}
.links a{color:var(--accent);margin-right:12px}.empty{padding:40px;text-align:center;color:var(--muted);border:1px dashed var(--border);border-radius:12px}@media(max-width:900px){.split{grid-template-columns:1fr}.weekly,.daily{position:static;max-height:none;overflow:visible}}
"""


def page(title: str, body: str) -> str:
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + \
        f'<title>{html.escape(title)}</title><style>{REPORT_CSS}</style></head><body><main><h1>{html.escape(title)}</h1>{body}</main></body></html>'


def generate_reports(home: Path) -> None:
    ensure_dirs(home)
    config = load_config(home)
    requirements = load_requirements(home)
    turns = load_turns(home)
    show_turns = config["reportFormat"] in ("turn", "both")
    by_day: dict[str, list[dict]] = {}
    for turn in turns:
        by_day.setdefault(local_date(turn.get("created_at", "")), []).append(turn)
    for day, day_turns in by_day.items():
        ids = {turn.get("requirement_id") for turn in day_turns}
        cards = []
        for rid in ids:
            item = requirements.get(rid)
            if item:
                related = [t for t in day_turns if t.get("requirement_id") == rid]
                cards.append(report_card(item, related, show_turns))
        body = f'<p class="muted">{day} · {len(ids)} 个需求 · {len(day_turns)} 次提问</p>' + ("".join(cards) or '<div class="empty">暂无记录</div>')
        write_text_atomic(home / "reports" / "daily" / f"{day}.html", page(f"Agent 日报 · {day}", body))
    by_week: dict[str, list[dict]] = {}
    for turn in turns:
        day = local_date(turn.get("created_at", ""))
        if not day:
            continue
        start, _ = week_range(day, config["weekStart"])
        by_week.setdefault(start, []).append(turn)
    for start, week_turns in by_week.items():
        end = week_range(start, config["weekStart"])[1]
        ids = {turn.get("requirement_id") for turn in week_turns}
        cards = []
        for rid in ids:
            item = requirements.get(rid)
            if item:
                related = [t for t in week_turns if t.get("requirement_id") == rid]
                cards.append(report_card(item, related, show_turns))
        body = f'<p class="muted">{start} 至 {end} · {len(ids)} 个需求 · {len(week_turns)} 次提问</p>' + ("".join(cards) or '<div class="empty">暂无记录</div>')
        write_text_atomic(home / "reports" / "weekly" / f"{start}.html", page(f"Agent 周报 · {start}", body))
    today = datetime.now().astimezone().date().isoformat()
    week_start, week_end = week_range(today, config["weekStart"])
    daily_turns = by_day.get(today, [])
    weekly_turns = by_week.get(week_start, [])
    def cards_for(items):
        ids = {turn.get("requirement_id") for turn in items}
        output = []
        for rid in ids:
            if rid in requirements:
                output.append(report_card(requirements[rid], [t for t in items if t.get("requirement_id") == rid], show_turns))
        return "".join(output) or '<div class="empty">暂无记录</div>'
    daily_links = "".join(f'<a href="daily/{day}.html">{day}</a>' for day in sorted(by_day, reverse=True))
    weekly_links = "".join(f'<a href="weekly/{start}.html">{start}</a>' for start in sorted(by_week, reverse=True))
    body = (
        '<p class="muted">本地静态报告 · 左侧当期周报，右侧今日日报 · 无需服务</p>'
        '<div class="split"><section class="pane weekly"><h2>当期周报</h2>'
        f'<p class="muted">{week_start} 至 {week_end}</p>{cards_for(weekly_turns)}</section>'
        f'<section class="pane daily"><h2>今日日报</h2><p class="muted">{today}</p>{cards_for(daily_turns)}</section></div>'
        f'<h2>历史报告</h2><p class="links">日报：{daily_links or "暂无"}</p><p class="links">周报：{weekly_links or "暂无"}</p>'
    )
    write_text_atomic(home / "reports" / "index.html", page("Agent Journal 报告", body))


def open_reports(home: Path) -> None:
    generate_reports(home)
    webbrowser.open((home / "reports" / "index.html").resolve().as_uri())
