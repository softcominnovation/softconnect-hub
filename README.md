# SoftConnect 2.0 — WhatsHub Gateway

> API Gateway multi-provider para mensageria WhatsApp. Abstrai Evolution API, Meta Cloud, Z-API e outros providers via Adapter Pattern — todos os produtos consomem a mesma interface, o Hub resolve internamente qual provider acionar.

**Stack:** NestJS + Fastify · Prisma + PostgreSQL · Redis + BullMQ · Docker Swarm  
**Versão:** 2.0.0 · Spec v3.1

---

## Pré-requisitos

| Ferramenta | Versão mínima | Observação |
|---|---|---|
| Node.js | 20.x LTS | `node -v` para verificar |
| npm | 10.x | Vem com o Node |
| PostgreSQL | 14+ | Local ou Docker |
| Redis | 7.x | Local ou Docker |

---

## Variáveis de ambiente

Copie o arquivo de exemplo e preencha antes de qualquer outro passo:

```bash
# Windows (PowerShell)
Copy-Item .env.example .env

# Linux / macOS
cp .env.example .env
```

Conteúdo mínimo do `.env`:

```env
# Banco de dados
DATABASE_URL="postgresql://postgres:123456@127.0.0.1:5432/whatshub"

# Redis
REDIS_URL="redis://127.0.0.1:6379/0"

# Segurança — GERE VALORES REAIS EM PRODUÇÃO
ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
JWT_SECRET="dev-jwt-secret-troque-em-producao"
ADMIN_JWT_EXPIRY=86400

# Performance
DEFAULT_RATE_LIMIT=100
PROXY_TIMEOUT_MS=15000
PROXY_MAX_RETRIES=1
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_RESET_MS=30000

# Audit
AUDIT_FLUSH_INTERVAL_MS=1000
AUDIT_FLUSH_BATCH_SIZE=100

# Adapter padrão
DEFAULT_ADAPTER_TYPE=evolution
```

---

## Opção A — Desenvolvimento local (sem Docker)

> PostgreSQL e Redis rodando direto na sua máquina. Recomendado para desenvolvimento do dia a dia.

### Windows (PowerShell)

```powershell
# 1. Entre na pasta do projeto
cd softconnect

# 2. Instale as dependências
npm install

# 3. Aplique as migrations no banco local (cria todas as 7 tabelas)
npx prisma migrate deploy

# 4. Popule o banco com dados de desenvolvimento
npx ts-node prisma/seed.ts

# 5. Inicie em modo hot-reload
npm run start:dev
```

### Linux / macOS (bash)

```bash
# 1. Entre na pasta do projeto
cd softconnect

# 2. Instale as dependências
npm install

# 3. Aplique as migrations
npx prisma migrate deploy

# 4. Seed de desenvolvimento
npx ts-node prisma/seed.ts

# 5. Inicie em modo hot-reload
npm run start:dev
```

**Dados do seed de desenvolvimento:**
| O quê | Valor |
|---|---|
| VPS | Servidor de desenvolvimento local |
| Produto | Softcomshop |
| API Key (raw) | definida em `prisma/seed.ts` via variável de ambiente `SEED_PRODUCT_API_KEY` |
| Webhook destino | configurado via `SEED_WEBHOOK_URL` |

> ⚠️ A API Key raw **nunca é salva no banco** — apenas o hash SHA-256. Configure as variáveis `SEED_*` no `.env` antes de rodar o seed.

---

## Opção B — Desenvolvimento com Docker Compose

> Sobe PostgreSQL + Redis automaticamente via container. Útil se não quiser instalar as dependências localmente.

### Windows / Linux / macOS

```bash
# 1. Entre na pasta do projeto
cd softconnect

# 2. Suba os serviços de infraestrutura (Postgres + Redis)
docker compose up -d postgres redis

# 3. Instale as dependências Node
npm install

# 4. Aplique as migrations
npx prisma migrate deploy

# 5. Seed de desenvolvimento
npx ts-node prisma/seed.ts

# 6. Inicie a API em modo hot-reload (fora do Docker)
npm run start:dev
```

Para parar os containers:
```bash
docker compose down
```

---

## Opção C — Stack completa via Docker (produção / homologação)

> Sobe tudo: Postgres + Redis + app. Equivalente ao ambiente de produção no Swarm.

```bash
# 1. Build da imagem
docker compose build

# 2. Sobe toda a stack
docker compose up -d

# 3. Aplica migrations dentro do container
docker compose exec app npx prisma migrate deploy

# 4. Seed (opcional — apenas em homologação)
docker compose exec app npx ts-node prisma/seed.ts
```

Para ver os logs da aplicação:
```bash
docker compose logs -f app
```

---

## Comandos úteis do dia a dia

```bash
# Abrir o Prisma Studio (GUI do banco)
npx prisma studio

# Recriar o banco do zero (DROP + migrations + seed)
npx prisma migrate reset

# Gerar o Prisma Client após alterar o schema
npx prisma generate

# Validar o schema sem aplicar nada
npx prisma validate

# Ver status das migrations
npx prisma migrate status

# Rodar os testes unitários
npm test

# Rodar os testes e2e
npm run test:e2e

# Build de produção
npm run build
```

---

## Endpoints disponíveis (atualmente)

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/` | Identificação da API |
| `GET` | `/health` | Health check básico |

> Os demais endpoints (Admin Plane, Data Plane, Webhook) serão adicionados nas próximas fases de implementação.

---

## Schema do banco (7 tabelas)

| Tabela | Finalidade |
|---|---|
| `Product` | Produtos clientes — apikey (hash), adapterType, vpsId |
| `VpsServer` | Máquinas com provider — credenciais AES-256-GCM |
| `Instance` | Instâncias WhatsApp vinculadas a produto + VPS |
| `WebhookConfig` | URL + secret HMAC + filtro de eventos por produto |
| `AuditLog` | Log assíncrono de todas as requests |
| `HealthCheck` | Histórico de health checks por VPS |
| `BatchJob` | Histórico eterno de disparos em lote (billing) |

Migration única aplicada: `20260416170815_init_complete`

---

## Estrutura do projeto

```
softconnect/
├── prisma/
│   ├── schema.prisma          # Schema completo — 7 modelos
│   ├── seed.ts                # Dados de desenvolvimento
│   └── migrations/
│       └── 20260416170815_init_complete/
│           └── migration.sql  # Migration única com todo o schema
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── app.controller.ts
│   └── app.service.ts
├── docker-compose.yaml        # Infra completa (Postgres + Redis + app)
├── Dockerfile                 # Multi-stage build
└── .env                       # Variáveis de ambiente (não comitar)
```

---

---

## 🏷️ Versionamento de imagens Docker

O SoftConnect usa **Semantic Versioning (SemVer)** com Git Tags para versionar imagens no GitHub Container Registry (GHCR). A fonte da verdade é sempre o Git Tag — automático, rastreável e à prova de erros humanos.

### Fluxo de desenvolvimento → produção

```
feature branch (develop) 
  ↓
Merge em develop (1º tag: v0.1.0-dev)
  ↓
Testes e validação
  ↓
Merge develop → main (2º tag: v1.0.0)
  ↓
Produção
```

### O que é publicado quando

| Evento | Tags publicadas no GHCR | Ambiente |
|--------|------------------------|----------|
| `push` na `develop` | `dev` + `dev-abc1234` | Desenvolvimento contínuo |
| `git tag v0.1.0-dev` | `0.1.0-dev` + `dev` + `dev-abc1234` | Dev versionada |
| `git tag v0.1.0-beta` | `0.1.0-beta` + `dev` + `dev-abc1234` | Dev candidata |
| `push` na `main` | `latest` + `prod-abc1234` | Produção contínua |
| `git tag v1.0.0` | `1.0.0` + `1.0` + `1` + `latest` + `prod-abc1234` | Produção versionada |

### Exemplo prático — ciclo completo

#### 1️⃣ Développeur cria feature branch

```bash
git checkout -b feat/novo-adapter
# ... implementa, faz commits ...
# Push para GitHub e abre PR
```

#### 2️⃣ PR aprovada → merge em `develop`

```bash
# No GitHub, clique em "Squash and merge" ou "Rebase and merge"
# Isso publica automaticamente: dev + dev-abc1234
# Teste em dev-api.hub.softconnect.net.br
```

#### 3️⃣ Após validar em dev → criar tag de pre-release

```bash
git checkout develop
git pull origin develop

# Tag de candidata (pronta para testes finais)
git tag -a v0.1.0-dev -m "feat: novo adapter + auditoria melhorada"
git push origin v0.1.0-dev

# Publica: 0.1.0-dev + dev + dev-abc1234
# Portainer de dev aponta para: 0.1.0-dev
```

#### 4️⃣ Após validar em dev → merge `develop` na `main`

```bash
git checkout main
git pull origin main

git merge develop -m "Merge branch 'develop' into 'main' — v0.1.0-dev validada"
git push origin main

# Publica automaticamente: latest + prod-abc1234
```

#### 5️⃣ Na `main` → criar tag de release

```bash
git checkout main
git pull origin main

# Tag de produção (semantic versioning)
git tag -a v1.0.0 -m "release: primeiro release estável — Admin Plane completo"
git push origin v1.0.0

# Publica: 1.0.0 + 1.0 + 1 + latest + prod-abc1234
# Portainer de prod aponta para: 1.0.0
```

### Nomenclatura de tags

| Padrão | Exemplo | Significado | Quando criar |
|--------|---------|-------------|--------------|
| `v0.X.Y-dev` | `v0.1.0-dev` | Feature em desenvolvimento | Após merge em `develop` |
| `v0.X.Y-beta` | `v0.2.0-beta` | Candidata a release | Pronta para QA final |
| `v0.X.Y-rc.N` | `v1.0.0-rc.1` | Release Candidate | Última validação antes de estável |
| `vX.Y.Z` | `v1.0.0` | Release estável | Aprovada para produção |

### Como fixar versão no Portainer

Ao invés de deixar `latest` (que muda a cada push), aponte para versão exata:

**Stack de desenvolvimento (`docker-compose.dev.yaml`):**
```yaml
services:
  api:
    image: ghcr.io/softcominnovation/softconnect:0.1.0-dev  # ← Fixo
```

**Stack de produção (`docker-compose.yaml`):**
```yaml
services:
  api:
    image: ghcr.io/softcominnovation/softconnect:1.0.0  # ← Fixo
```

### Rollback em caso de erro

Se um bug crítico for descoberto em produção:

```bash
# No Portainer: edite a stack e troque
# De: ghcr.io/softcominnovation/softconnect:1.0.0
# Para: ghcr.io/softcominnovation/softconnect:1.0.0-rc.1  (versão anterior validada)

# Re-pull image → Deploy
# Rollback completo em menos de 2 minutos ✅
```

### Checklist de versionamento

- ✅ Criar feature branch a partir de `develop`
- ✅ Implementar e fazer commits semânticos (`feat:`, `fix:`, etc.)
- ✅ PR + code review
- ✅ Merge em `develop` → Actions publica `dev`
- ✅ Validar em `dev-api.hub.softconnect.net.br`
- ✅ `git tag -a vX.Y.Z-dev` (opcional, para marcar candidata)
- ✅ Merge `develop` → `main`
- ✅ `git tag -a vX.Y.Z` na `main` → Actions publica semver
- ✅ Validar em `api.hub.softconnect.net.br`
- ✅ Documentar mudanças em GitHub Releases
