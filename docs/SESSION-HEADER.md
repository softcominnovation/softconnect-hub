``markdown
#  SESSION-HEADER  SoftConnect 2.0

> Atualize os campos desta seção a cada nova sessão ou conclusão de fase antes de enviar.

---

## Contexto da Sessão ou fase

**Projeto:** SoftConnect 2.0
**Etapa atual:** Passo 7.5 — System Monitor Integration (implementado — 105/105 testes)
**Objetivo desta sessão:** Passo 7.5 implementado. Integração opcional com agente system-monitor nas VPS (`monitorUrl`, `monitorApiKey` opcionais no modelo `VpsServer`). `HealthCheckService.collectMetrics()` coleta métricas fire-and-forget após cada check e escreve no Redis `vps:metrics:{vpsId}` com TTL 90s. `GET /admin/health` agora inclui `systemMetrics` quando disponível. Novo endpoint `GET /admin/health/hub/metrics` para métricas do hub (controlado por `HUB_MONITOR_URL` e `HUB_MONITOR_API_KEY` opcionais). Schema migrado: `add_monitor_fields_to_vps`. Ausência de configuração é totalmente transparente. 105/105 testes passando.

---

## Documentos que Você Deve Ler Antes de Qualquer Ação

Leia os seguintes arquivos integralmente, nesta ordem, antes de responder:

1. `AGENTS.md`  regras de comportamento, o que pode e não pode fazer, como gerenciar fases
2. `docs/softconnect-spec-tecnica.md`  arquitetura, decisões, schema, endpoints
3. `docs/softconnect-plano-implementacao.md`  estado atual do projeto e fase em andamento
4. `README.md`  visão geral e guia de setup

> Não inicie nenhuma implementação antes de confirmar que leu todos os documentos acima.

---

## Instrução de Revisão

Esta etapa está concluída e aguardando gate de validação.

ETAPA ATUAL    : Passo 7  Health Check Service & Admin Logs
ETAPA ANTERIOR : Passo 6.5  Reorganização de Módulos src/modules/ (gate aprovado)
ETAPA ANTERIOR : Passo 4  Implementação do EvolutionAdapter (gate aprovado)
ETAPA ANTERIOR : Passo 3  Dynamic Adapters & Adapter Registry (gate aprovado)
ETAPA ANTERIOR : Passo 2  Admin Plane & Segurança (gate aprovado)
ETAPA ANTERIOR : Passo 1  Fundações da Infraestrutura (gate aprovado)
ETAPA ANTERIOR : Passo 0  Pipeline CI/CD (gate aprovado)

---

## Lembrete de Regras Críticas

> Os itens `[x]` são estados confirmados por você. O item `[ ]` é restrição ativa para o agente.

- [x] O Passo 0 tem o gate de validação marcado como `[x]` 
- [x] O Passo 1 está com gate de validação aprovado 
- [x] O Passo 2 está com gate de validação aprovado 
- [x] O Passo 3 está com gate de validação aprovado 
- [x] O Passo 4 está com gate de validação aprovado 
- [x] O Passo 5 está com gate de validação aprovado
- [ ] O Passo 6 está implementado  aguardando gate de validação do desenvolvedor
- [ ] Não avançar para o Passo 7 sem que o desenvolvedor marque o gate e solicite explicitamente o avanço

Se qualquer inconsistência for encontrada na revisão, reporte antes de sugerir qualquer ação.
``
