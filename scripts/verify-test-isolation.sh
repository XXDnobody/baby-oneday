#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

dev_marker="dev-isolation-$(date +%s)"
docker compose --env-file .env.compose up -d --wait postgres
docker compose --env-file .env.compose --profile test up -d --wait postgres-test

docker exec -i baby-plan-postgres psql -v ON_ERROR_STOP=1 -U baby_plan_dev -d baby_plan_dev <<SQL
create table if not exists env_persistence_probe (
  id integer primary key,
  note text not null,
  created_at timestamptz not null default now()
);
insert into env_persistence_probe (id, note)
values (1, '${dev_marker}')
on conflict (id) do update set note = excluded.note, created_at = now();
SQL

docker exec -i baby-plan-postgres-test psql -v ON_ERROR_STOP=1 -U baby_plan_test -d baby_plan_test <<SQL
create table env_test_isolation_probe (
  id integer primary key
);
insert into env_test_isolation_probe (id) values (1);
SQL

sh scripts/reset-test-database.sh

dev_found="$(docker exec -i baby-plan-postgres psql -v ON_ERROR_STOP=1 -U baby_plan_dev -d baby_plan_dev -tA -c "select note from env_persistence_probe where id = 1")"
test_found="$(docker exec -i baby-plan-postgres-test psql -v ON_ERROR_STOP=1 -U baby_plan_test -d baby_plan_test -tA -c "select coalesce(to_regclass('public.env_test_isolation_probe')::text, '')")"
if [ "$dev_found" != "$dev_marker" ]; then
  echo "重建测试库后，开发库探针数据发生变化。" >&2
  exit 1
fi
if [ -n "$test_found" ]; then
  echo "重建测试库后，测试探针表仍然存在。" >&2
  exit 1
fi
echo "测试数据库已独立重建，开发数据库探针数据未变。"
