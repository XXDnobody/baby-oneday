#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

marker="env-persist-$(date +%s)"
docker compose --env-file .env.compose up -d --wait postgres
docker exec -i baby-plan-postgres psql -v ON_ERROR_STOP=1 -U baby_plan_dev -d baby_plan_dev <<SQL
create table if not exists env_persistence_probe (
  id integer primary key,
  note text not null,
  created_at timestamptz not null default now()
);
insert into env_persistence_probe (id, note)
values (1, '${marker}')
on conflict (id) do update set note = excluded.note, created_at = now();
SQL

docker compose --env-file .env.compose restart postgres
docker compose --env-file .env.compose up -d --wait postgres
found="$(docker exec -i baby-plan-postgres psql -v ON_ERROR_STOP=1 -U baby_plan_dev -d baby_plan_dev -tA -c "select note from env_persistence_probe where id = 1")"
if [ "$found" != "$marker" ]; then
  echo "重启后没有读回探针数据。" >&2
  exit 1
fi
echo "开发数据库重启后仍保留探针记录。"
