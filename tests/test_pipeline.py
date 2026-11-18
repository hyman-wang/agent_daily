import argparse
import json
import tempfile
import unittest
from pathlib import Path

from agent_journal.core import handle_stop, load_requirements, load_turns, prompt_context
from agent_journal.installer import install, remove_hooks


class PipelineTest(unittest.TestCase):
    def test_prompt_and_stop_create_reports_and_dedup(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            prompt = prompt_context(home, {"cwd": "D:/demo", "session_id": "s1"})
            context = prompt["hookSpecificOutput"]["additionalContext"]
            self.assertIn("agent-journal", context)
            transcript = home / "transcript.jsonl"
            summary = {
                "schema_version": 1,
                "relation": "new",
                "title": "实现配置页",
                "question_summary": "实现配置页",
                "result_summary": "已生成配置页并通过检查",
                "requirement_summary": "完成配置页，支持组合配置",
                "key_points": ["静态 HTML"],
                "artifacts": ["index.html"],
                "tests": "通过",
                "tags": ["前端"],
            }
            messages = [
                {"type": "user", "message": {"role": "user", "content": "实现配置页"}},
                {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": "已完成。\n```agent-journal\n" + json.dumps(summary, ensure_ascii=False) + "\n```"}]}}
            ]
            transcript.write_text("\n".join(json.dumps(m, ensure_ascii=False) for m in messages), encoding="utf-8")
            event = {"session_id": "s1", "generation_id": "g1", "transcript_path": str(transcript), "cwd": "D:/demo"}
            first = handle_stop(home, event, "workbuddy")
            self.assertTrue(first["ok"])
            second = handle_stop(home, event, "workbuddy")
            self.assertTrue(second["duplicate"])
            self.assertEqual(len(load_turns(home)), 1)
            requirements = load_requirements(home)
            self.assertEqual(len(requirements), 1)
            requirement = next(iter(requirements.values()))
            self.assertEqual(requirement["turn_count"], 1)
            self.assertEqual(requirement["summary_method"] if "summary_method" in requirement else "model", "model")
            self.assertTrue((home / "reports" / "index.html").exists())
            self.assertTrue(list((home / "reports" / "daily").glob("*.html")))
            context2 = prompt_context(home, {"cwd": "D:/demo"})["hookSpecificOutput"]["additionalContext"]
            self.assertIn(requirement["requirement_id"], context2)

    def test_install_preserves_existing_hooks_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home = root / "home"
            settings_path = root / "settings.json"
            settings_path.write_text(json.dumps({
                "theme": "dark",
                "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "echo existing"}]}]}
            }), encoding="utf-8")
            config = root / "config.json"
            config.write_text(json.dumps({
                "modes": {"hook": True, "skill": False, "memory": False},
                "hook": {"agents": ["workbuddy"], "events": ["UserPromptSubmit", "Stop"]},
                "general": {"weekStart": 1}
            }), encoding="utf-8")
            args = argparse.Namespace(home=str(home), config=str(config), codebuddy_settings=str(settings_path), claude_settings=None)
            self.assertEqual(install(args), 0)
            self.assertEqual(install(args), 0)
            settings = json.loads(settings_path.read_text(encoding="utf-8"))
            self.assertEqual(settings["theme"], "dark")
            stop_commands = [h["command"] for entry in settings["hooks"]["Stop"] for h in entry["hooks"]]
            self.assertIn("echo existing", stop_commands)
            self.assertEqual(sum("agent_journal" in command for command in stop_commands), 1)
            self.assertTrue(remove_hooks(settings))
            self.assertEqual(settings["hooks"]["Stop"][0]["hooks"][0]["command"], "echo existing")


if __name__ == "__main__":
    unittest.main()
