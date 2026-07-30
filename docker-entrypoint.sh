#!/bin/sh
set -eu

echo "Waiting for PostgreSQL..."
until node -e "const p=require('postgres')(process.env.DATABASE_URL,{max:1});p.unsafe('SELECT 1').then(()=>p.end()).then(()=>process.exit(0)).catch(()=>process.exit(1))"; do
  sleep 2
done

node scripts/migrate.mjs
exec node server.js
