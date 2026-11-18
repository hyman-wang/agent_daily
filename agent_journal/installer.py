"""Safe install/uninstall and CLI for Agent Journal."""
from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import sys
from datetime import datetime
from pathlib import Path

from agent_journal.core import (
    default_home,
    ensure_dirs,
    generate_reports,
    load_requirements,
    load_turns,
    open_reports,
    write_json_atomic,
    write_text_atomic,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
MARKER = "agent_journal"


def bash_path(path: Path) -> str:
    text = str(path.expanduser().resolve()).replace("\\", "/")
    if len(text) > 2 and text[1] == ":" and text[0].isalpha():
        return "/" + text[0].lower() + text[2:]
    return text


def hook_command(home: Path, agent: str) -> str:
    python = bash_path(Path(sys.executable))
    script = bash_path(PROJECT_ROOT / "agent_journal" / "hook.py")
    data_home = bash_path(home)
    return f"{shlex.quote(python)} {shlex.quote(script)} --home {shlex.quote(data_home)} --agent {shlex.quote(agent)}"


def settings_path(agent: str, args) -> Path:
    if agent == "workbuddy" and getattr(args, "codebuddy_settings", None):
        return Path(args.codebuddy_settings).expanduser()
    if agent == "claude" and getattr(args, "claude_settings", None):
        return Path(args.claude_settings).expanduser()
    if agent == "workbuddy":
        custom = os.environ.get("CODEBUDDY_SETTINGS") or os.environ.get("WORKBUDDY_SETTINGS")
        return Path(custom).expanduser() if custom else Path("~/.codebuddy/settings.json").expanduser()
    custom = os.environ.get("CLAUDE_SETTINGS")
    return Path(custom).expanduser() if custom else Path("~/.claude/settings.json").expanduser()


def selected_agents(config: dict) -> list[str]:
    values = config.get("hook", {}).get("agents", ["workbuddy", "claude"])
    mapping = {"workbuddy": "workbuddy", "codebuddy": "workbuddy", "claude": "claude"}
    return [mapping[value] for value in values if value in mapping]


def backup_settings(path: Path, home: Path) -> None:
    if not path.exists():
        return
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = home / "backups" / f"{path.parent.name}-{stamp}.json"
    shutil.copy2(path, target)


def add_hook(settings: dict, event: str, command: str, agent: str) -> None:
    hooks = settings.setdefault("hooks", {})
    entries = hooks.setdefault(event, [])
    kept = []
    for entry in entries:
        commands = entry.get("hooks", [])
        filtered = [h for h in commands if not (MARKER in h.get("command", "") and f"--agent {agent}" in h.get("command", ""))]
        if filtered:
            entry["hooks"] = filtered
            kept.append(entry)
    kept.append({"hooks": [{"type": "command", "command": command, "timeout": 30}]})
    hooks[event] = kept


def remove_hooks(settings: dict) -> bool:
    changed = False
    hooks = settings.get("hooks", {})
    for event, entries in list(hooks.items()):
        new_entries = []
        for entry in entries:
            commands = entry.get("hooks", [])
            filtered = [h for h in commands if MARKER not in h.get("command", "")]
            if len(filtered) != len(commands):
                changed = True
            if filtered:
                entry["hooks"] = filtered
                new_entries.append(entry)
        if new_entries:
            hooks[event] = new_entries
        else:
            hooks.pop(event, None)
    return changed


def install_skill(agent: str) -> Path:
    source = PROJECT_ROOT / "skills" / "agent-journal"
    base = Path("~/.workbuddy/skills").expanduser() if agent == "workbuddy" else Path("~/.claude/skills").expanduser()
    target = base / "agent-journal"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, target, dirs_exist_ok=True)
    return target


def remove_skill(agent: str) -> None:
    base = Path("~/.workbuddy/skills").expanduser() if agent == "workbuddy" else Path("~/.claude/skills").expanduser()
    target = base / "agent-journal"
    skill_file = target / "SKILL.md"
    if skill_file.exists() and "name: agent-journal" in skill_file.read_text(encoding="utf-8"):
        shutil.rmtree(target)


def write_wrapper(home: Path) -> None:
    wrapper = (
        "import sys\n"
        f"sys.path.insert(0, {str(PROJECT_ROOT)!r})\n"
        "from agent_journal.__main__ import main\n"
        "raise SystemExit(main())\n"
    )
    write_text_atomic(home / "agent-journal.py", wrapper)


def install(args) -> int:
    home = Path(args.home).expanduser()
    ensure_dirs(home)
    config_path = Path(args.config).expanduser() if args.config else PROJECT_ROOT / "agent-journal.config.json"
    try:
        config = json.loads(config_path.read_text(encoding="utf-8")) if config_path.exists() else {}
    except ValueError:
        print(f"配置 JSON 无法解析：{config_path}", file=sys.stderr)
        return 1
    write_json_atomic(home / "config.json", config)
    write_wrapper(home)
    modes = config.get("modes", {"hook": True, "skill": True, "memory": True})
    agents = selected_agents(config)
    if not agents:
        agents = ["workbuddy", "claude"]
    if modes.get("hook", True):
        for agent in agents:
            path = settings_path(agent, args)
            settings = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
            backup_settings(path, home)
            command = hook_command(home, agent)
            events = config.get("hook", {}).get("events", ["UserPromptSubmit", "Stop"])
            for event in events:
                if event in ("UserPromptSubmit", "Stop", "SessionEnd"):
                    add_hook(settings, event, command, agent)
            write_json_atomic(path, settings)
            print(f"已合并 {agent} Hook：{path}")
    if modes.get("skill", True):
        for agent in agents:
            print(f"已安装 Skill：{install_skill(agent)}")
    if modes.get("memory", True):
        write_json_atomic(home / "memory.json", {"preferences": config.get("general", {}), "updated_at": datetime.now().astimezone().isoformat()})
    generate_reports(home)
    print(f"安装完成。报告入口：{home / 'reports' / 'index.html'}")
    print("请重启 Agent 或新开任务后，用一次测试提问验证采集。")
    return 0


def uninstall(args) -> int:
    home = Path(args.home).expanduser()
    for agent in ("workbuddy", "claude"):
        path = settings_path(agent, args)
        if path.exists():
            settings = json.loads(path.read_text(encoding="utf-8"))
            backup_settings(path, home)
            if remove_hooks(settings):
                write_json_atomic(path, settings)
                print(f"已移除 {agent} Hook：{path}")
        remove_skill(agent)
    if args.purge:
        resolved = home.resolve()
        if resolved.name.lower() not in (".agent-journal", "agent-journal"):
            print("出于安全考虑，--purge 只允许删除名为 .agent-journal 或 agent-journal 的目录。", file=sys.stderr)
            return 1
        shutil.rmtree(resolved)
        print(f"已删除数据目录：{resolved}")
    else:
        print(f"卸载完成，报告数据仍保留在：{home}")
    return 0


def status(args) -> int:
    home = Path(args.home).expanduser()
    print(f"数据目录：{home}")
    print(f"需求数：{len(load_requirements(home))}")
    print(f"提问数：{len(load_turns(home))}")
    print(f"报告入口：{home / 'reports' / 'index.html'}")
    for agent in ("workbuddy", "claude"):
        path = settings_path(agent, args)
        installed = path.exists() and MARKER in path.read_text(encoding="utf-8")
        print(f"{agent} Hook：{'已安装' if installed else '未安装'}（{path}）")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="agent-journal")
    parser.add_argument("--home", default=str(default_home()))
    parser.add_argument("--codebuddy-settings")
    parser.add_argument("--claude-settings")
    sub = parser.add_subparsers(dest="command")
    install_parser = sub.add_parser("install")
    install_parser.add_argument("--config")
    sub.add_parser("uninstall").add_argument("--purge", action="store_true")
    sub.add_parser("report")
    sub.add_parser("open")
    sub.add_parser("status")
    return parser


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    command = args.command or "status"
    if command == "install":
        return install(args)
    if command == "uninstall":
        return uninstall(args)
    if command == "report":
        generate_reports(Path(args.home).expanduser())
        print("报告已重建")
        return 0
    if command == "open":
        open_reports(Path(args.home).expanduser())
        return 0
    return status(args)


if __name__ == "__main__":
    raise SystemExit(main())
