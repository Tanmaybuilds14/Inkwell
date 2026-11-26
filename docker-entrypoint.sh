#!/bin/sh
set -e

echo "Running database migrations..."
npx prisma migrate deploy || echo "Migration step completed or skipped."

echo "Starting Inkwell..."
exec node server.js
