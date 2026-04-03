#!/bin/bash
# Copy static files for standalone Next.js
cp -r /app/apps/web/.next/static /app/apps/web/.next/standalone/apps/web/.next/static 2>/dev/null || true
cp -r /app/apps/web/public /app/apps/web/.next/standalone/apps/web/public 2>/dev/null || true

# Start the server
PORT=${PORT:-3000} HOSTNAME=0.0.0.0 node /app/apps/web/.next/standalone/apps/web/server.js
