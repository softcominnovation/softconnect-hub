#!/bin/sh
# Entrypoint do container SoftConnect 2.0
# 1. Aplica migrations pendentes (Prisma Advisory Lock garante que só 1 réplica migra por vez no Swarm)
# 2. Inicia a API

set -e

echo "▶ Aplicando migrations..."
node node_modules/.bin/prisma migrate deploy

echo "▶ Iniciando SoftConnect API..."
exec node dist/main.js
