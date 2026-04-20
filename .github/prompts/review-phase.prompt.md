---
name: review-phase
description: Use when a phase implementation is complete and you want only the review, without reloading full session context. Reviews what was done, reports inconsistencies, and enforces the developer gate before any next phase begins.
mode: agent
version: 1.0.0
---

# Phase Review — SoftConnect 2.0

> Use this when you are already in an active session and just concluded a phase. If starting a new session, use `/project-context` instead.

---

## Review Context

```
PHASE TO REVIEW : [e.g. Passo 1 — Fundações da Infraestrutura]
PREVIOUS PHASE  : [e.g. Passo 0 — Pipeline CI/CD (gate approved)]
```

---

## What to Do

1. Read the implementation checklist for the phase above in `docs/softconnect-plano-implementacao.md`
2. Apply the review protocol from `docs/REVIEW-INSTRUCTIONS.md`
3. Report findings — list what is complete, what is missing, and any inconsistencies found
4. Do not mark developer validation gates — only the developer does that
5. Do not suggest or begin the next phase — wait for explicit developer instruction

---

## Active Restrictions

- Do not advance to the next phase under any circumstance during this review
- If inconsistencies are found between spec and code, report all of them before suggesting any fix
- If the developer asks to advance without completing the gate, alert clearly and wait for deliberate confirmation