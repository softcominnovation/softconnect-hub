# SoftConnect 2.0 — Especificação Técnica

> **Softcom · NestJS + TypeScript + Prisma + PostgreSQL + Redis + BullMQ**
> Provider inicial: Evolution API 2.3.7 | Arquitetura: provider-agnostic via Adapter Pattern

---

## 1. Visão Geral

O **SoftConnect 2.0** é um API Gateway que abstrai o acesso a instâncias de providers de mensageria (Evolution API, Meta Cloud, Z-API, WPPConnect, etc.) distribuídas em múltiplas VPS. Os produtos clientes (Softshop, Atendentebot, etc.) fazem requests ao Hub usando a mesma assinatura de endpoints — o Hub resolve internamente qual VPS usar, qual adapter acionar, injeta as credenciais corretas e repassa a request de forma transparente.

Cada produto define qual adapter usar (`adapterType`). O Hub seleciona o adapter correto em tempo de execução com base no produto autenticado. Isso permite que, por exemplo, o Atendentebot use Evolution API enquanto o Softshop usa Meta Cloud API — tudo no mesmo Hub, sem deploy separado.

### Princípios inegociáveis

- O banco de dados **nunca** é tocado no hot path de mensagens — apenas Redis
- O audit log é **sempre** assíncrono — nunca bloqueia a response ao cliente
- Os nomes dos endpoints são **idênticos** à Evolution API 2.3.7 (contratos canônicos)
- Toda comunicação com o provider passa pela interface `WhatsAppProvider` — nunca diretamente
- O Hub é **stateless por design** — todo estado vive em Redis e Postgres
- O adapter é **resolvido por produto** — cada produto pode usar um provider diferente

### O que NÃO faz parte do escopo do Hub

- RabbitMQ das VPS (usado internamente pela Evolution para eventos de saída — Hub não enxerga)
- Recovery-api Python (integração desacoplada, fora do escopo)
- Qualquer serviço de mensageria externo além do BullMQ no Redis do Hub

---

## 2. Stack Técnica

| Camada | Tecnologia | Observação |
|--------|-----------|------------|
| Framework | NestJS + TypeScript | DI nativa, modules, interceptors |
| Engine HTTP | **Fastify** (FastifyAdapter) | ~2× mais req/s que Express, menor RAM |
| ORM | Prisma | Migrations automáticas, client type-safe |
| Banco | PostgreSQL | Persistência principal |
| Cache | Redis (ioredis) | Auth lookup, instance resolver, rate limit, adapter type |
| Fila | BullMQ | Roda sobre o Redis já existente — sem broker adicional |
| HTTP Client | Axios com keep-alive | Pool de conexões persistentes por VPS |
| Docs | Swagger / OpenAPI | Auto-gerado pelos decorators |
| Container | Docker multi-stage + Swarm | Compatível com infra existente Softcom |
| CI/CD | GitHub Actions + GHCR + Portainer | Deploy automático via webhook Portainer |

---

## 3. Estrutura de Pastas

```
src/
├── main.ts
├── app.module.ts
│
├── config/
│   ├── config.module.ts
│   └── config.schema.ts          # validação zod no startup — app não sobe sem vars corretas
│
├── providers/
│   ├── whatsapp-provider.interface.ts   # CONTRATO — todos os adapters implementam isso
│   ├── adapter-registry.service.ts      # registry de adapters por type (Map em memória)
│   ├── adapter-resolver.service.ts      # resolve adapter com base no adapterType do produto
│   └── provider.module.ts
│
├── adapters/
│   ├── evolution/
│   │   ├── evolution.adapter.ts         # implementa WhatsAppProvider
│   │   ├── evolution.http.ts            # cliente axios com keep-alive e circuit breaker
│   │   └── evolution.module.ts
│   ├── meta-cloud/                      # FUTURO — implementa WhatsAppProvider
│   │   ├── meta-cloud.adapter.ts
│   │   ├── meta-cloud.http.ts
│   │   └── meta-cloud.module.ts
│   └── adapters.module.ts              # registra todos os adapters no registry no startup
│
├── auth/
│   ├── apikey.guard.ts                  # Data Plane — valida apikey via Redis
│   ├── jwt.guard.ts                     # Admin Plane — valida JWT
│   ├── ip-whitelist.guard.ts            # /internal/webhook — valida IP da VPS
│   └── auth.module.ts
│
├── cache/
│   ├── cache.service.ts                 # abstração ioredis com TTL helpers
│   └── cache.module.ts
│
├── resolver/
│   ├── instance.resolver.ts             # productId + instanceName → {providerUrl, apiKey, adapterType}
│   └── resolver.module.ts
│
├── admin/
│   ├── products/
│   │   ├── products.controller.ts
│   │   ├── products.service.ts
│   │   └── products.module.ts
│   └── vps/
│       ├── vps.controller.ts
│       ├── vps.service.ts
│       └── vps.module.ts
│
├── instance/
│   ├── instance.controller.ts
│   ├── instance.service.ts             # orquestra: adapter resolver + banco + cache invalidation
│   └── instance.module.ts
│
├── message/
│   ├── message.controller.ts
│   ├── message.service.ts
│   ├── batch/
│   │   ├── batch.producer.ts           # publica jobs no BullMQ com batchJobId no payload
│   │   ├── batch.worker.ts             # consome jobs, chama adapter dinâmico, UPDATE final no Postgres
│   │   └── batch.module.ts
│   └── message.module.ts
│
├── chat/
│   ├── chat.controller.ts
│   ├── chat.service.ts
│   └── chat.module.ts
│
├── webhook/
│   ├── webhook.controller.ts           # set e find — repassa para provider via adapter
│   ├── internal-webhook.controller.ts  # recebe eventos do provider (IP whitelist)
│   ├── relay/
│   │   ├── relay.producer.ts           # publica job de repasse no BullMQ (hub_relay)
│   │   ├── relay.worker.ts             # assina HMAC-SHA256 e entrega ao produto
│   │   └── relay.module.ts
│   ├── webhook.service.ts
│   └── webhook.module.ts
│
├── health/
│   ├── health.service.ts               # CRON 60s + atualiza Redis e Postgres
│   └── health.module.ts
│
├── audit/
│   ├── audit.interceptor.ts            # captura request/response — dispara sem await
│   ├── audit.service.ts                # buffer write-behind — flush 1s ou 100 registros
│   └── audit.module.ts
│
└── common/
    ├── interceptors/
    │   └── timeout.interceptor.ts
    ├── filters/
    │   └── http-exception.filter.ts
    └── decorators/
        ├── product.decorator.ts              # extrai productId do request após auth
        └── resolved-instance.decorator.ts   # extrai dados resolvidos (inclui adapterType)
```

---

## 4. Schema do Banco (Prisma) — Estado Definitivo

> **Todas as 7 tabelas estão criadas, migrations aplicadas e Prisma Client gerado.**
> A migration consolidada `20260416170815_init_complete` está ativa.

```prisma
model Product {
  id          String   @id @default(uuid())
  name        String
  slug        String   @unique
  apiKeyHash  String   @unique        // SHA-256 one-way — nunca armazenar a key crua
  adapterType String   @default("evolution")
  origins     String[]               // ["n8n", "frontend", "backend"]
  hubRelay    Boolean  @default(false)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  vpsId          String?
  vps            VpsServer?      @relation(fields: [vpsId], references: [id])
  instances      Instance[]
  webhookConfigs WebhookConfig[]
  auditLogs      AuditLog[]
  batchJobs      BatchJob[]
}

model VpsServer {
  id             String    @id @default(uuid())
  label          String                   // "VPS-BR-01"
  subdomain      String    @unique        // "evo1.softcomia.com"
  ip             String                   // IP para whitelist do webhook interno
  providerUrl    String                   // URL base do provider nesta VPS
  providerApiKey String                   // AES-256-GCM encrypted
  adapterType    String    @default("evolution")
  managerType    String?                  // "portainer" | "coolify"
  managerUrl     String?
  managerApiKey  String?                  // AES-256-GCM encrypted
  isHealthy      Boolean   @default(true)
  lastHealthAt   DateTime?
  isActive       Boolean   @default(true)
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  products     Product[]
  instances    Instance[]
  healthChecks HealthCheck[]
}

model Instance {
  id            String   @id @default(uuid())
  productId     String
  vpsId         String
  instanceName  String
  instanceToken String?
  hubToken      String   @unique
  phoneNumber   String?
  status        String   @default("disconnected")  // "disconnected"|"connecting"|"open"
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  product   Product    @relation(fields: [productId], references: [id])
  vps       VpsServer  @relation(fields: [vpsId], references: [id])
  auditLogs AuditLog[]
  batchJobs BatchJob[]

  @@unique([vpsId, instanceName])
}

model WebhookConfig {
  id        String   @id @default(uuid())
  productId String
  url       String
  secret    String               // para HMAC-SHA256 na assinatura do relay
  events    String[]             // ["messages.upsert", "connection.update", ...]
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())

  product Product @relation(fields: [productId], references: [id])
}

model AuditLog {
  id         String   @id @default(uuid())
  productId  String
  instanceId String?
  endpoint   String
  method     String
  statusCode Int
  latencyMs  Int
  origin     String?
  ip         String
  errorMsg   String?
  createdAt  DateTime @default(now())

  product  Product   @relation(fields: [productId], references: [id])
  instance Instance? @relation(fields: [instanceId], references: [id])
}

model HealthCheck {
  id         String   @id @default(uuid())
  vpsId      String
  status     String               // "healthy" | "unhealthy" | "timeout"
  responseMs Int
  errorMsg   String?
  checkedAt  DateTime @default(now())

  vps VpsServer @relation(fields: [vpsId], references: [id])
}

model BatchJob {
  id            String    @id @default(uuid())
  productId     String
  instanceId    String?              // instância que disparou o lote
  totalMessages Int                  // definido ao criar o lote
  sentCount     Int       @default(0)   // preenchido pelo worker ao final do lote
  failedCount   Int       @default(0)   // preenchido pelo worker ao final do lote
  status        String    @default("processing")  // "processing"|"completed"|"failed"
  completedAt   DateTime?            // preenchido quando o lote encerra
  createdAt     DateTime  @default(now())

  product  Product   @relation(fields: [productId], references: [id])
  instance Instance? @relation(fields: [instanceId], references: [id])
}
```

### Decisão arquitetural — BatchJob (Event-Driven Aggregation)

O `BatchJob` é persistido no Postgres usando o padrão **Event-Driven Aggregation**:

1. Ao criar o lote → inserir 1 linha com `status: 'processing'` e retornar `{ batchJobId }` ao cliente
2. BullMQ dispara as N mensagens no Redis — contagem em memória, zero queries no Postgres
3. Workers consomem os jobs via adapter dinâmico; falhas vão para DLQ
4. Evento BullMQ `'drained'` dispara **1 único UPDATE** final no Postgres: `sentCount`, `failedCount`, `status: 'completed'`, `completedAt`

**Resultado:** histórico eterno para billing e auditoria, sem gargalo de I/O durante o disparo.

O status de um lote é **sempre consultado do Postgres** (`GET /message/batch/{batchJobId}/status`), nunca do Redis — pois o Redis limpa jobs antigos após ~24h.

---

## 5. Resolução Dinâmica de Adapter

### 5.1 AdapterRegistry

Singleton que mantém `Map<string, WhatsAppProvider>`. Resolução O(1) em memória.

```typescript
// src/providers/adapter-registry.service.ts
@Injectable()
export class AdapterRegistryService {
  private adapters = new Map<string, WhatsAppProvider>();

  register(type: string, adapter: WhatsAppProvider): void {
    this.adapters.set(type, adapter);
  }

  get(type: string): WhatsAppProvider {
    const adapter = this.adapters.get(type);
    if (!adapter) throw new BadRequestException(`Adapter "${type}" não registrado`);
    return adapter;
  }

  getAvailableTypes(): string[] {
    return Array.from(this.adapters.keys());
  }
}
```

### 5.2 Registro no startup

```typescript
// src/adapters/adapters.module.ts
@Module({ imports: [EvolutionModule] })
export class AdaptersModule implements OnModuleInit {
  constructor(
    private readonly registry: AdapterRegistryService,
    private readonly evolutionAdapter: EvolutionAdapter,
  ) {}

  onModuleInit() {
    this.registry.register('evolution', this.evolutionAdapter);
    // this.registry.register('meta-cloud', this.metaCloudAdapter);
  }
}
```

### 5.3 Chaves Redis — o adapterType viaja de graça

O `adapterType` trafega junto com dados **já cacheados no Redis**. Custo adicional no hot path: **zero**.

```
auth:{apiKeyHash}
  → { productId, isActive, origins[], hubRelay, adapterType, vpsId }
  → TTL: 60s

instance:{productId}:{instanceName}
  → { providerUrl, providerApiKey, vpsId, instanceId, adapterType }
  → TTL: 300s (5min)
```

---

## 6. Interface do Provider (contrato obrigatório)

```typescript
// src/providers/whatsapp-provider.interface.ts

export interface WhatsAppProvider {
  // Instâncias
  createInstance(ctx: ProviderContext, dto: CreateInstanceDto): Promise<InstanceCreatedDto>
  fetchInstances(ctx: ProviderContext): Promise<InstanceDto[]>
  connectInstance(ctx: ProviderContext, instanceName: string): Promise<ConnectInstanceDto>
  getConnectionState(ctx: ProviderContext, instanceName: string): Promise<ConnectionStateDto>
  restartInstance(ctx: ProviderContext, instanceName: string): Promise<void>
  logoutInstance(ctx: ProviderContext, instanceName: string): Promise<void>
  deleteInstance(ctx: ProviderContext, instanceName: string): Promise<void>

  // Mensagens
  sendText(ctx: ProviderContext, instanceName: string, dto: SendTextDto): Promise<MessageResponseDto>
  sendMedia(ctx: ProviderContext, instanceName: string, dto: SendMediaDto): Promise<MessageResponseDto>
  sendWhatsAppAudio(ctx: ProviderContext, instanceName: string, dto: SendAudioDto): Promise<MessageResponseDto>
  sendButtons(ctx: ProviderContext, instanceName: string, dto: SendButtonsDto): Promise<MessageResponseDto>
  sendList(ctx: ProviderContext, instanceName: string, dto: SendListDto): Promise<MessageResponseDto>
  sendLocation(ctx: ProviderContext, instanceName: string, dto: SendLocationDto): Promise<MessageResponseDto>
  sendContact(ctx: ProviderContext, instanceName: string, dto: SendContactDto): Promise<MessageResponseDto>
  sendReaction(ctx: ProviderContext, instanceName: string, dto: SendReactionDto): Promise<MessageResponseDto>

  // Chat
  findChats(ctx: ProviderContext, instanceName: string, dto: FindChatsDto): Promise<ChatDto[]>
  findMessages(ctx: ProviderContext, instanceName: string, dto: FindMessagesDto): Promise<MessageDto[]>
  findContacts(ctx: ProviderContext, instanceName: string, dto: FindContactsDto): Promise<ContactDto[]>
  checkNumber(ctx: ProviderContext, instanceName: string, dto: CheckNumberDto): Promise<CheckNumberResponseDto>

  // Webhook
  setWebhook(ctx: ProviderContext, instanceName: string, dto: SetWebhookDto): Promise<void>
  findWebhook(ctx: ProviderContext, instanceName: string): Promise<WebhookDto>
}

// Contexto stateless — URL e credenciais da VPS destino, fornecidos por chamada
interface ProviderContext {
  providerUrl: string;
  providerApiKey: string;
}
```

> **Regra:** adapter é stateless. A mesma instância de `EvolutionAdapter` serve múltiplas VPS — a VPS é fornecida via `ProviderContext` a cada chamada. Nunca armazenar URL/key no adapter.

---

## 7. Endpoints — Mapeamento Completo

### Data Plane — `apikey: {product-api-key}` no header

```
# Instâncias
POST   /instance/create
GET    /instance/fetchInstances
GET    /instance/connect/{instance}
GET    /instance/connectionState/{instance}
PUT    /instance/restart/{instance}
DELETE /instance/logout/{instance}
DELETE /instance/delete/{instance}

# Mensagens
POST   /message/sendText/{instance}
POST   /message/sendMedia/{instance}
POST   /message/sendWhatsAppAudio/{instance}
POST   /message/sendButtons/{instance}
POST   /message/sendList/{instance}
POST   /message/sendLocation/{instance}
POST   /message/sendContact/{instance}
POST   /message/sendReaction/{instance}
POST   /message/sendText/{instance}/batch    ← extensão Hub — BullMQ + BatchJob
GET    /message/batch/{batchJobId}/status    ← lê BatchJob do Postgres (histórico eterno)

# Chat
POST   /chat/whatsappNumbers/{instance}
POST   /chat/findChats/{instance}
POST   /chat/findMessages/{instance}
POST   /chat/findContacts/{instance}

# Webhook
POST   /webhook/set/{instance}
GET    /webhook/find/{instance}

# Interno (IP whitelist das VPS — sem apikey, sem JWT)
POST   /internal/webhook/{adapterType}
```

### Admin Plane — `Authorization: Bearer {jwt}` no header

```
POST   /admin/products
GET    /admin/products
PUT    /admin/products/:id
DELETE /admin/products/:id

POST   /admin/vps
GET    /admin/vps
PUT    /admin/vps/:id
DELETE /admin/vps/:id

GET    /admin/health
GET    /admin/logs
GET    /admin/adapters    ← lista adapters registrados em runtime
```

### Auth do Admin Plane

```
POST   /admin/auth/login  → retorna JWT (24h)
```

---

## 8. Fluxos Críticos

### 8.1 Hot path — enviar mensagem

```
Request
  → ApiKeyGuard           # Redis auth:{apiKeyHash} — HIT: <1ms, MISS: Postgres + cache
  → InstanceResolver      # Redis instance:{productId}:{instanceName} — retorna providerUrl + adapterType
  → AdapterResolver       # registry.get(adapterType) — O(1) em memória
  → ProxyService          # adapter.sendText(ctx, ...) via Axios keep-alive
  → Response ao cliente

(sem await — fora do response path)
  → AuditInterceptor → AuditService buffer → flush Postgres (1s ou 100 registros)
```

**Overhead total do Hub no hot path: 2ms a 5ms.**

### 8.2 Criar instância

```
1. Validar apikey → obter productId, adapterType, vpsId
2. Buscar VPS pelo vpsId do produto (Postgres, não hot path)
3. Validar vps.adapterType === product.adapterType (prevenir misconfiguration)
4. Resolver adapter → adapter.createInstance(ctx, dto)
5. Salvar Instance no Postgres
6. Invalidar cache: redis.del(`instance:${productId}:${instanceName}`)
7. Retornar response do provider ao cliente
```

### 8.3 Envio em lote

```
1. Receber array de mensagens + delay_ms (default: 3000ms)
2. Inserir BatchJob no Postgres: { status: 'processing', totalMessages, productId, instanceId }
3. Publicar N jobs no BullMQ com { batchJobId, adapterType, ... } no payload de cada job
4. Retornar { batchJobId } imediatamente ao cliente
5. [worker] Consumir job → resolver adapter → enviar via provider
6. [worker] Falhas com tentativas esgotadas → DLQ, incrementar failedCount (Redis)
7. [worker] Evento 'drained' → 1 UPDATE no Postgres: sentCount, failedCount, status: 'completed', completedAt
```

### 8.4 Webhook — configuração e entrega

```
hubRelay: false (padrão):
  POST /webhook/set/{instance}
    → Hub configura no provider a URL real do produto
    → Provider entrega eventos diretamente ao produto (sem Hub no caminho)

hubRelay: true (opcional por produto):
  POST /webhook/set/{instance}
    → Hub configura no provider a URL /internal/webhook/{adapterType}
    → Provider → POST /internal/webhook/{adapterType} (IP whitelist)
      → Hub responde 200 imediatamente
      → Publica job no BullMQ (relay worker)
      → Worker assina HMAC-SHA256 → entrega ao produto com retry automático
```

### 8.5 Health Check

```
[CRON 60s]
Para cada VpsServer ativo:
  → adapter.healthCheck(ctx) via registry
  → Salvar HealthCheck (status, responseMs)
  → 3 checks unhealthy consecutivos: VpsServer.isHealthy = false + atualizar Redis
  → Recovery: VpsServer.isHealthy = true + atualizar Redis

[Circuit Breaker — em tempo real, por VPS]
  → 5 falhas consecutivas → breaker abre → 503 imediato
  → Após 30s → half-open → 1 request de teste → fecha se OK
  → Complementa o CRON (CRON age em minutos, breaker age em segundos)
```

---

## 9. Cache Redis — Chaves e TTLs

```
auth:{apiKeyHash}
  → { productId, isActive, origins[], hubRelay, adapterType, vpsId }
  → TTL: 60s
  → Invalidar: ao desativar produto, rotacionar apikey ou alterar adapterType

instance:{productId}:{instanceName}
  → { providerUrl, providerApiKey, vpsId, instanceId, adapterType }
  → TTL: 300s (5min)
  → Invalidar: ao criar, deletar ou mover instância

vps:health:{vpsId}
  → { isHealthy, lastCheckedAt }
  → TTL: 70s (ciclo de CRON + margem de segurança)
  → Atualizado pelo HealthCheckService a cada 60s

rate:{productId}
  → contador de requests
  → TTL: 1s (janela deslizante)
```

> **Atenção:** ao popular o cache `auth:{apiKeyHash}`, incluir **obrigatoriamente** o campo `vpsId`. Ele é necessário para o InstanceResolver resolver a URL do provider sem query adicional ao banco.

---

## 10. Segurança

### Criptografia de credenciais das VPS — AES-256-GCM

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

function encrypt(text: string, key: Buffer): string {
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

function decrypt(encryptedStr: string, key: Buffer): string {
  const [ivHex, authTagHex, encryptedHex] = encryptedStr.split(':')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final()
  ]).toString('utf8')
}
```

### Hash de API Keys — SHA-256 one-way

```typescript
import { createHash } from 'crypto'
// Armazenar apenas o hash. Nunca a key crua.
const hash = createHash('sha256').update(apiKey).digest('hex')
```

### HMAC para webhook relay

```typescript
import { createHmac } from 'crypto'
const signature = createHmac('sha256', webhookConfig.secret)
  .update(JSON.stringify(payload))
  .digest('hex')
// Header enviado ao produto: X-Hub-Signature: sha256={signature}
```

### Planos de autenticação

| Plano | Rotas | Mecanismo | Performance |
|-------|-------|-----------|------------|
| **Data Plane** | `/instance/*`, `/message/*`, `/chat/*`, `/webhook/*` | `apikey` header → Redis | < 1ms |
| **Admin Plane** | `/admin/*` | JWT 24h (+ TOTP opcional) | Não crítico |
| **Internal** | `/internal/webhook/*` | IP whitelist das VPS | < 0.5ms |

---

## 11. Variáveis de Ambiente

```env
# Banco
DATABASE_URL=postgresql://user:pass@postgres:5432/softconnect

# Redis
REDIS_URL=redis://redis:6379/0

# Segurança
ENCRYPTION_KEY=        # 32 bytes hex — AES-256-GCM para credenciais das VPS
JWT_SECRET=            # secret para JWT do Admin Plane
ADMIN_JWT_EXPIRY=86400 # 24h em segundos

# Performance
DEFAULT_RATE_LIMIT=100       # req/s por produto (janela 1s)
PROXY_TIMEOUT_MS=15000       # timeout para chamadas ao provider
PROXY_MAX_RETRIES=1          # retries antes de retornar 502
CIRCUIT_BREAKER_THRESHOLD=5  # falhas consecutivas para abrir o breaker
CIRCUIT_BREAKER_RESET_MS=30000 # tempo até tentar fechar o breaker (half-open)

# Audit
AUDIT_FLUSH_INTERVAL_MS=1000  # flush do buffer a cada 1s
AUDIT_FLUSH_BATCH_SIZE=100    # ou a cada 100 registros (o que ocorrer primeiro)

# Adapter
DEFAULT_ADAPTER_TYPE=evolution  # fallback se produto não tiver adapterType definido
```

> A aplicação **não deve subir** se qualquer variável obrigatória estiver ausente. O `ConfigModule` com `zod` valida no bootstrap e loga exatamente qual variável está faltando.

---

## 12. Tratamento de Erros

```typescript
// Mapeamento de erros do provider para erros do Hub
{
  "statusCode": 502,
  "error": "Bad Gateway",
  "message": "Provider unavailable",
  "details": "Timeout after 15000ms",
  "adapterType": "evolution"   // facilita diagnóstico em ambiente multi-provider
}

// Tabela de códigos HTTP do Hub:
// 400 → adapterType inválido ou não registrado
// 401 → apikey inválida ou inativa
// 403 → IP não autorizado (webhook interno) ou origin não permitida
// 429 → rate limit excedido (por produto)
// 502 → Provider não respondeu dentro do timeout
// 503 → VPS marcada como unhealthy ou circuit breaker aberto
```

---

## 13. BullMQ — Casos de Uso

O BullMQ roda dentro do processo NestJS usando o Redis já existente. Não é um broker separado.

### Caso 1 — Envio em lote com rate control

Recebe N mensagens, dispara com delay entre elas para evitar ban no WhatsApp. Garante delay nativo por job, retry com backoff exponencial e DLQ para falhas permanentes.

### Caso 2 — Relay assíncrono de webhook (`hub_relay: true`)

Hub recebe evento do provider → responde 200 imediatamente → worker repassa ao produto com HMAC. Se o produto estiver indisponível, o job aguarda na fila com retry — sem perda de eventos.

### Por que BullMQ e não RabbitMQ

| Critério | BullMQ | RabbitMQ |
|----------|--------|----------|
| Infraestrutura adicional | Nenhuma — usa Redis existente | Novo container, nova porta, novo painel |
| Operação | Zero — `npm install` | Deploy, monitoramento, backup, updates |
| Casos de uso do Hub | Atendidos completamente | Atendidos com complexidade desnecessária |

---

## 14. Infraestrutura Recomendada

**VPS: 4 vCPU · 16GB RAM · 200GB NVMe**

| Serviço | CPU limit | RAM limit | CPU reserv. | RAM reserv. |
|---------|-----------|-----------|-------------|-------------|
| Traefik | 0.25 | 128M | 0.10 | 64M |
| Portainer | 0.25 | 256M | 0.05 | 128M |
| PostgreSQL | 1.0 | 2G | 0.25 | 512M |
| Redis | 0.50 | 512M | 0.10 | 128M |
| SoftConnect (app) | 2.0 | 1G | 0.50 | 256M |

Consumo estimado em operação normal: **4GB a 6GB RAM**. Margem de ~10GB para crescimento e picos.

### Configurações de performance recomendadas

**PostgreSQL** (`postgresql.conf`):
```
shared_buffers = 2GB           # 25% da RAM da VPS (16GB)
effective_cache_size = 8GB
work_mem = 32MB
maintenance_work_mem = 512MB
```

**Redis** (`redis.conf`):
```
maxmemory 512mb
maxmemory-policy allkeys-lru
appendonly yes                  # persistência dos jobs BullMQ em restarts
```

---

## 15. Pipeline de CI/CD e Versionamento

### 15.1 Estrutura de branches

| Branch | Ambiente | URL |
|--------|---------|-----|
| `develop` | Homologação | `dev-api.hub.softconnect.net.br` |
| `main` | Produção | `api.hub.softconnect.net.br` |

### 15.2 Fluxo de desenvolvimento

```
feature/xyz
  → PR + review → merge em develop
      → GitHub Actions (deploy-dev.yml)
          → Build imagem Docker
          → Push para GHCR com tags: dev + dev-{commit_sha}
          → Webhook → Portainer (stack softconnect-dev) → auto-deploy
      → Validação em dev-api

Pronto para produção:
  → PR develop → main → aprovação
      → GitHub Actions (deploy-prod.yml)
          → Build imagem Docker
          → Push para GHCR com tags: latest + prod-{commit_sha}
          → Webhook → Portainer (stack softconnect-prod) → deploy controlado
      → Validação em api (prod)
      → git tag v{major}.{minor}.{patch} (Semantic Versioning)
```

### 15.3 Semantic Versioning e Git Tags

Toda release de produção recebe uma tag Git imutável vinculada ao commit exato:

- `v1.0.0` — release estável de produção
- `v1.1.0-beta` — pré-release em homologação
- `v1.0.1` — hotfix de produção

**Regras SemVer:**
- **MAJOR** (`v1.x.x → v2.x.x`): mudança incompatível de API/contrato
- **MINOR** (`v1.1.x → v1.2.x`): nova funcionalidade, sem breaking changes
- **PATCH** (`v1.1.0 → v1.1.1`): correção de bug, sem funcionalidade nova

```bash
# Criar release estável após validação em produção
git tag -a v1.0.0 -m "Release v1.0.0 — Admin Plane + Data Plane operacional"
git push origin v1.0.0
```

### 15.4 Secrets necessários no GitHub

| Secret | Uso |
|--------|-----|
| `PORTAINER_WEBHOOK_PROD` | Webhook do stack softconnect-prod no Portainer |
| `PORTAINER_WEBHOOK_DEV` | Webhook do stack softconnect-dev no Portainer |

### 15.5 Rollback de emergência

Em caso de problema em produção:

```bash
# No Portainer — trocar a tag da imagem da stack prod para a versão anterior
# Ex: ghcr.io/softcominnovation/softconnect-hub:v1.0.0
# Re-deploy da stack — em < 2 minutos a versão anterior está no ar
```

---

## 16. Decisões Arquiteturais — Não Reabrir sem Evidência

| Decisão | Alternativa descartada | Motivo |
|---------|----------------------|--------|
| `adapterType` no Product (banco) | Apenas na request body | Produto define uma vez, Hub resolve automaticamente. Sem campo extra em cada request. |
| `adapterType` no cache Redis do auth | Consulta ao banco para resolver adapter | Zero custo adicional no hot path — campo trafega com dados já cacheados. |
| Engine Fastify | Express (padrão NestJS) | ~2× mais req/s com menor RAM. Essencial para gateway de alto throughput. |
| AdapterRegistry como `Map` em memória | DI dinâmico do NestJS | `Map.get()` é O(1). DI dinâmico adicionaria complexidade sem ganho mensurável. |
| ProviderContext por chamada (stateless) | Adapter com estado (URL/key fixos) | Mesma instância serve múltiplas VPS do mesmo provider. Zero multiplicação de objetos em memória. |
| `providerUrl` / `providerApiKey` (genérico) | `evolutionUrl` / `evolutionApiKey` | Nomenclatura reflete natureza multi-provider. Sem refatorar ao adicionar novo adapter. |
| BullMQ no Redis do Hub | RabbitMQ das VPS | RabbitMQ das VPS é para eventos de saída (Evolution), não fila de entrada. BullMQ resolve com Redis existente. |
| BatchJob no Postgres (Event-Driven Aggregation) | Apenas Redis/BullMQ | Redis é volátil — BullMQ limpa jobs após 24h. Postgres garante histórico eterno para billing. 1 UPDATE ao final = zero gargalo. |
| Hub relay (`hub_relay`) como flag opcional | Relay obrigatório para todos | Maioria dos produtos não precisa. Hub no caminho de todos os eventos adiciona latência desnecessária. |
| FK `vpsId` em `Product` | `productId` em `VpsServer` | 10 produtos podem usar a mesma VPS. Sem inversão, 10 produtos = 10 VPS obrigatórias. |
| `WebhookConfig` em tabela separada | Campo em `Product` | Suporta múltiplos webhooks por produto sem migration futura. Custo atual: zero. |
| `HealthCheck` com histórico | Apenas campo em `VpsServer` | Dashboard de monitoramento exige histórico e latência (responseMs). |
| AES-256-GCM explícito | AES-256 genérico (CBC/ECB) | GCM é AEAD — cifra + autenticação integrada. Detecta adulteração do ciphertext. |
| Audit log assíncrono | Síncrono por request | 5–20ms de I/O de log por request é inaceitável em gateway de alta frequência. |
| TOTP apenas no Admin Plane | 2FA no Data Plane | 500 req/s com TOTP = gargalo imediato. Data Plane protegido por apikey via Redis. |
| Nomes de endpoint idênticos à Evolution API | Nomenclatura própria | Trocar de provider deve ser transparente para o cliente — apenas muda a base URL. |
| VPS 4 vCPU / 16GB RAM | 2 vCPU / 8GB (apertado) ou 8 vCPU / 32GB (prematuro) | Folga real para crescimento. Escala horizontal com Swarm quando necessário. |

---

*SoftConnect 2.0 · Softcom · Especificação Técnica*
