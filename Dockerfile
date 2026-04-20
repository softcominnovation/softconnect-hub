# =============================================================================
# SoftConnect 2.0 — Dockerfile multi-stage
# Stage 1: builder  — compila TS, gera Prisma Client
# Stage 2: production — imagem mínima, apenas o necessário para rodar
# =============================================================================

# --- Stage 1: Build ---
FROM node:20-alpine AS builder

WORKDIR /app

# Instala dependências primeiro (layer cache — só invalida se package.json mudar)
COPY package*.json ./
RUN npm ci

# Copia o código-fonte completo
COPY . .

# Gera o Prisma Client tipado
RUN npx prisma generate

# Compila TypeScript → JavaScript (output em /app/dist)
RUN npm run build

# Remove devDependencies aqui no builder, onde o package.json está presente
RUN npm prune --omit=dev && npm cache clean --force


# --- Stage 2: Production ---
FROM node:20-alpine AS production

ENV NODE_ENV=production

WORKDIR /app

# Copia o build compilado
COPY --from=builder /app/dist ./dist

# Copia o schema Prisma + migrations (necessário para o migrate deploy)
COPY --from=builder /app/prisma ./prisma

# Copia o node_modules já prunado do builder
COPY --from=builder /app/node_modules ./node_modules

# Segurança: não rodar como root
USER node

EXPOSE 3000

# Entrypoint dedicado: aplica migrations e sobe a API
COPY --chown=node:node docker/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

CMD ["./docker-entrypoint.sh"]
