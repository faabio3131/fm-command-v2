#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGPASSWORD:=postgres}"
: "${PGDATABASE:=fmcc}"
: "${FMCC_RESTORE_DATABASE:=fmcc_restore_smoke}"

if [[ ! "${FMCC_RESTORE_DATABASE}" =~ ^[a-zA-Z0-9_]+$ ]]; then
  echo "invalid restore database name" >&2
  exit 1
fi

tmpdir="$(mktemp -d)"
chmod 0777 "${tmpdir}"
cleanup() {
  docker run --rm --network host -e PGPASSWORD="${PGPASSWORD}" postgres:18 \
    psql -v ON_ERROR_STOP=1 -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d postgres \
    -c "DROP DATABASE IF EXISTS \"${FMCC_RESTORE_DATABASE}\" WITH (FORCE);" >/dev/null 2>&1 || true
  rm -rf "${tmpdir}"
}
trap cleanup EXIT

echo "Creating logical backup from isolated CI database..."
docker run --rm --network host \
  -e PGPASSWORD="${PGPASSWORD}" \
  -v "${tmpdir}:/backup" \
  postgres:18 \
  pg_dump -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" \
  --format=custom --no-owner --no-privileges --file=/backup/fmcc.dump

test -s "${tmpdir}/fmcc.dump"

echo "Creating isolated restore database..."
docker run --rm --network host \
  -e PGPASSWORD="${PGPASSWORD}" postgres:18 \
  psql -v ON_ERROR_STOP=1 -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d postgres \
  -c "DROP DATABASE IF EXISTS \"${FMCC_RESTORE_DATABASE}\" WITH (FORCE);" \
  -c "CREATE DATABASE \"${FMCC_RESTORE_DATABASE}\";"

echo "Restoring backup..."
docker run --rm --network host \
  -e PGPASSWORD="${PGPASSWORD}" \
  -v "${tmpdir}:/backup" \
  postgres:18 \
  pg_restore -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" \
  -d "${FMCC_RESTORE_DATABASE}" --no-owner --no-privileges /backup/fmcc.dump

echo "Verifying restored FMCC schema..."
check="$(docker run --rm --network host \
  -e PGPASSWORD="${PGPASSWORD}" postgres:18 \
  psql -At -v ON_ERROR_STOP=1 -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" \
  -d "${FMCC_RESTORE_DATABASE}" \
  -c "SELECT
        to_regclass('public.fmcc_audit_event') IS NOT NULL
        AND to_regclass('public.fmcc_source_definition') IS NOT NULL
        AND to_regclass('public.fmcc_sync_execution') IS NOT NULL
        AND to_regclass('public.fmcc_canonical_fact') IS NOT NULL
        AND to_regclass('public.fmcc_metric_value') IS NOT NULL;")"

if [[ "${check}" != "t" ]]; then
  echo "restored schema verification failed" >&2
  exit 1
fi

echo "Backup/restore smoke PASS."
