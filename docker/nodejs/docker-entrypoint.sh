#!/bin/sh
set -e

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

exec /sbin/tini -- tail -f /dev/null
