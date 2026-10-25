# Resultados de testes — Distributed Wagering Processor

## Validação final — 25/10/2026

Ambiente observado: Linux x64, Bun 1.4.4, NestJS 12, TypeScript 6 strict, MikroORM 7, PostgreSQL **17.11** em `postgres:17-alpine` e LocalStack **4.10.0**. PostgreSQL e SQS foram reais, em containers. As disputas HTTP usaram três processos Bun independentes; testes adicionais iniciaram processos próprios de consumidor e publisher.

| Check executado | Resultado real |
| --- | --- |
| `bun run test:unit` | **78 pass, 0 fail**, 159 asserções, 7 arquivos, 383 ms na execução registrada |
| `bun run test:integration` | **24 pass, 0 fail**, 161 asserções, 2 arquivos, **33,32 s** na última execução |
| `bun run typecheck` | Exit 0, sem diagnóstico; strictPropertyInitialization também habilitado |
| `bun run build` | Exit 0; Nest CLI executada com Bun |
| `bun run lint` | Exit 0, sem avisos |
| `bun run schema:audit` | Diff SQL vazio contra o banco local |
| Build Docker | Aprovado; instalação com `bun install --frozen-lockfile` |
| Compose com `--scale app=3` | Três containers em execução; migrator terminou com sucesso |
| Health nas três instâncias Docker | Readiness 200 em todas; liveness 200 verificado |
| Preservação do banco original | **1 carteira, 2 transações, 2 lançamentos**, mesmos totais financeiros da auditoria inicial |
| Consistência no banco original | **0 carteiras divergentes**; 10 migrations aplicadas |

Total final: **102 testes aprovados**, sem substituir PostgreSQL ou SQS por mocks. Os 70 testes unitários preexistentes continuam aprovados. `bun test` deixa a integração explicitamente ignorada; use o comando próprio para habilitá-la.

A última integração criou o próprio banco e prefixo de filas, sem apagar dados locais. Banco e filas isolados ficam preservados como evidência; rodadas anteriores também foram preservadas. Logs brutos da sessão ficaram em `/tmp`; este documento registra os resultados sem credenciais ou recibos de mensagens.

## Cenários comprovados

| Cenário | Evidência |
| --- | --- |
| Migrations reversíveis | Aplicação, reversão até zero em banco vazio e reaplicação; metadados sem diff |
| Restrições SQL | Saldo não negativo e finito, versão, unicidade de carteira, aritmética e unicidade do ledger, FKs, imutabilidade e dupla reversão |
| 50 envios simultâneos | Um transactionId, um resultado inicial, 49 replays e exatamente um débito, distribuídos por três processos |
| Duas apostas de 80.00 contra 100.00 | Uma aprovação, uma rejeição, saldo 20.00 e um débito |
| Carteiras distintas em paralelo | Outras carteiras concluíram enquanto uma wallet permaneceu sob lock deliberado |
| Idempotência persistente | Replay canônico, conflito divergente, corrida de uma chave entre wallets e vínculo permanente de chaves adicionais usadas em replay |
| Operações financeiras | BET, WIN, LOSS, REFUND e ROLLBACK; reversão parcial inválida, rodada/moeda/identidade inválidas e reversão insuficiente com código distinto |
| Referências fora de ordem | REFUND e ROLLBACK antes da BET tanto por HTTP quanto por SQS real; resolução posterior com saldo reconciliado |
| Referência inexistente | Expiração do limite persistido, REJECTED/REFERENCE_NOT_FOUND e evento correspondente |
| Falha antes do commit | Exceção controlada e morte real de processo; nenhum efeito parcial em wallet/transação/ledger/Inbox/Outbox |
| Morte após commit e antes do ACK | Processo encerrou imediatamente no ponto de falha; outro consumidor tratou redelivery sem repetir débito |
| Inbox/redelivery | Uma Inbox por identidade, replay seguro e conflito de messageId com payload diferente |
| Retry e DLQ | Backoff de visibilidade, falhas repetidas, limite de tentativas, payload malformado e ACK de rejeição financeira |
| Outbox antes do commit | Publisher executado durante transação financeira não observou eventos ainda não confirmados |
| Indisponibilidade SQS | Conexão recusada; tentativa/nextAttemptAt persistidos e publicação recuperada após retorno do transporte |
| Publishers concorrentes | Dois processos sobre a mesma outbox; todos os eventos observados na fila de saída |
| Morte após publicação | Lease expirada recuperada por outro publisher, preservando eventId |
| Reinício da aplicação | Idempotência preservada; workers habilitados recuperaram automaticamente referência pendente |
| API e paginação | Entrada inválida, JSON inválido, OPENING externo, consultas por dois identificadores, cursor estável e reconciliação |
| Observabilidade | Correlação, métricas, readiness 503 com SQS indisponível e liveness 200 |
| Invariante final | Após cada teste, todas as carteiras do banco isolado foram comparadas à soma exata do ledger |

Os testes não esperam 24 horas em tempo real. Eles aceleram vencimento do agendamento de retry e a visibilidade da fila explicitamente. Não houve teste de carga, AWS real, perda de disco ou failover de PostgreSQL.

## Arquivos e resultados por bloco

| Bloco | Arquivos principais | Correção e validação |
| --- | --- | --- |
| 1. Auditoria e correções críticas | `docs/AUDIT.md`, `src/infrastructure/database/entities/*`, migrations 30000–70000 | Comparação com schema aplicado; FKs/timestamptz, constraints, snapshots e integridade SQL. Baseline de 70 testes e diff final vazio |
| 2. Casos de uso financeiros | `src/application/use-cases/*`, `src/domain/wager-transaction/*`, `src/domain/events/*`, `src/domain/messaging/*` | Todas as operações, referências, snapshots e chaves; unitários e cenários financeiros reais aprovados |
| 3. API e persistência | `src/interfaces/http/*`, `src/app.module.ts`, `src/main.ts` | Endpoints obrigatórios, status, erros e cursor; integração HTTP aprovada |
| 4. SQS, Inbox e Outbox | `src/infrastructure/messaging/*`, `compose.yaml`, `Dockerfile`, `scripts/init-queues.sh` | ACK após commit, leases, retry/DLQ e recuperação; SQS real e três containers aprovados |
| 5. Testes obrigatórios | `test/distributed.integration.spec.ts`, `test/fixtures/crash-worker.ts`, testes unitários novos e existentes | 78 unitários + 24 integrações aprovados; constraints e falhas reais |
| 6. Observabilidade e documentação | `src/infrastructure/observability/telemetry.ts`, health/controller/filtro HTTP, `README.md`, `ARCHITECTURE.md` | Logs JSON, correlação, métricas e health; instruções reproduzíveis, decisões e limitações registradas |

Não há pendência identificada no núcleo obrigatório implementado e validado. Autenticação externa, dashboards, tracing, teste de carga e ledger de partidas dobradas permanecem opcionais e não foram apresentados como implementados.

## Falhas encontradas e corrigidas durante a execução

- A primeira tentativa de migration teve erro de sintaxe; PostgreSQL reverteu integralmente a tentativa.
- O primeiro smoke test revelou acesso inválido a um campo de NEW no trigger de consistência; a operação financeira sofreu rollback. A correção foi uma migration incremental, sem editar a já aplicada.
- A primeira rodada de integração terminou em 16 pass/2 fail: o helper SQS recebia com visibilidade zero, produzindo recibos expirados. Corrigido o helper, as rodadas seguintes passaram.
- A revisão detectou que chaves adicionais usadas em replay por ID externo precisavam ser reservadas permanentemente; migration e teste adicionados.
- Foram adicionadas constraints contra NaN porque numeric do PostgreSQL aceita esse valor especial.
- O primeiro Compose sem build da imagem do migrator não subiu; aplicação e migrator passaram a compartilhar explicitamente a mesma imagem. A execução integral posterior foi validada.

---

## Histórico preservado — anterior à implementação financeira

O registro abaixo descreve apenas o estado inicial de 23/10. As limitações mencionadas nele foram superadas na validação acima.

# Test Results — Distributed Wagering Processor Backend Challenge

## 1. Initial Environment Validation

**Date:** 2026-10-23
**Environment:** Ubuntu 22.04.5 LTS
**Runtime:** Bun 1.4.4
**Framework:** NestJS 12
**Test Framework:** Vitest 4.1.12

### Build Validation

**Command:** `bun run build`

**Result:** PASSED

NestJS project compiled successfully without reported errors.

### Unit Test Validation

**Command:** `bun run test`

**Result:** PASSED

| Metric | Result |
|---|---|
| Test files | 1 passed |
| Unit tests | 1 passed |
| Execution time | 1.67 seconds |

**Validated behavior:** `AppController` returns `"Hello World!"`.

### Scope and Limitations

This initial validation confirms that the generated project builds and its starter unit test passes.

Financial domain rules, database integration, concurrency, idempotency, and messaging have not yet been tested.
