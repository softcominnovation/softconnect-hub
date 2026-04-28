``markdown
#  SESSION-HEADER  SoftConnect 2.0

> Atualize os campos desta seção a cada nova sessão ou conclusão de fase antes de enviar.

---

## Contexto da Sessão ou fase

**Projeto:** SoftConnect 2.0
**Etapa atual:** Passo 6.5 — Reorganização de Módulos `src/modules/` (implementado — build limpo, 98/98 testes — aguardando gate de validação do desenvolvedor)
**Objetivo desta sessão:** Passo 6.5 implementado. Módulos de endpoint (admin, chat, instance, message, proxy, queue, settings, webhook) movidos para `src/modules/`. Infraestrutura (adapters, audit, auth, cache, config, prisma, providers, resolver) permanece em `src/`. `npx tsc --noEmit` sem erros, 98/98 testes passando.

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

ETAPA ATUAL    : Passo 6  Filas Assíncronas & Envio em Lote (BullMQ)
ETAPA ANTERIOR : Passo 5  Controllers do Data Plane (gate aprovado)
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
