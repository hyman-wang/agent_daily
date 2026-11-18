"""Run Agent Journal installation from the repository root."""
import sys
from agent_journal.installer import main

if __name__ == "__main__":
    raise SystemExit(main(["install", *(sys.argv[1:])]))
