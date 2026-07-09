#!/bin/bash
# Check backfill progress: journals done vs total, latest log lines.
cd "$(dirname "$0")/.." || exit 1
TOTAL=$(python3 -c "import json;print(len(json.load(open('data/journals.json'))['journals']))")
DONE=$(python3 -c "
import json, pathlib
p = pathlib.Path('data/.harvest_state.json')
d = json.loads(p.read_text()) if p.exists() else {'journals': {}}
print(sum(1 for j in d['journals'].values() if j.get('backfilled')))")
echo "=== philosopheed backfill: $DONE/$TOTAL journals done ==="
[ -f harvest.log ] && tail -5 harvest.log
tmux has-session -t philosopheed 2>/dev/null && echo "(tmux session running)" || echo "(tmux session NOT running)"
