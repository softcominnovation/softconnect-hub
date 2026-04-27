# SoftConnect 2.0 — Plano de Implementação

> **Guia de execução do projeto por fases.**
> Cada fase possui tarefas de implementação, testes onde aplicável, e um **gate de validação do desenvolvedor** que deve ser deliberadamente confirmado antes de avançar para a próxima fase.

---

## ⚠️ Regra de Progressão — Leia antes de tudo

**Para agentes de IA e desenvolvedores:**

> Nenhuma fase pode ser iniciada sem que a fase anterior tenha sido **explicitamente aprovada** pelo desenvolvedor responsável.
>
> A aprovação consiste em:
> 1. Todos os itens da fase marcados como `[x]`
> 2. O item **"✅ Validação do Desenvolvedor"** marcado como `[x]`
> 3. O desenvolvedor ter **deliberadamente solicitado** o avanço para a próxima fase
>
> Um agente de IA **nunca deve sugerir iniciar a próxima fase** sem que essas condições estejam satisfeitas. Se uma fase estiver incompleta ou o gate de validação não estiver marcado, o agente deve aguardar instrução explícita.

---

## Estado Atual do Projeto

| Fase | Status |
|------|--------|
| **Passo 0** — Pipeline CI/CD | ✅ **100% Concluído** |
| **Passo 1** — Fundações da Infraestrutura | ✅ **100% Concluído — Gate de validação aprovado** |
| **Passo 2** — Admin Plane & Segurança | ✅ **100% Concluído — Gate de validação aprovado** |
| **Passo 2.5** — Dashboard Auth & Usuários Admin | ✅ **100% Concluído — Gate de validação aprovado** |
| **Passo 3** — Dynamic Adapters & Adapter Registry | ✅ **100% Concluído — Gate de validação aprovado** |
| **Passo 4** — Implementação do EvolutionAdapter | ✅ **100% Concluído — Gate de validação aprovado** |
| **Swagger (incremental)** — Admin API + tipagem completa | ✅ **Implementado — rotas admin com schemas, params e query docs** |
| **Global prefix `/api/v1`** — todas as rotas da API | ✅ **Implementado — `app.setGlobalPrefix('api/v1')` em `main.ts` e `app.helper.ts`** |
| Passos 5 em diante | 🔒 Bloqueados até aprovação do Passo 4 |

---

### 📄 Estratégia Incremental de Swagger

O Swagger é expandido à medida que cada passo é implementado. **Nunca adicionar endpoints ao Swagger antes de sua implementação estar completa.**

**Convenção de rotas de documentação (imutável):**
- `/docs/admin` — exclusivo para o **Admin Plane** (rotas `/api/v1/admin/*`, autenticação JWT Bearer)
- `/docs/data` — exclusivo para o **Data Plane** (rotas `/api/v1/instance/*`, `/api/v1/message/*`, `/api/v1/chat/*`, `/api/v1/webhook/*`, autenticação `apikey`)

**Prefixo global da API:** todas as rotas possuem o prefixo `/api/v1` configurado via `app.setGlobalPrefix('api/v1')` no `main.ts`. O filtro de paths do Swagger Admin usa `/api/v1/admin`.

Cada rota de Swagger exibe **apenas as tags e endpoints do seu escopo** — nunca misturar Admin e Data Plane em uma mesma rota de docs. Novos módulos futuros devem seguir esta convenção ao ser adicionados ao `main.ts`.

| Passo | Endpoints a adicionar | Rota de docs |
|-------|-----------------------|--------------|
| ✅ Passos 2, 2.5, 3, 4 | Todas as rotas `/admin/*` — **já documentadas** | `/docs` |
| ✅ Passo 5 | `/instance/*`, `/message/*` (exceto batch), `/chat/*`, `/webhook/*` | `/docs/data` |
| Passo 6 | `POST /message/sendText/{instance}/batch`, `GET /message/batch/{batchJobId}/status` | `/docs/data` |
| Passo 7 | `GET /admin/health`, `GET /admin/logs` | `/docs` |

---

## Passo 0: Pipeline de CI/CD

*Objetivo: Garantir que qualquer push faça deploy automático no servidor antes de escrever a primeira feature.*

- [x] Criar repositório no GitHub e fazer push inicial do projeto
- [x] Criar `.github/workflows/deploy-prod.yml` — build + push GHCR + webhook Portainer ao mergear em `main`
- [x] Criar `.github/workflows/deploy-dev.yml` — build + push GHCR + webhook Portainer ao mergear em `develop`
- [x] Criar stacks no Portainer: `softconnect-prod` (docker-compose.yaml) e `softconnect-dev` (docker-compose.dev.yaml)
- [x] Configurar secrets no GitHub: `PORTAINER_WEBHOOK_PROD` e `PORTAINER_WEBHOOK_DEV`
- [x] Configurar DNS: `api.hub.softconnect.net.br` → prod, `dev-api.hub.softconnect.net.br` → dev
- [x] Validar primeiro deploy automático end-to-end (push → Actions → GHCR → Portainer → container rodando)

### ✅ Validação do Desenvolvedor — Passo 0

- [x] **Gate concluído.** Pipeline validado end-to-end. Passo 0 aprovado para continuidade.

---

## Passo 1: Fundações da Infraestrutura

*Objetivo: Subir a carcaça da aplicação, comunicação básica com banco e containerização.*

- [x] Inicializar o projeto NestJS com Fastify + FastifyAdapter
- [x] Criar `docker-compose.yaml` (stack de produção: Swarm, Traefik, réplicas)
- [x] Criar `docker-compose.dev.yaml` (stack de desenvolvimento com 1 réplica e DB separado)
- [x] Criar `Dockerfile` multi-stage (builder + production com Prisma CLI copiado)
- [x] Implementar schema completo do BD — 7 tabelas: `Product`, `VpsServer`, `Instance`, `WebhookConfig`, `AuditLog`, `HealthCheck`, `BatchJob`
- [x] Consolidar em 1 única migration limpa: `20260416170815_init_complete`
- [x] Criar `prisma/seed.ts` com dados de desenvolvimento (VPS EvoLab 02, Produto Softcomshop, WebhookConfig N8N)
- [x] Configurar `@nestjs/config` com Zod para validação de variáveis de ambiente no startup
- [x] Criar `.env.example` com instruções de geração das chaves secretas
- [x] Criar `.gitignore` e `README.md` completo com guia de setup

### ✅ Validação do Desenvolvedor — Passo 1

- [x] **Revisar o schema Prisma final** e confirmar que todas as 7 tabelas, FKs, índices únicos e relações inversas estão corretas e condizem com a especificação técnica
- [x] **Verificar o seed** — executar `prisma db seed` e confirmar que os dados de desenvolvimento sobem corretamente
- [x] **Testar o container** — subir com `docker-compose.dev.yaml` e confirmar que a aplicação inicializa sem erros, conecta ao Postgres e ao Redis
- [x] **Revisão arquitetural geral** — verificar se há ajustes, melhorias ou correções antes de entrar na fase de codificação dos módulos

> **✅ Gate de validação do Passo 1 APROVADO.** Infraestrutura pronta para avançar ao Passo 2 — Admin Plane & Segurança.

---

## Passo 2: Admin Plane & Segurança

*Objetivo: Ter os endpoints de gestão de produtos e VPS funcionando, com autenticação completa.*

### 2.1 — Módulos de infraestrutura do NestJS

- [x] Criar `PrismaModule` com `PrismaService` injetável (wrapper do `PrismaClient` como `@Injectable()`)
- [x] Criar `CacheModule` com `CacheService` — abstração ioredis com helpers de TTL (`get`, `set`, `del`, `setWithTTL`)
- [x] Criar `ConfigModule` com `config.schema.ts` validando todas as variáveis obrigatórias via Zod no bootstrap

### 2.2 — Autenticação

- [x] Implementar `JwtGuard` para o Admin Plane
- [x] Criar endpoint `POST /admin/auth/login` retornando JWT com `ADMIN_JWT_EXPIRY` (24h padrão)
- [x] Implementar `ApiKeyGuard` — Redis-first, cache `auth:{apiKeyHash}` com `{ productId, isActive, origins[], hubRelay, adapterType, vpsId }` (incluir **obrigatoriamente** o `vpsId`)
- [x] Implementar `IpWhitelistGuard` para `/internal/webhook/*`

### 2.3 — CRUD Admin: Produtos

- [x] `POST /admin/products` — geração de apikey, hash SHA-256, vínculo com `vpsId`
- [x] `GET /admin/products` — listar produtos
- [x] `PUT /admin/products/:id` — atualizar (incluindo `adapterType`) + invalidar cache Redis
- [x] `DELETE /admin/products/:id` — desativar produto + invalidar cache Redis

### 2.4 — CRUD Admin: VPS

- [x] `POST /admin/vps` — cadastrar VPS com `providerApiKey` criptografado via AES-256-GCM
- [x] `GET /admin/vps` — listar VPS (retornar `providerApiKey` descriptografado apenas para admin autenticado)
- [x] `PUT /admin/vps/:id` — atualizar VPS + re-criptografar credenciais se alteradas
- [x] `DELETE /admin/vps/:id` — desativar VPS

### 2.5 — Testes

- [x] Testes unitários: `ApiKeyGuard` (HIT e MISS no Redis), `JwtGuard`, `IpWhitelistGuard`
- [x] Testes unitários: `CacheService` (get/set/del/TTL)
- [x] Testes de integração (e2e com supertest): fluxo completo de criação, leitura e atualização de produto e VPS
- [x] Verificar que a aplicação **não sobe** com variável obrigatória ausente (teste do ConfigModule + Zod)

### ✅ Validação do Desenvolvedor — Passo 2

- [x] Testar manualmente o fluxo completo: criar produto via admin → autenticar com a apikey gerada → confirmar que o guard valida corretamente
- [x] Confirmar que a criptografia AES-256-GCM das credenciais das VPS funciona (encrypt → armazenar → decrypt)
- [x] Revisar os objetos cacheados no Redis e confirmar que `vpsId` e `adapterType` estão presentes em `auth:{apiKeyHash}`
- [x] Avaliar necessidade de ajustes, melhorias ou correções antes de avançar

---

## Passo 2.5: Dashboard Auth & Usuários Admin

*Objetivo: Permitir que humanos se autentiquem no painel admin com email/senha e gerenciem outros usuários admin. Auth machine (ADMIN_SECRET) continua funcionando em paralelo.*

- [x] Instalar `bcryptjs` (sem binários nativos)
- [x] Adicionar `ALLOW_BOOTSTRAP` em `config.schema.ts`
- [x] Adicionar modelos `AdminUser` e `AdminActivityLog` em `schema.prisma`
- [x] Executar `prisma generate` (migration SQL criada manualmente — aplicar com `npx prisma migrate dev` quando banco disponível)
- [x] Criar `src/admin/activity/activity.service.ts` — fire-and-forget, `findAll` paginado
- [x] Criar `src/admin/activity/activity.controller.ts` — `GET /admin/activity` com JwtGuard
- [x] Criar `src/admin/activity/activity.module.ts` — exporta `AdminActivityService`
- [x] Criar `src/admin/dashboard-auth/dto/dashboard-login.dto.ts`
- [x] Criar `src/admin/dashboard-auth/dashboard-auth.service.ts` — login com bcrypt, getMe
- [x] Criar `src/admin/dashboard-auth/dashboard-auth.controller.ts` — POST login, GET /me
- [x] Criar `src/admin/dashboard-auth/dashboard-auth.module.ts`
- [x] Criar `src/admin/users/dto/create-user.dto.ts` e `update-user.dto.ts`
- [x] Criar `src/admin/users/users.service.ts` — bootstrap, create, findAll, update, deactivate
- [x] Criar `src/admin/users/users.controller.ts` — todos os endpoints CRUD + bootstrap
- [x] Criar `src/admin/users/users.module.ts`
- [x] Atualizar `app.module.ts` — importar os 3 novos módulos
- [x] Testes unitários: `activity.service.spec.ts`, `dashboard-auth.service.spec.ts`, `users.service.spec.ts` (16 testes, todos passando)
- [x] Criar `ignored-docs/passo-extra-testes.md` e `ignored-docs/passo-extra-curls.md`

### ✅ Validação do Desenvolvedor — Passo 2.5

- [x] Executar `npx prisma migrate dev` com banco disponível para aplicar a migration
- [x] Bootstrap cria admin corretamente com `ALLOW_BOOTSTRAP=true`
- [x] Bootstrap rejeita secret inválido (403) e admin duplicado (409)
- [x] Login retorna JWT com `sub` = UUID do usuário
- [x] GET /me retorna dados sem `passwordHash`
- [x] CRUD de usuários funciona via token dashboard
- [x] Activity log registra ações corretamente
- [x] Auth machine (via `ADMIN_SECRET`) continua funcionando em paralelo

---

## Passo 3: Dynamic Adapters & Adapter Registry

*Objetivo: Inserir a essência multi-provider do Hub — resolução dinâmica de adapter por produto.*

### 3.1 — Contratos e Registry

- [x] Criar interface `WhatsAppProvider` completa com todos os métodos tipados e `ProviderContext` por chamada (conforme `softconnect-spec-tecnica.md`, seção 6)
- [x] Criar `AdapterRegistryService` — `Map<string, WhatsAppProvider>` com `register`, `get` e `getAvailableTypes`
- [x] Criar `AdapterResolverService` — `resolve(adapterType)` delegando para o registry
- [x] Criar `ProviderModule` exportando Registry e Resolver
- [x] Criar `GET /admin/adapters` — retorna lista de adapters disponíveis em runtime (lista o registry)

### 3.2 — Testes

- [x] Testes unitários: `AdapterRegistryService` — registro de adapter, resolução por type, erro ao type não registrado
- [x] Testes unitários: `AdapterResolverService` — resolução correta e propagação de erro de type inválido

### ✅ Validação do Desenvolvedor — Passo 3

- [x] Confirmar que a interface `WhatsAppProvider` está completa e condiz com todos os endpoints mapeados na spec
- [x] Confirmar que `AdapterRegistry` funciona corretamente em memória (sem estado externo)
- [x] Avaliar ajustes ou adições de métodos à interface antes de implementar o primeiro adapter

---

## Passo 4: Implementação do EvolutionAdapter

*Objetivo: Validar que o Registry funciona ligando o provider atual (Evolution API).*

### 4.1 — Evolution HTTP Client

- [x] Criar `EvolutionHttp` — cliente Axios com `keepAlive: true`, timeout configurável (`PROXY_TIMEOUT_MS`), retry (`PROXY_MAX_RETRIES`) e circuit breaker por VPS (5 falhas → abrir, 30s → half-open)

### 4.2 — Evolution Adapter

- [x] Criar `EvolutionAdapter` implementando **todos** os métodos de `WhatsAppProvider`
- [x] Métodos de instância: `createInstance`, `fetchInstances`, `connectInstance`, `getConnectionState`, `restartInstance`, `logoutInstance`, `deleteInstance`
- [x] Métodos de mensagem: `sendText`, `sendMedia`, `sendWhatsAppAudio`, `sendButtons`, `sendList`, `sendLocation`, `sendContact`, `sendReaction`
- [x] Métodos de chat: `findChats`, `findMessages`, `findContacts`, `checkNumber`
- [x] Métodos de webhook: `setWebhook`, `findWebhook`
- [x] Criar `EvolutionModule` e registrar o adapter no `AdaptersModule` no `onModuleInit`

### 4.3 — Testes

- [x] Testes unitários: cada método do adapter com mock do `EvolutionHttp` — verificar que `ProviderContext` é passado corretamente para as chamadas HTTP
- [x] Testes unitários: circuit breaker — simular 5 falhas consecutivas e verificar abertura do breaker
- [x] Testes e2e: `GET /admin/adapters` — verificar que adapter `evolution` está registrado em runtime
- [x] Testes de integração (opcional, com instância Evolution real em dev): criar instância e verificar resposta

### ✅ Validação do Desenvolvedor — Passo 4

- [x] Testar manualmente ao menos `sendText` e `fetchInstances` com uma instância Evolution real no ambiente de dev
- [x] Confirmar que o circuit breaker funciona ao simular a VPS fora do ar
- [x] Confirmar que o adapter é stateless — mesma instância servindo chamadas com `ProviderContext` diferentes
- [x] Avaliar ajustes ou métodos adicionais necessários

---

## Passo 5: Controllers do Data Plane

*Objetivo: Expor os endpoints para uso final, ligando autenticação, resolução de instância e adapter.*

### 5.1 — Instance Resolver

- [x] Criar `InstanceResolver` — busca Redis `instance:{productId}:{instanceName}`, MISS busca no Postgres + cacheia com TTL 300s
- [x] Retornar `ResolvedInstance { providerUrl, providerApiKey, vpsId, instanceId, adapterType }`

### 5.2 — Controllers

- [x] Criar `InstanceController` com todos os endpoints de instância
- [x] Criar `MessageController` com todos os endpoints de mensagem (exceto batch — Passo 6)
- [x] Criar `ChatController` com todos os endpoints de chat
- [x] Criar `WebhookController` com `set` e `find`, aplicando lógica de `hubRelay` no set

### 5.3 — Interceptors e infraestrutura transversal

- [x] Criar `AuditInterceptor` — captura request/response e dispara `auditService.log(data)` **sem await**
- [x] Criar `AuditService` — buffer write-behind, flush a cada `AUDIT_FLUSH_INTERVAL_MS` ou `AUDIT_FLUSH_BATCH_SIZE` registros
- [x] Configurar rate limiting via Redis (chave `rate:{productId}`, janela 1s) — `RateLimitGuard` implementado
- [x] Criar `TimeoutInterceptor` e `HttpExceptionFilter` globais

### 5.4 — Testes

- [x] Testes de integração (e2e): hot path completo `sendText` — verificar latência < 10ms de overhead do Hub (excluindo a chamada ao provider)
- [x] Testes de integração: `ApiKeyGuard` — apikey inválida retorna 401, apikey inativa retorna 401
- [x] Testes de integração: rate limit excedido retorna 429
- [x] Testes unitários: `AuditService` — verificar que o buffer faz flush por tamanho e por tempo
- [x] Testes unitários: `InstanceResolver` — HIT no Redis, MISS com fallback ao Postgres e cache posterior

### ✅ Validação do Desenvolvedor — Passo 5

- [x] Testar o fluxo completo end-to-end: produto autenticado → resolver instância → enviar mensagem real → verificar log de auditoria no banco
- [x] Medir latência real de overhead do Hub em ambiente dev (meta: < 10ms excluindo provider)
- [x] Verificar que o cache de instâncias é invalidado corretamente ao criar/deletar instância
- [x] Revisar o mapeamento completo de endpoints e confirmar paridade com a Evolution API 2.3.7
- [x] Avaliar ajustes, otimizações ou correções antes de avançar

> **🔒 O Passo 6 só pode ser iniciado após este gate estar concluído e o desenvolvedor solicitar explicitamente.**

---

## Passo 6: Filas Assíncronas & Envio em Lote (BullMQ)

> **🔒 Este passo está bloqueado. O Passo 5 deve ser concluído e o gate de validação do desenvolvedor aprovado antes de iniciar qualquer tarefa aqui.**

*Objetivo: Implementar o sistema de enfileiramento para disparos em lote e relay de webhook, sem causar gargalos.*

### 6.1 — Setup BullMQ

- [ ] Instalar e configurar BullMQ conectado ao Redis existente
- [ ] Criar `BullMQ Module` integrado ao `app.module.ts`

### 6.2 — Batch (envio em lote)

- [ ] Criar `BatchProducer` — publica N jobs no BullMQ com `{ batchJobId, adapterType, instanceName, providerUrl, providerApiKey, message, delayMs }` no payload de cada job
- [ ] Criar `BatchWorker` — consome jobs, resolve adapter via registry, chama `adapter.sendText(ctx, ...)`, jobs falhos vão para DLQ
- [ ] Implementar `POST /message/sendText/{instance}/batch`:
  - Inserir 1 linha em `BatchJob` no Postgres com `status: 'processing'` e `totalMessages: N`
  - Publicar N jobs no BullMQ
  - Retornar `{ batchJobId }` imediatamente ao cliente
- [ ] Implementar handler do evento `'drained'` do BullMQ — executar **1 único UPDATE** no Postgres: `sentCount`, `failedCount`, `status: 'completed'`, `completedAt`
- [ ] Implementar `GET /message/batch/{batchJobId}/status` — ler `BatchJob` do Postgres (não do Redis)

### 6.3 — Relay assíncrono de webhook (`hub_relay`)

- [ ] Criar `InternalWebhookController` — `POST /internal/webhook/{adapterType}` com `IpWhitelistGuard`
  - Responde 200 imediatamente ao provider
  - Publica job no BullMQ (relay queue)
- [ ] Criar `RelayWorker` — busca `WebhookConfig` do produto, assina HMAC-SHA256, entrega ao produto com retry automático por BullMQ

### 6.4 — Testes

- [ ] Testes de integração: disparar um lote de 5 mensagens e verificar que o `BatchJob` no Postgres tem `status: 'completed'` ao final com `sentCount` e `failedCount` corretos
- [ ] Testes de integração: simular falha em 2 mensagens do lote e verificar `failedCount = 2` no `BatchJob`
- [ ] Testes unitários: `BatchProducer` — verificar que `batchJobId` está presente no payload de cada job
- [ ] Testes unitários: `RelayWorker` — verificar que a assinatura HMAC-SHA256 é gerada corretamente

### ✅ Validação do Desenvolvedor — Passo 6

- [ ] Disparar um lote real em dev e acompanhar a execução no Portainer (logs)
- [ ] Confirmar que o `BatchJob` no Postgres reflete corretamente o resultado ao final (incluindo cenário de falhas parciais)
- [ ] Testar o endpoint de status `GET /message/batch/{batchJobId}/status` após o lote completar
- [ ] Confirmar que o relay de webhook funciona com `hub_relay: true` usando uma instância de teste
- [ ] Avaliar ajustes, melhorias ou correções

> **🔒 O Passo 7 só pode ser iniciado após este gate estar concluído e o desenvolvedor solicitar explicitamente.**

---

## Passo 7: Webhooks Completos e Health Check

*Objetivo: Finalizar o sistema de webhook pass-through, circuit breaker e monitoramento proativo de VPS.*

### 7.1 — Health Check Service

- [ ] Criar `HealthCheckService` com CRON a cada 60s
- [ ] Para cada `VpsServer` ativo: chamar health check via adapter, registrar resultado em `HealthCheck` (status, responseMs, errorMsg)
- [ ] Após 3 checks consecutivos `unhealthy`: marcar `VpsServer.isHealthy = false` + atualizar Redis `vps:health:{vpsId}`
- [ ] Recovery: ao voltar healthy, atualizar campo e Redis
- [ ] Expor `GET /admin/health` com status consolidado de todas as VPS

### 7.2 — Logs admin

- [ ] Implementar `GET /admin/logs` — consulta paginada de `AuditLog` no Postgres com filtros por produto, período e status

### ✅ Validação do Desenvolvedor — Passo 7

- [ ] Simular VPS fora do ar e confirmar que o health check marca como `isHealthy: false` após 3 tentativas
- [ ] Confirmar que o circuit breaker e o CRON de health check atuam de forma complementar (breaker em segundos, CRON em minutos)
- [ ] Testar o endpoint `GET /admin/health` e verificar que reflete o estado real das VPS

> **🔒 O Passo 8 só pode ser iniciado após este gate estar concluído e o desenvolvedor solicitar explicitamente.**

---

## Passo 8: Documentação Swagger / OpenAPI

*Objetivo: Gerar documentação interativa da API automaticamente a partir dos decorators do NestJS.*

- [ ] Instalar `@nestjs/swagger` e `swagger-ui-fastify`
- [ ] Configurar `SwaggerModule` no `main.ts` com título, versão e bearer auth
- [ ] Adicionar `@ApiTags`, `@ApiOperation`, `@ApiResponse` em todos os controllers
- [ ] Criar DTOs com `@ApiProperty` para documentação automática de request/response
- [ ] Expor documentação em `/docs` (disponível apenas em ambiente não-produção ou com auth básica)

### ✅ Validação do Desenvolvedor — Passo 8

- [ ] Acessar `/docs` e verificar que todos os endpoints estão documentados
- [ ] Confirmar que os DTOs com `@ApiProperty` cobrem todos os campos relevantes de request e response
- [ ] Testar um endpoint diretamente pelo Swagger UI e confirmar funcionamento

> **🔒 O Passo 9 só pode ser iniciado após este gate estar concluído e o desenvolvedor solicitar explicitamente.**

---

## Passo 9: Deploy, Homologação e Produção

*Objetivo: Validar tudo no ambiente real antes de entregar para uso em produção.*

- [ ] Deploy em homologação via branch `develop` → `dev-api.hub.softconnect.net.br`
- [ ] Validar todos os endpoints com a equipe apontando para instância de teste (Atendentebot-Test)
- [ ] Executar testes e2e completos contra o ambiente de homologação
- [ ] Promover para produção via PR `develop` → `main` → deploy automático em `api.hub.softconnect.net.br`
- [ ] Criar git tag de release estável: `git tag -a v1.0.0 -m "Release v1.0.0"` e push
- [ ] Monitorar logs, health checks e métricas nas primeiras 24h em produção

### ✅ Validação do Desenvolvedor — Passo 9

- [ ] Confirmar que todos os endpoints respondem conforme esperado em produção com a primeira apikey real
- [ ] Verificar métricas de latência em produção (meta: overhead < 10ms)
- [ ] Confirmar que os logs de auditoria estão sendo gravados corretamente no Postgres
- [ ] Confirmar que o pipeline CI/CD continua operacional após o primeiro deploy de produção
- [ ] **Marco final:** projeto em produção — avaliar próximas iterações, melhorias e novos adapters

---

*SoftConnect 2.0 · Softcom · Plano de Implementação*
