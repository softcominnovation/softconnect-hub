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
| **Passo 2.5** — Dashboard Auth & Usuários Admin | ⏳ **Implementado — Aguardando gate de validação** |
| **Passo 3** — Dynamic Adapters & Adapter Registry | ✅ **100% Concluído — Gate de validação aprovado** |
| **Passo 4** — Implementação do EvolutionAdapter | ⏳ **Implementado — Aguardando gate de validação** |
| **Passo 4.5** — Arquitetura Multi-Provider | ✅ **Implementado — 128/128 testes — Aguardando gate de validação** |
| **Swagger (incremental)** — Admin API + tipagem completa | ✅ **Implementado — rotas admin com schemas, params e query docs** |
| **Global prefix `/api/v1`** — todas as rotas da API | ✅ **Implementado — `app.setGlobalPrefix('api/v1')` em `main.ts`** |
| **Passo 5** — Controllers do Data Plane | ✅ **100% Concluído — Gate de validação aprovado** |
| **Passo 5.5** — Correções de Contrato & Novos Módulos (sessão 24/04) | ✅ **Aplicado — 91/91 testes, build limpo** |
| **Passo 5.6** — Migração para ID-Based Routing no Data Plane | ✅ **Implementado — aguardando gate de validação** |
| **Passo 6** — Filas Assíncronas & Envio em Lote (BullMQ) | ✅ **100% Concluído — Gate de validação aprovado** |
| **Passo 6.5** — Reorganização de Módulos (`src/modules/`) | ✅ **Implementado — build limpo, 98/98 testes — Aguardando gate de validação** |
| **Passo 6.6** — Separação de Workers de Batch (Fase 1 + Fase 2) | ✅ **Implementado — Aguardando gate de validação** |
| **Migration consolidada** — `20260428000000_consolidated_schema` | ✅ **Implementado — migration única consolidada com IF NOT EXISTS** |
| **Import Evolution → Hub** — endpoints de migração de instâncias | ✅ **Implementado — `POST .../import` e `POST .../import/bulk`** |
| **VPS `notes` field** — campo de anotações livres na VpsServer | ✅ **Implementado — schema, migration, DTOs, service — 118/118 testes** |
| Passos 7 em diante | 🔒 Bloqueados até aprovação do Passo 6.5 |
| **Passo 7.5** — Batch Webhook Notification | ✅ **Implementado — 118/118 testes — Aguardando gate de validação** |
| **Instance Defaults** — Webhook e Proxy padrão por produto (Evolution) | ✅ **Implementado — schema, migration, DTOs, admin endpoints, adapter, instance service — build limpo** |

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

> 📄 Tutorial CI/CD completo: `docs/softconnect-cicd-tutorial.html`
> 📄 Tutorial de versionamento Docker: `docs/softconnect-docker-versioning-tutorial.html`

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

## Passo 4.5: Arquitetura Multi-Provider

*Objetivo: Separar `VpsServer` (máquina) de `VpsProvider` (endpoint de API), permitindo que uma VPS hospede N providers independentes com adapters distintos.*

### 4.5.1 — Schema & Migration

- [x] Criar modelo `VpsProvider` no `schema.prisma` com campos: `id`, `vpsId`, `label`, `providerUrl`, `providerApiKey` (AES-256-GCM), `adapterType`, `isActive`, `isHealthy`, `lastHealthAt`, `createdAt`, `updatedAt`
- [x] Remover campos `providerUrl`, `providerApiKey`, `adapterType`, `isHealthy`, `lastHealthAt` de `VpsServer`
- [x] Adicionar `vpsProviderId` em `Product` (FK → `VpsProvider`) substituindo `vpsId` (FK → `VpsServer`)
- [x] Adicionar `vpsProviderId` em `Instance` substituindo relação direta com `VpsServer`
- [x] Adicionar `vpsProviderId` em `HealthCheck` substituindo `vpsId`
- [x] Criar migration `20260508000000_init_multi_provider` — migration única (reset + seed)
- [x] Executar `prisma migrate reset --force` + `npx prisma generate`
- [x] Criar backup: `backup_whatshub_20260508_181218.dump`

### 4.5.2 — VPS Provider CRUD (Admin Plane)

- [x] Criar `CreateVpsProviderDto` e `UpdateVpsProviderDto`
- [x] Criar `VpsProviderService` com métodos: `create`, `findAll`, `update`, `deactivate`
- [x] Criar `VpsProviderController` com rotas aninhadas sob `vps/:vpsId/providers`
- [x] Criar `VpsProviderModule` e registrar em `AdminModule`
- [x] `PUT /vps/:vpsId/providers/:id` invalida cache Redis das instâncias do provider ao mudar `providerUrl`/`providerApiKey`

### 4.5.3 — Atualização dos serviços existentes

- [x] Atualizar `VpsService`: remover campos de provider do DTO, incluir `providers[]` na resposta de `findAll`
- [x] Atualizar `ProductService`: `vpsId` → `vpsProviderId` em todos os DTOs, queries e respostas
- [x] Atualizar `ApiKeyGuard`: `AuthCachePayload.vpsId` → `vpsProviderId`; query Prisma usa `vpsProviderId`
- [x] Atualizar `InstanceResolverService`: `ResolvedInstance.vpsId` → `vpsProviderId`; `include: { vpsProvider: true }` em vez de `vps`
- [x] Atualizar `AdminInstancesService`: todas as referências `vps.providerUrl` → `vpsProvider.providerUrl`
- [x] Atualizar `IpWhitelistGuard`: consulta `vpsProvider.findFirst` para validar IP do webhook interno
- [x] Atualizar `HealthCheckService`: `runChecks()` itera `VpsProvider` (não `VpsServer`); `VpsHealthStatus` ganha array aninhado `providers[]` (com seus respectivos dados individuais); chaves Redis atualizadas.

### 4.5.4 — Testes

- [x] Todos os testes existentes atualizados para o novo schema (128/128 passando)
- [x] `tsc --noEmit`: 0 erros
- [x] ESLint: 0 erros de lógica

### 4.5.5 — Documentação gerada

- [x] Criar `docs/softconnect-spec-multi-provider.md` — spec técnica completa da arquitetura multi-provider
- [x] Criar `docs/softconnect-manager-frontend-changes.md` — guia de breaking changes para o agente de frontend
- [x] Criar `docs/multi-provider-impact-analysis.html` — análise de impacto de todos os 57 endpoints

### ✅ Validação do Desenvolvedor — Passo 4.5

- [ ] Verificar que `POST /admin/vps/:vpsId/providers` cria provider e persiste `providerApiKey` encriptado
- [ ] Verificar que `GET /admin/products` retorna `vpsProviderId` (não `vpsId`)
- [ ] Verificar que `POST /api/v1/instance/create` ainda funciona com produto vinculado a `VpsProvider`
- [ ] Confirmar que Redis não tem entradas antigas de `auth:*` após flush
- [x] Confirmar que `GET /admin/health` retorna agrupado por VPS (com os status na raiz da VPS)
- [x] Manter o parâmetro `:vpsId` em `health.controller.ts` para buscar detalhes detalhados da VPS (não usar providerId na rota de detalhes da VPS)
- [ ] Atualizar `softconnect-spec-tecnica.md` com schema atualizado (issue I-03)

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
- [x] Criar `AuditService` — buffer write-behind, flush a cada `AUDIT_FLUSH_INTERVAL_MS` ou `AUDIT_FLUSH_BATCH_SIZE` registros; backpressure com `AUDIT_BUFFER_MAX_SIZE` (load shedding + log de alerta por episódio)
- [x] Configurar rate limiting via Redis (chave `rate:{productId}`, janela 1s) — `RateLimitGuard` implementado
- [x] Criar `TimeoutInterceptor` e `HttpExceptionFilter` globais

### 5.4 — Testes

- [x] Testes de integração (e2e): hot path completo `sendText` — verificar latência < 10ms de overhead do Hub (excluindo a chamada ao provider)
- [x] Testes de integração: `ApiKeyGuard` — apikey inválida retorna 401, apikey inativa retorna 401
- [x] Testes de integração: rate limit excedido retorna 429
- [x] Testes unitários: `AuditService` — verificar que o buffer faz flush por tamanho e por tempo; verificar backpressure (descarte acima do limite, log de alerta único por episódio, recuperação)
- [x] Testes unitários: `InstanceResolver` — HIT no Redis, MISS com fallback ao Postgres e cache posterior

### ✅ Validação do Desenvolvedor — Passo 5

- [x] Testar o fluxo completo end-to-end: produto autenticado → resolver instância → enviar mensagem real → verificar log de auditoria no banco
- [x] Medir latência real de overhead do Hub em ambiente dev (meta: < 10ms excluindo provider)
- [x] Verificar que o cache de instâncias é invalidado corretamente ao criar/deletar instância
- [x] Revisar o mapeamento completo de endpoints e confirmar paridade com a Evolution API 2.3.7
- [x] Avaliar ajustes, otimizações ou correções antes de avançar

---

## Passo 5.5: Correções de Contrato & Novos Módulos

*Objetivo: Alinhar todos os endpoints e contratos do Data Plane à Evolution API 2.3.7, adicionar novos módulos Settings e Proxy, reestruturar o batch e corrigir o formato do webhook.*

### 5.5.1 — Remoção de endpoints descontinuados

- [x] Remover `sendWhatsAppAudio`, `sendButtons`, `sendLocation`, `sendContact`, `sendReaction` da interface `WhatsAppProvider`
- [x] Remover os 5 métodos do `EvolutionAdapter`
- [x] Remover os 5 métodos do `MessageService`
- [x] Remover os 5 endpoints do `MessageController` e seus DTOs correspondentes (`SendAudioDto`, `SendButtonsDto`, `SendLocationDto`, `SendContactDto`, `SendReactionDto`)

### 5.5.2 — Novos endpoints de mensagem

- [x] Adicionar `sendDocument` (mapeia para `/message/sendMedia` com `mediatype: 'document'` injetado)
- [x] Adicionar `sendSticker` (mapeia para `/message/sendSticker`)
- [x] Adicionar `sendPresence` (mapeia para `/message/sendPresence`)
- [x] Criar DTOs: `SendDocumentDto`, `SendStickerDto`, `SendPresenceDto` com `@ApiProperty`

### 5.5.3 — GET `/instance/:instanceName`

- [x] Adicionar endpoint `GET /instance/:instanceName` no `InstanceController`
- [x] Adicionar método `fetchInstance` no `InstanceService` e no `EvolutionAdapter`
- [x] Adapter mapeia para `GET /instance/fetchInstances?instanceName={name}`

### 5.5.4 — Reestruturação do batch

- [x] Criar `MessageBatchController` em `@Controller('message/batch')` (mesmo arquivo do `MessageController`)
- [x] Endpoints: `POST send-text/:instance`, `POST send-media/:instance`, `POST send-document/:instance`, `GET :jobId/status`, `DELETE :jobId`
- [x] Registrar `MessageBatchController` no `MessageModule`
- [x] Adicionar `sendBatchMedia`, `sendBatchDocument`, `deleteBatch` no `MessageService`
- [x] Criar DTOs: `SendBatchMediaDto`, `SendBatchDocumentDto`
- [x] Generalizar `BatchProducer.addJobs` para `messages: unknown[]` (suporte a qualquer tipo de mensagem)

### 5.5.5 — Correção do formato do Webhook

- [x] Corrigir `SetWebhookDto` para formato Evolution: `{ webhook: { enabled, url, headers?, byEvents?, base64?, events? } }`
- [x] Criar `WebhookPayloadDto` e `ToggleWebhookDto`
- [x] Adicionar `POST /webhook/toggle/:instance` no `WebhookController`
- [x] Atualizar `WebhookService.setWebhook` para o novo formato de DTO (incluindo a lógica de `hubRelay`)
- [x] Adicionar `toggleWebhook` no `WebhookService` e `EvolutionAdapter`
- [x] Adicionar `toggleWebhook` na interface `WhatsAppProvider`

### 5.5.6 — Módulo Settings

- [x] Criar `src/settings/` com `settings.controller.ts`, `settings.service.ts`, `dto/settings.dto.ts`, `settings.module.ts`
- [x] Endpoints: `POST /settings/set/:instance`, `GET /settings/find/:instance`
- [x] Registrar `SettingsModule` no `AppModule`

### 5.5.7 — Módulo Proxy

- [x] Criar `src/proxy/` com `proxy.controller.ts`, `proxy.service.ts`, `dto/proxy.dto.ts`, `proxy.module.ts`
- [x] Endpoints: `POST /proxy/set/:instance`, `GET /proxy/find/:instance`
- [x] Registrar `ProxyModule` no `AppModule`

### 5.5.8 — Testes e validação

- [x] Atualizar `evolution.adapter.spec.ts` — remover testes dos 5 métodos extintos, adicionar testes para `sendDocument`, `sendSticker`, `sendPresence`, `fetchInstance`, `setWebhook` (novo formato)
- [x] Build limpo: `EXIT:0`
- [x] Todos os testes passando: **91/91**

### ✅ Validação do Desenvolvedor — Passo 5.5

- [x] Testar `GET /api/v1/instance/:instanceName` com uma instância real
- [x] Testar os endpoints de settings e proxy com uma instância real
- [x] Confirmar que o formato do webhook `{ webhook: {...} }` é aceito pelo provider
- [x] Verificar que os 3 novos endpoints de batch funcionam corretamente (`send-text`, `send-media`, `send-document`)
- [x] Acessar `/docs/data` e confirmar que as novas tags `Settings`, `Proxy` e `Messages (Batch)` aparecem

---

## Passo 5.6: Migração para ID-Based Routing no Data Plane

*Objetivo: Substituir `instanceName` por `instanceId` (UUID do Hub) como parâmetro de rota em todos os endpoints do data plane. Adicionar constraint de unicidade `@@unique([productId, instanceName])` no schema. Squash das migrations existentes.*

> Spec detalhada: `ignored-docs/passo56-id-routing-spec.md`  
> Documentação de decisões: `ignored-docs/decisoes-e-estado-final.html`

### 5.6.1 — Schema e Migrations

- [x] Adicionar `@@unique([productId, instanceName])` no model `Instance` em `prisma/schema.prisma`
- [x] Deletar as duas migrations existentes (`20260416170815_init_complete` e `20260422000000_add_admin_users_and_activity_log`)
- [x] Executar `npx prisma migrate reset --force` (dev — apaga dados locais)
- [x] Executar `npx prisma migrate dev --name init_v2_id_routing` para criar a migration consolidada
- [x] Executar `npx prisma generate`

### 5.6.2 — InstanceResolverService

- [x] Adicionar campo `instanceName: string` à interface `ResolvedInstance`
- [x] Adicionar método `resolveById(productId: string, instanceId: string): Promise<ResolvedInstance>` com cache key `instance:{instanceId}` e filtro `{ id: instanceId, productId, isActive: true }`
- [x] Atualizar método `resolve` existente para também usar cache key `instance:{id}` (unificar chave)
- [x] Atualizar toda invalidação de cache para `del instance:{instanceId}`

### 5.6.3 — InstanceController + InstanceService

- [x] Reestruturar rotas para padrão `/:instanceId/ação` (ver spec para ordem de declaração)
- [x] Renomear `GET /instance/fetchInstances` → `GET /instance/list`
- [x] `POST /instance/create` retorna `id` (UUID Hub) na resposta
- [x] `GET /instance/list` inclui `id` em cada item da resposta
- [x] Todos os métodos do service: `instanceName` → `instanceId` + chamar `resolveById`
- [x] Invalidação de cache usa `instance:{instanceId}`

### 5.6.4 — MessageController + MessageService

- [x] Substituir `:instance` por `:instanceId` em todos os 9 endpoints
- [x] `ctx()` privado passa a chamar `resolveById` e retorna `instanceName` para o adapter

### 5.6.5 — WebhookController + WebhookService

- [x] Substituir `:instance` por `:instanceId` nos 3 endpoints
- [x] Service chama `resolveById`, passa `instanceName` ao adapter

### 5.6.6 — ChatController + ChatService

- [x] Substituir `:instance` por `:instanceId` nos 4 endpoints
- [x] Service chama `resolveById`, passa `instanceName` ao adapter

### 5.6.7 — SettingsController + SettingsService

- [x] Substituir `:instance` por `:instanceId` nos 2 endpoints
- [x] Service chama `resolveById`

### 5.6.8 — ProxyController + ProxyService

- [x] Substituir `:instance` por `:instanceId` nos 2 endpoints
- [x] Service chama `resolveById`

### 5.6.9 — BatchProducer

- [x] Verificar/garantir que o producer chama `resolveById` e persiste `instanceName` no payload de cada job BullMQ (worker recebe nome pronto — zero resolução adicional por mensagem)

### 5.6.10 — Testes

- [x] Atualizar/criar testes para `resolveById` — cache HIT, cache MISS, NotFoundException quando `productId` não bate
- [x] Atualizar testes de instance, message e chat service para usar `instanceId` nos mocks
- [x] Build limpo: `EXIT:0`
- [x] Todos os testes passando (95/95)

### ✅ Validação do Desenvolvedor — Passo 5.6

- [x] Confirmar que `GET /api/v1/instance/create` retorna `id` no objeto de resposta
- [x] Confirmar que `GET /api/v1/instance/list` retorna `id` em cada instância
- [x] Testar `GET /api/v1/instance/:instanceId/connect` com o UUID retornado pelo create
- [x] Testar `POST /api/v1/message/sendText/:instanceId` com o UUID — mensagem deve ser enviada corretamente
- [x] Confirmar que passar UUID de instância de outro produto retorna 404 (isolamento por produto)
- [x] Confirmar que a migration `init_v2_id_routing` foi aplicada limpa no banco dev

---

## Passo 6: Filas Assíncronas & Envio em Lote (BullMQ)

*Objetivo: Implementar o sistema de enfileiramento para disparos em lote e relay de webhook, sem causar gargalos.*

### 6.1 — Setup BullMQ

- [x] Instalar e configurar BullMQ conectado ao Redis existente
- [x] Criar `BullMQ Module` integrado ao `app.module.ts`

### 6.2 — Batch (envio em lote)

- [x] Criar `BatchProducer` — publica N jobs no BullMQ com `{ batchJobId, adapterType, instanceName, providerUrl, providerApiKey, message, delayMs }` no payload de cada job
- [x] Criar `BatchWorker` — consome jobs, resolve adapter via registry, chama `adapter.sendText(ctx, ...)`, jobs falhos vão para DLQ
- [x] Implementar `POST /message/sendText/{instance}/batch`:
  - Inserir 1 linha em `BatchJob` no Postgres com `status: 'processing'` e `totalMessages: N`
  - Publicar N jobs no BullMQ
  - Retornar `{ batchJobId }` imediatamente ao cliente
- [x] Implementar handler de finalização via contadores Redis — executar **1 único UPDATE** no Postgres: `sentCount`, `failedCount`, `status: 'completed'`, `completedAt`
- [x] Implementar `GET /message/batch/{batchJobId}/status` — ler `BatchJob` do Postgres (não do Redis)

### 6.3 — Relay assíncrono de webhook (`hub_relay`)

- [x] Criar `InternalWebhookController` — `POST /internal/webhook/{adapterType}` com `IpWhitelistGuard`
  - Responde 200 imediatamente ao provider
  - Publica job no BullMQ (relay queue)
- [x] Criar `RelayWorker` — busca `WebhookConfig` do produto, assina HMAC-SHA256, entrega ao produto com retry automático por BullMQ

### 6.4 — Testes

- [x] Testes unitários: `BatchProducer` — verificar que `batchJobId` está presente no payload de cada job
- [x] Testes unitários: `BatchWorker` — sucesso incrementa sent, falha incrementa failed, finalização atualiza Postgres
- [x] Testes unitários: `RelayWorker` — verificar que a assinatura HMAC-SHA256 é gerada corretamente

### ✅ Validação do Desenvolvedor — Passo 6

- [x] Disparar um lote real em dev e acompanhar a execução no Portainer (logs)
- [x] Confirmar que o `BatchJob` no Postgres reflete corretamente o resultado ao final (incluindo cenário de falhas parciais)
- [x] Testar o endpoint de status `GET /message/batch/{batchJobId}/status` após o lote completar
- [x] Confirmar que o relay de webhook funciona com `hub_relay: true` usando uma instância de teste
- [x] Avaliar ajustes, melhorias ou correções

> **🔒 O Passo 7 só pode ser iniciado após este gate estar concluído e o desenvolvedor solicitar explicitamente.**

---

## Passo 6.5: Reorganização de Módulos — `src/modules/`

> **🔒 Este passo está bloqueado. O Passo 6 deve ser concluído e o gate de validação do desenvolvedor aprovado antes de iniciar qualquer tarefa aqui.**

*Objetivo: Mover todos os módulos NestJS de `src/` para `src/modules/`, mantendo `src/` apenas com os arquivos raiz da aplicação (`main.ts`, `app.module.ts`, `app.controller.ts`, `app.service.ts`) e os diretórios de utilitários transversais (`common/`). Esta é uma refatoração puramente estrutural — zero mudança de comportamento, zero alteração de schema ou contrato de API.*

---

### O que move para `src/modules/`

Todos os diretórios que contêm um arquivo `*.module.ts` são módulos NestJS e devem ser movidos:

| Diretório atual | Destino |
|---|---|
| `src/adapters/` | `src/modules/adapters/` |
| `src/admin/` | `src/modules/admin/` |
| `src/audit/` | `src/modules/audit/` |
| `src/auth/` | `src/modules/auth/` |
| `src/cache/` | `src/modules/cache/` |
| `src/chat/` | `src/modules/chat/` |
| `src/config/` | `src/modules/config/` |
| `src/instance/` | `src/modules/instance/` |
| `src/message/` | `src/modules/message/` |
| `src/prisma/` | `src/modules/prisma/` |
| `src/providers/` | `src/modules/providers/` |
| `src/proxy/` | `src/modules/proxy/` |
| `src/queue/` | `src/modules/queue/` |
| `src/resolver/` | `src/modules/resolver/` |
| `src/settings/` | `src/modules/settings/` |
| `src/webhook/` | `src/modules/webhook/` |

### O que NÃO move

| Diretório/arquivo | Motivo |
|---|---|
| `src/main.ts` | Bootstrap da aplicação — raiz |
| `src/app.module.ts` | Módulo raiz — importa todos os outros |
| `src/app.controller.ts` | Health check raiz |
| `src/app.service.ts` | Serviço raiz |
| `src/common/` | Utilitários transversais (decorators, filters, interceptors) — sem `*.module.ts` próprio |

---

### Impacto nos imports — regra geral

Todos os imports relativos que saem de dentro de um módulo em direção a outro módulo passam a ter um nível adicional de `../`:

```
// Antes (ex: src/audit/audit.service.ts importando PrismaService)
import { PrismaService } from '../prisma/prisma.service';

// Depois (ex: src/modules/audit/audit.service.ts)
import { PrismaService } from '../prisma/prisma.service';   // ← mesmo nível em src/modules/
```

Imports de `src/app.module.ts` para os módulos passam de `'./cache/cache.module'` para `'./modules/cache/cache.module'`.

Imports de dentro de `src/common/` para outros módulos **não mudam** — `common/` não foi movido.

---

### 6.5.1 — Mover os diretórios

- [x] Criar o diretório `src/modules/`
- [x] Mover apenas os módulos correspondentes a endpoints: `admin/`, `chat/`, `instance/`, `message/`, `proxy/`, `queue/`, `settings/`, `webhook/`
- [x] Confirmar que nenhum arquivo `.spec.ts` ficou para trás

### 6.5.2 — Atualizar imports em `src/app.module.ts`

- [x] Atualizar todos os `import ... from './NomeDoModulo/...'` para `import ... from './modules/NomeDoModulo/...'` (apenas para os 8 módulos de endpoint)
- [x] Manter imports de infraestrutura (`./adapters/`, `./audit/`, `./cache/`, etc.) sem prefixo `modules/`

### 6.5.3 — Atualizar imports internos entre módulos

- [x] Nos módulos em `src/modules/` (nível 2 de `src/`): `../infraestrutura/` → `../../infraestrutura/`
- [x] Nos arquivos de `src/modules/admin/submodulo/` (nível 3): `../../infraestrutura/` → `../../../infraestrutura/`
- [x] Verificar que importações cruzadas dentro de `src/modules/admin/` continuam com `../` correto

### 6.5.4 — Atualizar imports de `src/common/` para os módulos

- [x] Módulos em `src/modules/` (nível 2): `../common/` → `../../common/`
- [x] Arquivos em `src/modules/admin/submodulo/` (nível 3): `../../common/` → `../../../common/`
- [x] Arquivos de infraestrutura devolvidos a `src/` (`auth/`, `resolver/`): `../../common/` revertido para `../common/`

### 6.5.5 — Validar build e testes

- [x] Executar `npx tsc --noEmit` — zero erros de compilação ✅
- [x] Executar `npx jest --no-coverage` — 98/98 testes passando ✅
- [ ] Confirmar que o build de produção (`npm run build`) completa sem erros

### ✅ Validação do Desenvolvedor — Passo 6.5

- [x] Confirmar estrutura de diretórios: `src/modules/` existe e contém os 16 módulos
- [x] Confirmar que `src/` contém apenas: `main.ts`, `app.module.ts`, `app.controller.ts`, `app.service.ts`, `common/`
- [x] Confirmar que a aplicação sobe localmente sem erros (`npm run start:dev`)
- [x] Confirmar que todos os testes continuam passando após a reorganização
- [x] Confirmar que nenhum endpoint mudou (contrato de API 100% preservado)

---

## Passo 6.6: Separação Incremental de Workers de Batch

*Objetivo: Mover `BatchWorker` e `BatchWebhookWorker` para um processo dedicado sem HTTP, mantendo escalabilidade independente da API. Zero modificações nos arquivos já existentes.*

> **Abordagem de duas fases:**
> - **Fase 1:** Novos arquivos apenas. `AppModule` não é alterado. Workers de batch continuam rodando em ambos os processos.
> - **Fase 2:** Docker Compose atualizado com serviço worker. Mesma imagem, entrypoint diferente (`main-worker-batch.js`).
> - **Fase 3 (bloqueada):** Remover `BatchWorker`/`BatchWebhookWorker` do `AppModule` após validação em produção.

### Fase 1 — Novos arquivos (zero modificações em existentes)

- [x] Criar `src/common/redis.util.ts` — `parseRedisConnection(config)` centralizado
- [x] Criar `src/modules/batch-worker/batch-worker-queue.module.ts` — instancia `BatchWorker` e `BatchWebhookWorker` com factory providers próprios
- [x] Criar `src/modules/webhook/internal-webhook.module.ts` — extrai `InternalWebhookController` do `QueueModule` com `AuthModule`
- [x] Criar `src/core/core.module.ts` — re-exporta `AppConfigModule`, `PrismaModule`, `CacheModule`, `ProviderModule`, `AdaptersModule`
- [x] Criar `src/batch-worker.module.ts` — módulo raiz do worker: `imports: [CoreModule, BatchWorkerQueueModule]`
- [x] Criar `src/main-worker-batch.ts` — bootstrap sem HTTP: `NestFactory.createApplicationContext(BatchWorkerAppModule)`
- [x] Adicionar `RUNTIME_MODE`, `WORKER_CONCURRENCY`, `RELAY_CONCURRENCY` ao `config.schema.ts`
- [x] Adicionar log do `RUNTIME_MODE` no `main.ts` (`SoftConnect iniciando [runtime: api]`)

### Fase 2 — Container dedicado

- [x] Atualizar `docker-compose.yaml` com serviço `softconnect-worker` usando a mesma imagem
- [x] Entrypoint do worker: `node dist/main-worker-batch.js`
- [x] Variáveis: mesmas do `softconnect` exceto `RUNTIME_MODE=worker-batch`, sem Traefik labels
- [x] `docker-compose.dev.yaml` com override para modo de desenvolvimento do worker

### Fase 3 — Limpeza (Bloqueada — requer validação em produção)

> **🔒 Não iniciar Fase 3 sem validação de que o worker-batch está estabilizado em produção.**

- [ ] Remover `BatchWorker` e `BatchWebhookWorker` do `QueueModule` no `AppModule`
- [ ] Verificar que `InternalWebhookModule` substituiu completamente o controller no `QueueModule`
- [ ] Garantir que `RELAY_CONCURRENCY` está sendo usado pelo `RelayWorker` que permanece na API

### ✅ Validação do Desenvolvedor — Passo 6.6

- [ ] Confirmar que `npm run build` compila sem erros (dois entrypoints: `main.js` e `main-worker-batch.js`)
- [ ] Confirmar que a API sobe normalmente: `RUNTIME_MODE=api` no log de startup
- [ ] Confirmar que o worker sobe sem porta HTTP: `RUNTIME_MODE=worker-batch`, sem mensagem de `Listening on`
- [ ] Confirmar que `docker compose up` sobe ambos os serviços (api + worker)
- [ ] Confirmar que jobs de batch são processados corretamente pelo worker dedicado

---

## Passo 7: Webhooks Completos e Health Check

*Objetivo: Finalizar o sistema de webhook pass-through, circuit breaker e monitoramento proativo de VPS.*

### 7.1 — Health Check Service

- [x] Criar `HealthCheckService` com CRON a cada 60s
- [x] Para cada `VpsServer` ativo: chamar health check via adapter, registrar resultado em `HealthCheck` (status, responseMs, errorMsg)
- [x] Após 3 checks consecutivos `unhealthy`: marcar `VpsServer.isHealthy = false` + atualizar Redis `vps:health:{vpsId}`
- [x] Recovery: ao voltar healthy, atualizar campo e Redis
- [x] Expor `GET /admin/health` com status consolidado de todas as VPS

### 7.2 — Logs admin

- [x] Implementar `GET /admin/logs` — consulta paginada de `AuditLog` no Postgres com filtros por produto, período e status

### ✅ Validação do Desenvolvedor — Passo 7

- [ ] Simular VPS fora do ar e confirmar que o health check marca como `isHealthy: false` após 3 tentativas
- [ ] Confirmar que o circuit breaker e o CRON de health check atuam de forma complementar (breaker em segundos, CRON em minutos)
- [ ] Testar o endpoint `GET /admin/health` e verificar que reflete o estado real das VPS

> **🔒 O Passo 8 só pode ser iniciado após este gate estar concluído e o desenvolvedor solicitar explicitamente.**

---

## Passo 7.5: Batch Webhook Notification

*Objetivo: Notificar o produto via webhook HMAC-assinado a cada mensagem processada no lote, informando se aquela mensagem específica teve sucesso ou falha.*

**Contrato:** Um evento `batch.message.result` é disparado imediatamente após o processamento de **cada mensagem individual** — não ao final do lote. O receptor pode agregar os eventos usando `batchJobId` se quiser monitorar o lote completo.

### 7.5.1 — Schema e Migração

- [x] Adicionar `batchWebhookEnabled Boolean @default(false)` ao modelo `Product` em `prisma/schema.prisma`
- [x] Adicionar `batchWebhookUrl String?` ao modelo `Product` em `prisma/schema.prisma`
- [x] Criar migration `20260429000000_add_batch_webhook_to_product` com `ADD COLUMN IF NOT EXISTS` (sem apagar dados)

### 7.5.2 — Propagação no Auth e Admin

- [x] Estender `AuthCachePayload` com `batchWebhookEnabled: boolean`, `batchWebhookUrl: string | null` e `apiKeyHash: string`
- [x] Atualizar `ApiKeyGuard` — selecionar e cachear os novos campos; armazenar `hash` como `apiKeyHash` no payload
- [x] Adicionar campos aos DTOs `CreateProductDto` e `UpdateProductDto`
- [x] Adicionar validação em `ProductsService`: se `batchWebhookEnabled=true` e `batchWebhookUrl` ausente → `BadRequestException`

### 7.5.3 — Propagação no Produtor de Lotes

- [x] Estender `BatchJobPayload` com `batchWebhookEnabled`, `batchWebhookUrl`, `apiKeyHash` e `instanceId`
- [x] Atualizar assinatura de `BatchProducer.addJobs()` com os novos parâmetros
- [x] Propagar `product.apiKeyHash`, `resolved.instanceId`, `product.batchWebhookEnabled` e `product.batchWebhookUrl` em `MessageService.sendBatch()`, `sendBatchMedia()` e `sendBatchDocument()`

### 7.5.4 — Fila e Worker de Webhook

- [x] Adicionar constante `BATCH_WEBHOOK_QUEUE = 'BATCH_WEBHOOK_QUEUE'` em `queue.constants.ts`
- [x] Criar `BatchWebhookWorker` em `src/modules/queue/batch-webhook.worker.ts`:
  - Escuta a fila `batch-webhook`
  - Assina o body com HMAC-SHA256 usando `apiKeyHash` (chave por produto) → header `X-Hub-Signature: sha256=<hex>`
  - Envia header adicional `X-Hub-Event: batch.message.result`
  - Body: `{ event, batchJobId, productId, instanceId, success, processedAt, deliveryError, payload: messagePayload }`
  - Faz `axios.post` com timeout de 10s para `batchWebhookUrl`
  - Falhas relançam o erro (BullMQ realiza até 3 tentativas com backoff exponencial de 1s, `removeOnFail: false`)
- [x] Atualizar `BatchWorker` — enfileirar webhook **por mensagem** no bloco `finally` (após cada `sendText`):
  - `success: true` em caso de êxito, `success: false` + `deliveryError` em caso de falha
  - `finalizeBatchIfDone()` simplificado — não recebe mais parâmetros de webhook, apenas atualiza Postgres
- [x] Registrar `BATCH_WEBHOOK_QUEUE` e `BatchWebhookWorker` em `QueueModule`

**Payload entregue ao receptor:**
```json
{
  "event": "batch.message.result",
  "batchJobId": "uuid-do-lote",
  "productId": "uuid-do-produto",
  "instanceId": "uuid-da-instancia",
  "success": true,
  "processedAt": "2026-04-29T14:32:01.123Z",
  "deliveryError": null,
  "payload": { "number": "5511999990001", "text": "Olá, João!" }
}
```

### 7.5.5 — Testes

- [x] `batch-webhook.worker.spec.ts` — 5 casos: entrega POST com payload correto, assinatura HMAC com `apiKeyHash`, header `X-Hub-Event`, falha relança erro, handler de erro registrado
- [x] `batch.worker.spec.ts` — 7 casos: sent/failed incrementado, Postgres atualizado ao final, webhook enqueued com `success=true`, webhook enqueued com `success=false` + `deliveryError`, webhook não enqueued quando `enabled=false`
- [x] `batch.producer.spec.ts` — 7 casos: inclui `apiKeyHash` e `instanceId` no payload de cada job
- [x] `apikey.guard.spec.ts` — campos `batchWebhookEnabled`, `batchWebhookUrl` e `apiKeyHash` no payload cacheado
- [x] Total: **118/118 testes passando**

### ✅ Validação do Desenvolvedor — Passo 7.5

- [x] Criar produto com `batchWebhookEnabled: true` e `batchWebhookUrl` válida via `POST /api/v1/admin/products`
- [x] Confirmar que criar produto com `batchWebhookEnabled: true` sem `batchWebhookUrl` retorna `400 Bad Request`
- [x] Disparar um lote via `POST /api/v1/message/sendText/{instanceId}/batch` e confirmar que o webhook é chamado **uma vez por mensagem** (não uma vez ao final do lote)
- [x] Confirmar que cada chamada de webhook carrega `X-Hub-Signature`, `X-Hub-Event: batch.message.result` e o payload com `success`, `processedAt` e `payload` (mensagem original)
- [x] Verificar assinatura HMAC no receptor: `sha256=HMAC-SHA256(apiKeyHash, JSON.stringify(body))`

> **🔒 O Passo 8 só pode ser iniciado após este gate estar concluído e o desenvolvedor solicitar explicitamente.**

---

## Passo 8: Revisão e Refinamento da Documentação OpenAPI

> **🔒 Este passo está bloqueado. O Passo 7 deve ser concluído e o gate de validação do desenvolvedor aprovado antes de iniciar qualquer tarefa aqui.**

*Objetivo: Garantir que toda a API esteja completamente documentada com schemas de request/response, exemplos e descrições precisas.*

> **Nota:** A infraestrutura do Swagger (`@nestjs/swagger`, `SwaggerModule`, rotas `/docs` e `/docs/data`) foi implementada incrementalmente nos Passos 2–5. Este passo é de **revisão e enriquecimento**, não de instalação.

- [ ] Adicionar `@ApiProperty` em todos os DTOs do Data Plane com exemplos e descrições
- [ ] Revisar `@ApiResponse` em todos os controllers — garantir schemas de resposta documentados para 200, 400, 401, 404, 429
- [ ] Confirmar que `/docs` exibe apenas rotas Admin e `/docs/data` exibe apenas rotas Data Plane
- [ ] Verificar que o Swagger UI está acessível em ambiente de homologação (dev branch)

### ✅ Validação do Desenvolvedor — Passo 8

- [ ] Acessar `/docs/admin` e confirmar que apenas rotas `/admin/*` aparecem, sem nenhuma rota de Data Plane
- [ ] Acessar `/docs/data` e confirmar que apenas rotas de instância, mensagem, chat e webhook aparecem, sem rotas Admin
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
