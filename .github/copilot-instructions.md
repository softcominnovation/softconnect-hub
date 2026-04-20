# SoftConnect 2.0 — Copilot Instructions

> Read this file entirely before any interaction with the project.
> It defines how you must behave, what you can and cannot do, and how to manage development progress.

---

## 1. Project Context

**SoftConnect 2.0** is a NestJS multi-provider messaging API Gateway developed by Softcom. The full technical specification is in `docs/softconnect-spec-tecnica.md` and the implementation plan in `docs/softconnect-plano-implementacao.md`.

**Before any task, read:**
1. `AGENTS.md` — behavior rules, what you can and cannot do, how to manage phases
2. `docs/softconnect-spec-tecnica.md` — architecture, decisions, schema, endpoints
3. `docs/softconnect-plano-implementacao.md` — current project state and active phase
4. `README.md` — overview and setup guide
5. `.github/prompts/code-guidelines.prompt.md` — coding principles to apply in every task

---

## 2. Phase Progression Rules

### What is a "validation gate"

Each phase in the implementation plan ends with a `### ✅ Validação do Desenvolvedor` section containing checklists that **the developer** must verify and mark manually.

**A phase is only complete when:**
- All implementation items in the phase are marked `[x]`
- All developer validation gate items are marked `[x]`
- The developer has **explicitly** requested advancement to the next phase

### What to do at the end of a phase

When a phase implementation is complete:

1. Update `docs/softconnect-plano-implementacao.md` — mark `[x]` on all implementation items effectively completed in the session
2. Leave developer validation gate items as `[ ]` — **never mark developer gates**, only the developer does that
3. Add the following block at the start of the next phase (right after the `## Passo N` header), if not already present:

```markdown
> **🔒 Este passo está bloqueado. O Passo N-1 deve ser concluído e o gate de validação do desenvolvedor aprovado antes de iniciar qualquer tarefa aqui.**
```

4. Update the **Estado Atual do Projeto** table at the top of the file to reflect real status

### What you must NEVER do

- **Never** begin implementation of a phase whose previous step gate is not marked `[x]`
- **Never** mark developer validation items as `[x]` — that is exclusively the developer's responsibility
- **Never** suggest advancing to the next phase without explicit developer request
- If the developer asks to advance without a completed gate, **alert clearly** and wait for deliberate confirmation

### How to identify the current project point

Check the **Estado Atual do Projeto** table in `docs/softconnect-plano-implementacao.md`. The phase with status `⏳ Em andamento` is the active phase. Phases with `🔒 Bloqueado` must not be touched.

---

## 3. Code

- Strictly follow patterns and conventions already adopted in the application (naming, NestJS module structure, TypeScript style)
- Do not include comments in code, except when complexity justifies it or when explicitly requested
- Do not remove existing comments unless they are incorrect or outdated
- Do not remove commented-out code unless explicitly requested or part of a general refactor — in that case, preserve as history
- Avoid creating new abstractions, classes, or functions beyond what the task requires
- Prefer constructor-based dependency injection (NestJS standard) — avoid instantiating services directly
- Do not alter `schema.prisma` unless it is explicitly part of the task — schema changes require a new migration and Prisma Client update
- When creating a migration, use a descriptive name: `npx prisma migrate dev --name description_of_change`
- Never run `prisma migrate reset` in a production context — only in local development

---

## 4. Modules and NestJS Architecture

- Respect the folder structure defined in `docs/softconnect-spec-tecnica.md`, section 3
- Each module must be self-contained: controller, service, and module in the same directory
- Module exports must be explicit — do not export what does not need to be consumed externally
- Global guards, interceptors, and filters must be registered in `app.module.ts` — not in individual modules, except with justification
- Environment variables must always be accessed via `ConfigService` — never via `process.env` directly in business logic

---

## 5. Security

- Never include or suggest real secret values (keys, tokens, passwords) in examples, production seeds, or code
- VPS credentials must always be encrypted with AES-256-GCM before persisting — never store in plain text
- API Keys must be stored only as SHA-256 hash — never the raw key
- When implementing any authentication or authorization mechanism, briefly justify the choice
- When suggesting changes that affect persisted data, describe the impact and how to rollback if necessary

---

## 6. Performance and Hot Path

- The database **must never** be queried in the message hot path — Redis only
- Any new logic that may add latency to the hot path must be justified and discussed before implementing
- Audit logs must be **always** async — never block the response with `await` on log operations
- Redis cache must include adequate TTL — never set without TTL on auth or instance keys

---

## 7. Tests

- Implement tests only when they are explicitly part of the phase or when requested
- Unit tests go in `*.spec.ts` alongside the tested file
- E2E tests go in `test/`
- Use mocks for external dependencies (Redis, Postgres, provider HTTP) — never depend on real services in unit tests
- Do not run `npm test` or builds during development — validation occurs at the end of the phase

---

## 8. Dependencies

- Do not install packages not listed in `package.json` without checking if a native or already-installed alternative exists
- When proposing a new dependency, briefly justify it and confirm approval before installing
- Prefer native Node.js modules when functionality is simple (e.g. `crypto` for hash and encryption)

---

## 9. Documentation

Update documentation **only when the implementation involves structural changes to the project**. Updating docs on every small interaction is not necessary.

### When to update `README.md`
- New setup prerequisites or environment variables
- Change in local startup process (new steps or commands)
- New relevant public endpoint that changes the external API contract

### When to update `docs/softconnect-spec-tecnica.md`
- Schema change (new table, field, or relation)
- Addition of a new adapter or provider
- Change in Redis keys or TTLs
- Change in endpoint mapping
- Any architectural decision not covered by the current spec

### When to update `docs/softconnect-plano-implementacao.md`
- When completing phase items — mark `[x]` on implemented items
- When adding a block to the next phase after completing the current one
- When updating the current project state table

### When NOT to update docs
- Punctual bug fixes that do not change contract or architecture
- Internal refactors with no external impact
- Style or linting adjustments

---

## 10. Communication

- When starting a task, briefly confirm what will be done and which phase of the plan it fits into
- When finishing an implementation, report which files were created or modified
- If an inconsistency is found between the spec and existing code, **report before implementing** — do not resolve silently
- If a requested task conflicts with an architectural decision documented in `docs/softconnect-spec-tecnica.md` (section 16 — Decisões Arquiteturais), alert the developer before proceeding
- Never assume the developer wants to advance a phase — wait for explicit instruction

---

## Available Prompts

- `/session-start` — Use at the beginning of every new chat session to load project context and active phase
- `/review-phase` — Use when a phase is complete and needs validation before advancing
- `/code-guidelines` — Use when writing, reviewing, or refactoring code