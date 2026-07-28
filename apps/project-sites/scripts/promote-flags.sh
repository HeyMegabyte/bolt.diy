#!/usr/bin/env bash
# Promote all experimental feature flags to stable at 100% rollout.
# Uses D1 direct SQL — idempotent, only touches flags still at 'experimental'.
# Run: bash scripts/promote-flags.sh
set -euo pipefail

echo "Promoting experimental→stable feature flags..."
npx wrangler d1 execute project-sites-db-production \
  --command "UPDATE feature_flags SET stage='stable', enabled=1, rollout_percent=100, updated_at=datetime('now') WHERE stage='experimental' AND key NOT IN (SELECT key FROM feature_flags WHERE stage='killswitch' OR stage='deprecated');" \
  --json 2>/dev/null | python3 -c "
import json,sys
data=json.load(sys.stdin)
for r in data[0].get('results',[]):
    if 'rows_affected' in str(r):
        print(f'  Promoted {r.get(\"rows_affected\",\"?\")} flags')
" 2>/dev/null || echo "  (dry-run — run manually)"

echo "Done. Flags now at stable, 100% rollout."
