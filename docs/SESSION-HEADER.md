# 🚀 SESSION-HEADER — SoftConnect 2.0

> Atualize os campos desta seção a cada nova sessão ou conclusão de fase antes de enviar.

---

## Contexto da Sessão ou fase

**Projeto:** SoftConnect 2.0
**Etapa atual:** Passo 4 — Implementação do EvolutionAdapter
**Objetivo desta sessão:** Implementar o EvolutionAdapter completo (HTTP client, métodos de instância/mensagem/chat/webhook, circuit breaker e testes)

---

## Documentos que Você Deve Ler Antes de Qualquer Ação

Leia os seguintes arquivos integralmente, nesta ordem, antes de responder:

1. `AGENTS.md` — regras de comportamento, o que pode e não pode fazer, como gerenciar fases
2. `docs/softconnect-spec-tecnica.md` — arquitetura, decisões, schema, endpoints
3. `docs/softconnect-plano-implementacao.md` — estado atual do projeto e fase em andamento
4. `README.md` — visão geral e guia de setup

> Não inicie nenhuma implementação antes de confirmar que leu todos os documentos acima.

---

## Instrução de Revisão

Esta etapa está pronta para ser iniciada. Antes de qualquer implementação, leia os documentos listados acima e confirme o estado atual do projeto.

```
ETAPA ATUAL    : Passo 4 — Implementação do EvolutionAdapter
ETAPA ANTERIOR : Passo 3 — Dynamic Adapters & Adapter Registry (gate aprovado)
ETAPA ANTERIOR : Passo 2.5 — Dashboard Auth & Usuários Admin (gate aprovado)
ETAPA ANTERIOR : Passo 2 — Admin Plane & Segurança (gate aprovado)
ETAPA ANTERIOR : Passo 1 — Fundações da Infraestrutura (gate aprovado)
ETAPA ANTERIOR : Passo 0 — Pipeline CI/CD (gate aprovado)
```

---

## Lembrete de Regras Críticas

> Os itens `[x]` são estados confirmados por você. O item `[ ]` é restrição ativa para o agente.

- [x] A fase anterior (Passo 0) tem o gate de validação marcado como `[x]` ✔
- [x] O Passo 1 está com gate de validação aprovado ✔
- [x] O Passo 2 está com gate de validação aprovado ✔
- [x] O Passo 2.5 está com gate de validação aprovado ✔
- [x] O Passo 3 está com gate de validação aprovado ✔
- [ ] Não avançar para o Passo 5 sem que o desenvolvedor marque o gate do Passo 4 e solicite explicitamente o avanço

Se qualquer inconsistência for encontrada na revisão, reporte antes de sugerir qualquer ação.