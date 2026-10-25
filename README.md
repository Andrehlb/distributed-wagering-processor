<a id="top"></a>

<div align="center">

**ANDREHLB DEVLAB · DISTRIBUTED WAGERING PROCESSOR**

[![INICIO](https://img.shields.io/badge/INICIO-1A1A1A?style=for-the-badge)](README.md) [![ARQUITETURA](https://img.shields.io/badge/ARQUITETURA-6D7F66?style=for-the-badge)](ARCHITECTURE.md) [![TESTES_102](https://img.shields.io/badge/TESTES_102-A7C2D6?style=for-the-badge)](docs/TEST_RESULTS.md) [![AUDITORIA](https://img.shields.io/badge/AUDITORIA-E18A7A?style=for-the-badge)](docs/AUDIT.md)

<sub>Documentação interligada · paleta: creme, areia, grafite, sálvia e coral</sub>

</div>

---

# Distributed Wagering Processor

Backend financeiro distribuído com Bun 1.x, TypeScript strict, NestJS, PostgreSQL, MikroORM e SQS via LocalStack. Processa BET, WIN, LOSS, REFUND e ROLLBACK com saldo exato, ledger imutável, idempotência persistente, Inbox e Transactional Outbox.

## 🧭 Navegação e evidências

[![Instalação](https://img.shields.io/badge/⚙️_Instalação-1E3A5F?style=for-the-badge)](#instalação-e-execução) [![API](https://img.shields.io/badge/🌐_API-2563EB?style=for-the-badge)](#api) [![SQS](https://img.shields.io/badge/📨_Mensageria-0F766E?style=for-the-badge)](#sqs-e-eventos) [![Testes](https://img.shields.io/badge/🧪_Testes-166534?style=for-the-badge)](#migrations-e-testes)

| Evidência | O que o avaliador encontra |
| --- | --- |
| [📊 Resultados de testes](docs/TEST_RESULTS.md) | **78 unitários + 24 de integração** registrados, cenários e resultados observados |
| [🏗️ Arquitetura e decisões](ARCHITECTURE.md) | Concorrência, idempotência, transações, SQS, limites e trade-offs |
| [🧪 Código dos testes distribuídos](test/distributed.integration.spec.ts) | Cenários reproduzíveis de duplicidade, concorrência, reversão e recuperação |
| [🔎 Auditoria inicial](docs/AUDIT.md) | Lacunas encontradas antes das correções; documento histórico |
| [🚀 Como executar](#instalação-e-execução) | Ambiente, banco, filas e três instâncias |
| [✅ Como reproduzir os testes](#migrations-e-testes) | Comandos de validação com Bun e containers reais |

> Os resultados são evidências registradas em `docs/TEST_RESULTS.md`; para confirmação independente, reproduza os comandos indicados abaixo.

[![Voltar ao topo](https://img.shields.io/badge/⬆️_VOLTAR_AO_TOPO-334155?style=flat-square)](#top)

---

## Instalação e execução

Requisitos: Bun 1.x (validado com 1.4.4), Docker e Docker Compose. Configure `POSTGRES_PASSWORD` em um `.env` local. O arquivo não é versionado. Preserve um `.env` existente; `.env.example` contém apenas valores de exemplo.

```bash
bun install --frozen-lockfile
# Somente em uma instalação nova:
test -e .env || cp .env.example .env
# Edite POSTGRES_PASSWORD antes de continuar.
docker compose up -d postgres localstack
bun run migrate
WORKERS_ENABLED=true bun run start
```

A API escuta em `http://localhost:3000`. Os workers ficam desabilitados por padrão para permitir execução controlada de testes; habilite `WORKERS_ENABLED=true` para consumo SQS, publicação da outbox e resolução automática de referências.

Execução integral em containers, com três instâncias e migrations antes da aplicação:

```bash
docker compose --profile app up -d --build --scale app=3
docker compose port --index 1 app 3000
```

As portas das instâncias são atribuídas pelo Docker. O comando de consulta informa a porta da primeira. Cada instância pode receber requisições e executar os três workers; a consistência depende do PostgreSQL.


[![⬆️ Voltar ao topo](https://img.shields.io/badge/⬆️_Voltar_ao_topo-334155?style=for-the-badge)](#top)

---

## API

| Método | Rota | Resultado |
| --- | --- | --- |
| POST | `/wallets` | Cria carteira; abertura positiva gera OPENING e ledger atômicos |
| GET | `/wallets/:walletId` | Saldo e versão |
| GET | `/wallets/:walletId/ledger?limit=50&cursor=...` | `items` e `nextCursor`; limite de 1 a 100 |
| POST | `/wallets/:walletId/reconciliation` | Saldo armazenado, saldo calculado, diferença e consistência |
| POST | `/wagering/transactions` | Processamento financeiro; exige `Idempotency-Key` |
| GET | `/wagering/transactions/:transactionId` | Estado atual da transação |
| GET | `/providers/:providerId/wagering/transactions/:externalTransactionId` | Consulta por identidade externa |
| GET | `/health/live` | Processo vivo |
| GET | `/health/ready` | PostgreSQL e filas SQS alcançáveis |
| GET | `/metrics` | Métricas em formato Prometheus |

Criar carteira:

```json
{
  "playerId": "player-123",
  "initialBalance": { "amount": "100.00", "currency": "BRL" }
}
```

Submeter uma aposta com `Idempotency-Key: provider-a:bet-123`:

```json
{
  "providerId": "provider-a",
  "externalTransactionId": "bet-123",
  "playerId": "player-123",
  "walletId": "<id retornado pela criação>",
  "roundId": "round-1",
  "gameId": "game-1",
  "kind": "BET",
  "money": { "amount": "80.00", "currency": "BRL" }
}
```

Todos os valores monetários entram e saem como strings com duas casas. O contrato público deste serviço aceita BRL; o domínio continua multi-moeda. REFUND e ROLLBACK exigem `referenceExternalTransactionId`. OPENING é exclusivamente interno. LOSS registra um valor positivo informativo, sem ledger nem mudança de versão.

| HTTP | Significado |
| --- | --- |
| 201 | Carteira criada |
| 200 | Operação processada, replay processado ou consulta/reconciliação |
| 202 | Referência pendente |
| 400 | Entrada inválida |
| 404 | Recurso ausente |
| 409 | Carteira duplicada ou conflito de identidade/payload |
| 413 | Corpo excessivamente grande |
| 422 | Rejeição financeira persistida, com `failureCode` |
| 503 | Dependência indisponível ou conflito SQL transitório; reenviar com a mesma chave |

O replay preserva a resposta da primeira aceitação, incluindo o saldo observado, e altera apenas `idempotentReplay` para `true`. Quando a primeira resposta foi 202, consulte o GET para obter o estado atualizado após resolução da referência.


[![⬆️ Voltar ao topo](https://img.shields.io/badge/⬆️_Voltar_ao_topo-334155?style=for-the-badge)](#top)

---

## SQS e eventos

O Compose cria `wager-transactions.fifo`, `wager-transactions-dlq.fifo` e `wager-events.fifo`. Use `MessageGroupId=walletId` e um `MessageDeduplicationId` por envio. As garantias financeiras permanecem no banco, inclusive após a janela de deduplicação do broker.

```json
{
  "messageId": "message-123",
  "type": "WagerTransactionRequested",
  "occurredAt": "2026-10-25T12:00:00.000Z",
  "correlationId": "request-123",
  "data": {
    "providerId": "provider-a",
    "externalTransactionId": "bet-123",
    "idempotencyKey": "provider-a:bet-123",
    "playerId": "player-123",
    "walletId": "<walletId>",
    "roundId": "round-1",
    "gameId": "game-1",
    "kind": "BET",
    "money": { "amount": "80.00", "currency": "BRL" }
  }
}
```

O consumidor usa o mesmo caso de uso da API, confirma a Inbox na transação financeira e faz ACK depois do commit. Erros permanentes vão à DLQ; falhas transitórias usam backoff, com até cinco recebimentos. A outbox emite `WagerTransactionProcessed`, `WagerTransactionRejected`, `WagerTransactionPendingReference` e `WalletBalanceChanged`. Consumidores de eventos devem deduplicar por `eventId`.


[![⬆️ Voltar ao topo](https://img.shields.io/badge/⬆️_Voltar_ao_topo-334155?style=for-the-badge)](#top)

---

## Migrations e testes

```bash
bun run migrate
bun run schema:audit       # Somente comparação; resultado esperado: diff vazio.
bun run typecheck
bun run build
bun run lint
bun run test:unit
bun run test:integration
```

A integração exige PostgreSQL e LocalStack reais, acesso às portas locais e permissão `CREATEDB` para o usuário de desenvolvimento. A suíte cria banco e filas com nomes únicos, executa três processos Bun e preserva os artefatos como evidência. Não limpa o banco de uso local. `bun test` executa os unitários e sinaliza os testes de integração como ignorados; `test:integration` os habilita explicitamente.

As migrations anteriores foram preservadas. Correções usam migrations incrementais; a suíte verifica `up → down até zero → up` em banco vazio e depois todas as constraints financeiras. Reversão manual: `bun scripts/migrate.ts down`. Reverta somente após avaliar os dados e a versão da aplicação.

Resultados executados: [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md). Decisões e limitações: [ARCHITECTURE.md](ARCHITECTURE.md). Auditoria inicial: [docs/AUDIT.md](docs/AUDIT.md).


[![⬆️ Voltar ao topo](https://img.shields.io/badge/⬆️_Voltar_ao_topo-334155?style=for-the-badge)](#top)

---

## Configuração

| Variável | Padrão / uso |
| --- | --- |
| `POSTGRES_PASSWORD` | Obrigatória; somente no ambiente local |
| `POSTGRES_HOST`, `POSTGRES_PORT` | `127.0.0.1`, `5432` |
| `POSTGRES_DB`, `POSTGRES_USER` | `wagering`, `wagering` |
| `PORT` | `3000` |
| `SQS_ENDPOINT`, `AWS_REGION` | `http://127.0.0.1:4566`, `us-east-1` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Credenciais de desenvolvimento do emulador; configure por ambiente |
| `WORKERS_ENABLED` | `false`; use `true` na execução funcional |
| `SQS_QUEUE_PREFIX` | Vazio; isolamento das filas de teste |
| `SQS_VISIBILITY_TIMEOUT` | `30` segundos; a suíte usa `2` para testar redelivery |

Autenticação externa não está implementada. O ponto de extensão `ProviderIdentityPort` e o desenho OIDC estão documentados na arquitetura. Esta entrega destina-se ao ambiente local do exercício.

[![⬆️ Voltar ao topo](https://img.shields.io/badge/⬆️_Voltar_ao_topo-334155?style=for-the-badge)](#top)


---

<div align="center">

[![VOLTAR_AO_TOPO](https://img.shields.io/badge/VOLTAR_AO_TOPO-6D7F66?style=for-the-badge)](#top)

</div>
