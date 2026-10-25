<a id="top"></a>

<div align="center">

**ANDREHLB DEVLAB · DISTRIBUTED WAGERING PROCESSOR**

[![INICIO](https://img.shields.io/badge/INICIO-1A1A1A?style=for-the-badge)](../README.md) [![ARQUITETURA](https://img.shields.io/badge/ARQUITETURA-6D7F66?style=for-the-badge)](../ARCHITECTURE.md) [![TESTES_102](https://img.shields.io/badge/TESTES_102-A7C2D6?style=for-the-badge)](TEST_RESULTS.md) [![AUDITORIA](https://img.shields.io/badge/AUDITORIA-E18A7A?style=for-the-badge)](AUDIT.md)

<sub>Documentação interligada · paleta: creme, areia, grafite, sálvia e coral</sub>

</div>

---

# Auditoria inicial — 25/10/2026

Base: commit cdf3944, seis commits na linha local e alterações de aplicação/persistência ainda não commitadas. O histórico também contém um commit de remoção de atribuição fora da linha atual. Alterações preexistentes foram preservadas. Banco existente: 1 wallet, 2 transações, 2 lançamentos; cinco migrations aplicadas.

## Evidências e lacunas

- 70 testes unitários existentes passaram com Bun 1.4.4. Eles não validavam concorrência, HTTP financeiro ou SQS.
- Money usa bigint em centavos; Wallet mantém versão; WagerTransaction modela estados terminais; ledger valida aritmética. Classes e testes serão preservados.
- ProcessWagerUseCase aceita somente BET. Bloqueia a wallet com FOR UPDATE, mas uma chave disputada por wallets diferentes pode produzir erro SQL de unicidade em vez de conflito de negócio.
- Hash usa ordem fixa, sem ordenação recursiva; snapshot existente cobre BET; abertura não registra snapshot.
- Não há WIN/LOSS/REFUND/ROLLBACK na aplicação, Inbox, retry de referências, consumidor, publisher, DLQ ou shutdown de workers.
- Faltam consultas, paginação, reconciliação, readiness/liveness, métricas e logs JSON. README ainda é o scaffold.
- Schema real confirmado: numeric(30,2), timestamptz, FKs, unicidades e trigger de imutabilidade do ledger. Metadados usam datetime sem columnType explícito; não representam outbox, FKs nem índices adicionais. Migrations incrementais e metadados devem ser reconciliados sem schema:update.
- SQL ainda permite dupla reversão por operações distintas, mutação de transações terminais e divergência entre saldo/ledger por escrita direta.
- package.json e documentos históricos contêm atribuição que precisa ser removida dos arquivos de entrega.

## Plano de validação

Testes unitários existentes; PostgreSQL e LocalStack reais; banco isolado para integração (sem apagar dados locais); três processos Bun concorrentes; 50 duplicatas; disputa 80/100; falhas antes/depois do commit; redelivery/DLQ/retry; publishers concorrentes; referências invertidas; reinício; schema e migrations up/down em banco isolado. Resultados executados serão registrados em TEST_RESULTS.md.

## Encerramento da auditoria

As lacunas acima foram tratadas preservando o domínio e os testes corretos. O estado final e a relação de arquivos por bloco estão em TEST_RESULTS.md. PostgreSQL local permaneceu com 1 carteira, 2 transações e 2 lançamentos; o schema agora possui 10 migrations. As cinco migrations originais foram mantidas, e os novos problemas foram corrigidos por migrations incrementais.

Validação final: 78 testes unitários e 24 de integração aprovados; build, lint e TypeScript strict aprovados; diff SQL vazio; três instâncias Docker com readiness 200. Limitações opcionais e trade-offs estão em ARCHITECTURE.md. Nenhum push foi executado.


---

<div align="center">

[![VOLTAR_AO_README](https://img.shields.io/badge/VOLTAR_AO_README-1A1A1A?style=for-the-badge)](../README.md) [![VOLTAR_AO_TOPO](https://img.shields.io/badge/VOLTAR_AO_TOPO-6D7F66?style=for-the-badge)](#top)

</div>
