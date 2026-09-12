#!/bin/sh
LOCKFILE="$1"; shift
exec 9>"$LOCKFILE"
if ! flock -n 9; then
  echo "lock ocupado: outra instância já está usando $LOCKFILE" >&2
  exit 24
fi
exec "$@"
