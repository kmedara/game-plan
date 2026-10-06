#!/bin/sh
set -eu

echo "waiting for DynamoDB at ${DYNAMODB_ENDPOINT}"
i=0
until node --import tsx local/src/create-table.ts; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "DynamoDB did not become ready in time" >&2
    exit 1
  fi
  sleep 2
done

echo "seeding demo teams"
node --import tsx local/src/seed-demo-teams.ts

echo "starting area processes and proxy"
exec node --import tsx local/src/dev.ts
