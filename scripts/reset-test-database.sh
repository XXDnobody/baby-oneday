#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

if [ "$#" -ne 0 ]; then
  echo "这个脚本不接受参数，只会重建测试库 baby_plan_test。" >&2
  exit 1
fi

test_volume="baby-plan-test-data"
dev_volume="baby-plan-dev-data"
if [ "$test_volume" = "$dev_volume" ]; then
  echo "拒绝重置：测试卷和开发卷同名。" >&2
  exit 1
fi

grep -q "name: ${test_volume}" docker-compose.yml
grep -q "name: ${dev_volume}" docker-compose.yml
grep -q "container_name: baby-plan-postgres-test" docker-compose.yml

if ! docker volume inspect "$dev_volume" >/dev/null 2>&1; then
  echo "拒绝重置：开发数据卷不存在。" >&2
  exit 1
fi

docker compose --env-file .env.compose --profile test stop postgres-test
docker compose --env-file .env.compose --profile test rm -f postgres-test
if docker volume inspect "$test_volume" >/dev/null 2>&1; then
  docker volume rm "$test_volume"
fi
docker compose --env-file .env.compose --profile test up -d --wait postgres-test

if ! docker volume inspect "$dev_volume" >/dev/null 2>&1; then
  echo "开发数据卷在重置后不可见，请立即检查。" >&2
  exit 1
fi
echo "已重建测试数据库。开发数据卷仍然存在。"
