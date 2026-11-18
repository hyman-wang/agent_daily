"""WorkBuddy/CodeBuddy and Claude Code hook entrypoint.

Reads one hook event from stdin. Never blocks the host agent on purpose.
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

# Allow direct execution: python agent_journal/hook.py
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent_journal.core import default_home, ensure_dirs, handle_stop, prompt_context


def log_error(home: Path, error: BaseException) -> None:
    try:
        ensure_dirs(home)
        with (home / "logs" / "hook.log").open("a", encoding="utf-8") as handle:
            handle.write(str(error) + "\n" + traceback.format_exc() + "\n")
    except OSError:
        pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", default=str(default_home()))
    parser.add_argument("--agent", default="unknown")
    args = parser.parse_args()
    home = Path(args.home).expanduser()
    try:
        event = json.load(sys.stdin)
        name = event.get("hook_event_name")
        if name == "UserPromptSubmit":
            result = prompt_context(home, event)
            sys.stdout.write(json.dumps(result, ensure_ascii=False))
        elif name == "Stop":
            handle_stop(home, event, args.agent)
            sys.stdout.write(json.dumps({"continue": True, "suppressOutput": True}))
        else:
            sys.stdout.write(json.dumps({"continue": True, "suppressOutput": True}))
    except Exception as error:  # Hook errors must not block the host agent.
        log_error(home, error)
        sys.stdout.write(json.dumps({"continue": True, "suppressOutput": True}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
