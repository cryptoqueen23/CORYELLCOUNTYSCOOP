#!/bin/bash
# clears ONLY the test namespace
NS=56dad1a91fef4dbfa56b906e7badd005
cd /c/Users/insur/CORYELLCOUNTYSCOOP/rss-worker
KEYS=$(npx wrangler@4 kv key list --namespace-id $NS --remote 2>/dev/null | grep '"name"' | sed 's/.*"name": "\(.*\)".*/\1/')
echo "[" > /tmp/keys.json; first=1
for k in $KEYS; do [ $first = 1 ] || echo "," >> /tmp/keys.json; first=0; echo "\"$k\"" >> /tmp/keys.json; done
echo "]" >> /tmp/keys.json
npx wrangler@4 kv bulk delete /tmp/keys.json --namespace-id $NS --remote --force 2>&1 | tail -2
