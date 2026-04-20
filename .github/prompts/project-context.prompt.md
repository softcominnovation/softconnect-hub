---
name: project-context
description: Use at the beginning of every new session or when advancing between phases. Loads full project context, identifies the active phase, and runs the review protocol when applicable. Loads project context, identifies the active phase, and runs the review protocol when applicable.
mode: agent
version: 1.0.0
---

# Project Context — SoftConnect 2.0

> Update the fields below before sending. Use this prompt at the start of every new session or whenever a phase is concluded and needs validation.

---

## Session Context

```
PROJECT        : SoftConnect 2.0
CURRENT PHASE  : [e.g. Passo 1 — Fundações da Infraestrutura]
PREVIOUS PHASE : [e.g. Passo 0 — Pipeline CI/CD (gate approved) — or "none"]
SESSION GOAL   : [e.g. implement Redis cache layer / review and validate Passo 1]
```

---

## Documents to Read Before Any Action

Read the following files in full, in this order, before responding:

1. `AGENTS.md` — behavior rules, what you can and cannot do, how to manage phases
2. `docs/softconnect-spec-tecnica.md` — architecture, decisions, schema, endpoints
3. `docs/softconnect-plano-implementacao.md` — current project state and active phase
4. `README.md` — overview and setup guide

Do not begin any implementation before confirming you have read all documents above.

---

## If This Session Is a Phase Review

If the SESSION GOAL above indicates a phase conclusion or gate validation, before any other action apply the review protocol defined in `docs/REVIEW-INSTRUCTIONS.md` with the parameters above.

---

## Guidelines

Apply the coding principles defined in [code-guidelines](#file:.github/prompts/code-guidelines.prompt.md)
to every task in this session.
---

## Critical Rules Reminder

> `[x]` = state confirmed by the developer. `[ ]` = active restriction for the agent.

- [ ] Previous phase gate is marked `[x]` in `docs/softconnect-plano-implementacao.md`
- [ ] Do not advance to the next phase without explicit developer instruction
- [ ] If any inconsistency is found, report before suggesting any action
- [ ] Never mark developer validation gates — only the developer does that