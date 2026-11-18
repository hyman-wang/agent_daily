"""Run Agent Journal uninstallation from the repository root."""
import sys
from agent_journal.installer import main

if __name__ == "__main__":
    raise SystemExit(main(["uninstall", *(sys.argv[1:])]))
