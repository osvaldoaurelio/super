# Backlog de melhorias — Super API

Arquivo de rastreamento das melhorias propostas na revisão de arquitetura. Trabalhe **uma melhoria por vez**: abra uma branch/PR por item, marque o status ao concluir e só então comece o próximo.

## Como usar

1. Escolha **um** item (comece pela ordem do roadmap).
2. Atualize o status para `🚧 Em andamento` **antes** de começar.
3. Conclua os passos pequenos, marcando-os com `[x]`.
4. Ao final do item: rode o checklist de validação (seção **Skills de validação**), marque o item como `✅ Concluído` e registre data e PR na linha do item.
5. Nunca marque como concluído um item com passos pendentes ou validação não executada.

### Legenda de status

| Marcador          | Significado                                    |
| ----------------- | ---------------------------------------------- |
| `⬜ A fazer`      | Item ainda não iniciado                        |
| `🚧 Em andamento` | Trabalho iniciado; indicar branch/PR           |
| `✅ Concluído`    | Todos os passos marcados e validação executada |
| `⏸️ Bloqueado`    | Aguarda decisão externa ou dependência         |

---

## Sumário de status

| ID  | Item                                                      | Severidade | Fase | Status       | PR/Data                                       |
| --- | --------------------------------------------------------- | ---------- | ---- | ------------ | --------------------------------------------- |
| P1  | Head-of-line blocking no dispatcher da outbox             | 🔴 Crítico | V1   | ✅ Concluído | fix/outbox-head-of-line — 13/11/2026          |
| P2  | Invalidação de cache via `SCAN` no hot path               | 🔴 Crítico | V1   | ✅ Concluído | fix/cache-versioned-invalidation — 13/11/2026 |
| P3  | Comparação sem frescor + `observedAt` no futuro           | 🔴 Crítico | V1   | ✅ Concluído | fix/price-freshness-window — 13/11/2026       |
| P4  | Ingestão sem validação de payload, DLQ e feedback         | 🟠 Alto    | V1   | ✅ Concluído | fix/ingestion-dlq-feedback — 13/11/2026       |
| P5  | Over-engineering: outbox → polling → BullMQ               | 🟠 Alto    | V1   | ✅ Concluído | fix/outbox-batch-worker — 13/11/2026          |
| P6  | Rate limiting ausente                                     | 🟠 Alto    | V1   | ✅ Concluído | feat/redis-rate-limiting — 13/11/2026         |
| P7  | Busca, geo, alertas e cesta ausentes                      | 🟠 Alto    | V2   | ⬜ A fazer   | —                                             |
| P8  | Idempotência global por chave única                       | 🟡 Médio   | V1   | ⬜ A fazer   | —                                             |
| P9  | Paginação cursor-based ausente                            | 🟡 Médio   | V2   | ⬜ A fazer   | —                                             |
| P10 | Modelo sem tipo de preço (promo vs regular)               | 🟡 Médio   | V2   | ⬜ A fazer   | —                                             |
| P11 | Módulo de auth com camadas inconsistentes                 | 🟡 Médio   | V1   | ⬜ A fazer   | —                                             |
| P12 | Métricas de domínio e trace nos jobs ausentes             | 🟡 Médio   | V2   | ⬜ A fazer   | —                                             |
| P13 | Drift de migrações e índice fantasma                      | 🟡 Médio   | V1   | ⬜ A fazer   | —                                             |
| P14 | `/health/worker` enganoso + `process.env` fora do `env`   | 🟡 Médio   | V1   | ⬜ A fazer   | —                                             |
| P15 | Detalhes menores (shutdown, portas gordas, dedup de rede) | 🟢 Baixo   | V2   | ⬜ A fazer   | —                                             |

---

## Fase V1 — corrigir o que existe

### P1 — Head-of-line blocking no dispatcher da outbox

**Arquivos:** `src/infrastructure/queue/outbox-dispatcher.ts`, `src/infrastructure/database/schema.ts`, `src/infrastructure/observability/metrics.ts`

**Objetivo:** um evento que falha repetidamente não pode travar a publicação dos demais; o backlog precisa ser observável.

- [x] 1.1 Adicionar colunas `attempts integer NOT NULL DEFAULT 0` e `last_error text` em `outbox_events` (`schema.ts`).
- [x] 1.2 Gerar migração com `bun run db:generate`, revisar o SQL e o journal (`drizzle/0001_lame_venus.sql`).
- [x] 1.3 Alterar a query do dispatcher para filtrar `attempts < 10` (`DrizzleOutboxStore.claimPending`).
- [x] 1.4 No `catch`, incrementar `attempts` e gravar `last_error` (truncado em 500 chars); **remover o `break`** (`markFailed` + `dispatchPendingBatch`).
- [x] 1.5 Adicionar gauge `outbox_backlog_events` (pendentes, inclusive os esgotados) e counter `outbox_dispatch_failures_total` em `metrics.ts`.
- [x] 1.6 Teste unitário do dispatcher com fake de banco/queue cobrindo: evento envenenado não bloqueia os seguintes; evento atinge `attempts = 10` e deixa de ser selecionado.
- [x] 1.7 Executar validação (Skills → SV1, BP1, BP5).

**Status:** ✅ Concluído — PR/Data: `fix/outbox-head-of-line` — 13/11/2026

**Notas de implementação:**

- A porta `OutboxStore` (`application/ports/outbox-store.ts`) foi extraída para permitir doubles nos testes; o adaptador Drizzle fica em `infrastructure/queue/drizzle-outbox-store.ts` e o dispatcher recebe `store`/`publish`/`sleep`/`now` por injeção.
- O `SELECT ... FOR UPDATE SKIP LOCKED` anterior rodava em transação encerrada antes do `publish` (lock sem efeito). A publicação continua at-least-once e a duplicidade é contida pelo `jobId = event.id` no BullMQ; a atualização de `attempts`/`publishedAt` é condicional a `published_at is null`.
- Falhas de infraestrutura do próprio store (Postgres indisponível) são logadas e o loop volta após 5 s, sem encerrar o dispatcher.
- Evento que atinge 10 tentativas permanece com `published_at is null` e é contado em `outbox_backlog_events`, sinalizando backlog crescente (DLQ formal é escopo do P4).

---

### P2 — Invalidação de cache via `SCAN` no hot path

**Decisão (2.1):** usar bump de versão persistente por produto (`INCR` em `prices:ver:{productId}` e `history:ver:{productId}`). As chaves de versão não expiram: isso evita reutilizar uma versão antiga enquanto ainda houver chaves de dados criadas por uma consulta concorrente. Chaves de dados continuam limitadas pelos TTLs de 60 s / 300 s.

**Arquivos:** `src/infrastructure/cache/redis-cache.ts`, `src/application/ports/cache.ts`, `src/application/use-cases/compare-prices.ts`, `src/application/use-cases/get-price-history.ts`, `src/infrastructure/queue/price-worker.ts`

**Objetivo:** eliminar `SCAN` global do caminho de ingestão; bump de versão O(1) por produto.

- [x] 2.1 Decidir estratégia e registrar aqui: bump de versão por produto (recomendado) **ou** `UNLINK` por chave exata.
- [x] 2.2 Estender a porta `Cache` com `bumpVersion(key): Promise<number>` (implementação Redis `INCR`).
- [x] 2.3 Montar chaves `prices:v2:{productId}:{ver}:{state|*}:{city|*}` no use-case de comparação (idem histórico: `history:v2:{productId}:{ver}:{days}:{limit}`).
- [x] 2.4 No worker, substituir `cache.deleteByPrefix(...)` por `cache.bumpVersion(...)` (duas chamadas: `prices:ver` e `history:ver`).
- [x] 2.5 Manter TTLs atuais (60 s / 300 s) como bound de consistência.
- [x] 2.6 Remover `deleteByPrefix` da porta `Cache` **apenas** quando nenhum chamador restar (evitar API morta).
- [x] 2.7 Atualizar testes unitários dos use-cases (chave com versão) e E2E se afetado.
- [x] 2.8 Executar validação (Skills → SV1, BP1, BP4).

**Status:** ✅ Concluído — PR/Data: `fix/cache-versioned-invalidation` — 13/11/2026

---

### P3 — Comparação sem semântica de frescor + `observedAt` no futuro

**Arquivos:** `src/domain/prices/price.ts`, `src/infrastructure/database/price-repository-drizzle.ts`, `tests/*`

**Objetivo:** regra de domínio "preço atual = última observação dentro da janela de frescor"; impedir datas absurdas.

- [x] 3.1 Em `Price.create`: rejeitar `observedAt` no futuro (> now + 5 min) e muito antigo (> 365 dias) com `DomainError` códigos dedicados.
- [x] 3.2 Adicionar testes unitários para as duas novas invariantes em `tests/unit/price.test.ts`.
- [x] 3.3 Definir constante de frescor (sugestão: 30 dias) em local compartilhado entre domínio/repositório.
- [x] 3.4 Em `compare()`, adicionar filtro `observedAt >= now() - interval '<30 days>'`.
- [x] 3.5 Documentar a regra de frescor no README (seção "Modelo de dados").
- [x] 3.6 Teste de integração: oferta fora da janela não aparece em `compare`.
- [x] 3.7 Executar validação (Skills → SV1, BP1, BP2, BP5).

**Status:** ✅ Concluído — PR/Data: `fix/price-freshness-window` — 13/11/2026

---

### P4 — Ingestão sem validação de payload, DLQ e feedback

**Arquivos:** `src/infrastructure/queue/outbox-dispatcher.ts`, `src/infrastructure/queue/price-worker.ts`, novo `src/infrastructure/queue/price-props-schema.ts`

**Objetivo:** payload validado na fronteira; falha definitiva vai para DLQ observável; sem casts injustificados.

- [x] 4.1 Criar `PricePropsSchema` (Zod) espelhando `PriceProps`; usar na validação do `event.payload` no dispatcher e do job no worker.
- [x] 4.2 Remover o cast `event.payload as PriceProps`.
- [x] 4.3 Falha de validação/FK (erro definitivo) → mover evento para estado `dead` (coluna `status` na outbox) com `last_error`.
- [x] 4.4 Falha transitória no dispatch usa tentativas da outbox; falha transitória do worker continua retryable pelo BullMQ.
- [x] 4.5 Gauge/counter de eventos em `dead` + entrada no README sobre DLQ/replay.
- [x] 4.6 Testes: payload inválido não vira veneno silencioso; FK inexistente termina em `dead`.
- [x] 4.7 Executar validação (Skills → SV1, BP1, BP5).

**Status:** ✅ Concluído — PR/Data: `fix/ingestion-dlq-feedback` — 13/11/2026

---

### P5 — Over-engineering: outbox → polling → BullMQ

**Arquivos:** `src/infrastructure/queue/*`, `src/worker.ts`, `docker-compose.yml`, `README.md`

**Objetivo:** um único hop de ingestão. Decidir entre (a) consumir outbox direto no worker em batch (remover BullMQ por ora) ou (b) manter BullMQ e remover a outbox.

**Decisão (5.1):** adotar (a): manter a outbox transacional e consumi-la diretamente pelo worker em lotes. Isso preserva a confirmação durável do `POST /prices` no PostgreSQL e a idempotência já implementada, removendo o salto de publicação BullMQ/Redis e a necessidade de manter o Redis de fila. Falhas e replay continuam observáveis pela outbox/DLQ.

- [x] 5.1 Registrar decisão e justificativa neste arquivo.
- [x] 5.2 **Se (a):** worker processa outbox em batch (`SELECT ... FOR UPDATE SKIP LOCKED LIMIT 200`) e grava `price_history`/`current_prices` na mesma transação.
- [x] 5.3 **Se (a):** remover dependência de BullMQ (`package.json`, compose, portas) e preservar idempotência por chave — ver P8 para unicidade composta por fonte.
- [n/a] 5.4 **Se (b):** alternativa não escolhida.
- [x] 5.5 Ajustar `worker.ts` e shutdown para o desenho escolhido.
- [x] 5.6 Testes de integração cobrindo batch e idempotência na repetição de entrega.
- [x] 5.7 Atualizar diagrama e README (seção "Fila/outbox").
- [x] 5.8 Executar validação (Skills → SV1, BP1, BP4, BP5).

**Status:** ✅ Concluído — PR/Data: `fix/outbox-batch-worker` — 13/11/2026

O worker agora reivindica até 200 eventos com `FOR UPDATE SKIP LOCKED`, persiste preço e marcação `processed` atomicamente, isolando cada evento com savepoint. Erros permanentes vão para `dead`; transitórios incrementam tentativas e recebem pausa antes do retry. A migração `0003_outbox_batch_processing` reativa eventos legados não mortos com tentativas zeradas e atualiza estado, timestamp e índice. BullMQ e Redis de fila foram removidos; os testes de integração cobrem DLQ, retry, replay idempotente e o limite de lote.

---

### P6 — Rate limiting configurado mas não implementado

**Arquivos:** `src/config/env.ts`, `src/http/middleware/` (novo), `src/http/app.ts`, `src/infrastructure/cache/redis-cache.ts`

**Objetivo:** proteção real de `auth/*` (credential stuffing, DoS via scrypt) e de `POST /prices`.

- [x] 6.1 Criar middleware de janela fixa no Redis de cache (chave `rl:{escopo}:{identificador}`).
- [x] 6.2 Aplicar por IP em `auth/register` e `auth/login`; por `userId`+IP em `POST /prices`.
- [x] 6.3 Usar `env.RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_SECONDS` (config atual passa a viva).
- [x] 6.4 Resposta `429` com envelope de erro padrão e header `Retry-After`.
- [x] 6.5 Falha do Redis ⇒ fail-open (best-effort), logado em `warn`.
- [x] 6.6 Testes E2E: exceder limite retorna 429; Redis off não quebra a rota.
- [x] 6.7 Executar validação (Skills → SV1, SV2, BP1, BP5).

**Status:** ✅ Concluído — PR/Data: `feat/redis-rate-limiting` — 13/11/2026

O contador Redis usa `INCR`/`EXPIRE` atômicos via Lua, com janelas separadas por endpoint e identidade. O IP vem do socket Bun (não de `X-Forwarded-For`); se Redis falhar, o middleware registra `warn` e permite a requisição. Os testes cobrem limites, isolamento por IP/usuário, `Retry-After`, contrato OpenAPI e falha do contador.

---

### P8 — Idempotência global por chave única

**Arquivos:** `src/infrastructure/database/schema.ts`, migração nova

**Objetivo:** unicidade por fonte; colisão entre fontes distintas não descarta preço silenciosamente.

- ⬜ 8.1 Criar migração: trocar `price_history.idempotency_key UNIQUE` por `UNIQUE (source, idempotency_key)` (dropar índice global antigo).
- ⬜ 8.2 Idem para `outbox_events.idempotency_key` → `UNIQUE (type, idempotency_key)`.
- ⬜ 8.3 Revisar `onConflictDoNothing` no repositório/consumer da outbox para o novo alvo de conflito.
- ⬜ 8.4 Teste de integração: mesma chave de fontes diferentes ⇒ ambas as observações gravadas.
- ⬜ 8.5 Executar validação (Skills → BP2, BP5, SV3).

**Status:** ⬜ A fazer — PR/Data: —

---

### P11 — Módulo de auth com camadas inconsistentes

**Arquivos:** `src/http/routes/auth.ts`, novos `src/application/use-cases/register-user.ts` / `authenticate-user.ts`, `src/application/ports/user-repository.ts`, `src/infrastructure/database/user-repository-drizzle.ts`

**Objetivo:** mesmo estilo do módulo de preços; lógica de registro/login reutilizável e testável.

- ⬜ 11.1 Criar porta `UserRepository` (`findByEmail`, `create`).
- ⬜ 11.2 Extrair use-case `RegisterUser` (email canônico, hash, detecção de 23505 → erro de domínio `EMAIL_EXISTS`).
- ⬜ 11.3 Extrair use-case `AuthenticateUser` (verificação de senha, emissão de token).
- ⬜ 11.4 Rotas passam a depender das portas; composição em `app.ts`/`createApp`.
- ⬜ 11.5 Testes unitários dos use-cases com doubles (sem tocar banco).
- ⬜ 11.6 Executar validação (Skills → SV1, SV2, BP1, BP3, BP5).

**Status:** ⬜ A fazer — PR/Data: —

---

### P13 — Drift de migrações e índice fantasma

**Arquivos:** `src/infrastructure/database/schema.ts`, `drizzle/*`

**Objetivo:** única fonte de verdade de schema; nenhum DDL fora do journal.

- ⬜ 13.1 Adicionar `current_prices_store_product_idx (store_id, product_id)` em `schema.ts` **ou** remover do SQL manual — registrar a decisão.
- ⬜ 13.2 Decidir destino de `drizzle/0001_initial.sql` (conteúdo já aplicado?): documentar no journal/README ou absorver no snapshot.
- ⬜ 13.3 Regra no README: migrações manuais só com justificativa explícita (ex.: `CREATE INDEX CONCURRENTLY`).
- ⬜ 13.4 Validar `bun run db:migrate` em banco limpo e em banco existente.
- ⬜ 13.5 Executar validação (Skills → BP2, BP5).

**Status:** ⬜ A fazer — PR/Data: —

---

### P14 — `/health/worker` enganoso + `process.env` fora do `env`

**Arquivos:** `src/http/app.ts`, `src/config/env.ts`, `src/infrastructure/queue/price-worker.ts`

**Objetivo:** readiness real; nenhuma leitura de ambiente fora de `config/env.ts`.

- ⬜ 14.1 Mover `METRICS_TOKEN` para o schema `env` (opcional) e usar `env.METRICS_TOKEN` em `app.ts`.
- ⬜ 14.2 Worker grava heartbeat `SET worker:heartbeat EX 30` após cada lote/loop bem-sucedido.
- ⬜ 14.3 `/health/worker` passa a checar `lastSeen < 60 s` (não apenas ping no Redis).
- ⬜ 14.4 `grep -rn "process.env" src/` deve retornar apenas `src/config/env.ts`.
- ⬜ 14.5 Testes: worker morto ⇒ `/health/worker` 503.
- ⬜ 14.6 Executar validação (Skills → SV1, BP1, BP6).

**Status:** ⬜ A fazer — PR/Data: —

---

## Fase V2 — recursos faltantes do produto

### P7 — Busca, geo, alertas e cesta ausentes

**Arquivos:** `src/domain/*`, `src/application/*`, `src/http/routes/*`, `src/infrastructure/database/schema.ts`

Trabalhar como **quatro itens independentes**, um por vez, cada um como módulo próprio (não estender `PriceRepository`).

#### P7a — Busca de produtos

- ⬜ 7a.1 Migração: extensão `pg_trgm` ou coluna `tsvector` em `products` + índice (GIN/GiST).
- ⬜ 7a.2 Porta `ProductSearch` + use-case `SearchProducts` (módulo `application/search`).
- ⬜ 7a.3 Rota `GET /api/v1/products/search?q=&limit=&cursor=` com schemas Zod/OpenAPI.
- ⬜ 7a.4 Testes unitários + integração (relevância e limite).

#### P7b — Geolocalização de supermercados

- ⬜ 7b.1 Migração: `lat numeric(9,6)`, `lng numeric(9,6)`, coluna geohash + índice em `stores`.
- ⬜ 7b.2 Rota `GET /api/v1/stores/nearby?lat=&lng=&radiusKm=` (b-box/geohash prefix; PostGIS só se houver necessidade real).
- ⬜ 7b.3 Seed com coordenadas realistas; teste de integração.

#### P7c — Alertas de preço

- ⬜ 7c.1 Migração: tabela `alerts` (user, produto, preço-alvo, ativo, canal).
- ⬜ 7c.2 Rota protegida por JWT: CRUD de alertas do usuário (`userId` do token vira autorização real).
- ⬜ 7c.3 Publicar `PriceRecorded` após `record` no worker; avaliação de regras no worker (não no request path).
- ⬜ 7c.4 Testes: alerta dispara ao cruzar alvo; alerta inativo não dispara.

#### P7d — Comparação de cesta

- ⬜ 7d.1 Porta de leitura multi-produto (`compareMany`) mantendo acesso a `current_prices` (sem varrer histórico).
- ⬜ 7d.2 Rota `POST /api/v1/baskets/compare` (lista de produtos + local) com totalização por loja.
- ⬜ 7d.3 Cache por hash do conjunto de produtos + versão (padrão do P2).
- ⬜ 7d.4 Testes unitários (totalização) + integração (ordenar por menor total).

**Status (por sub-item):** P7a ⬜ · P7b ⬜ · P7c ⬜ · P7d ⬜ — PR/Data: —

---

### P9 — Paginação cursor-based ausente

**Arquivos:** `src/application/ports/price-repository.ts`, `price-repository-drizzle.ts`, `src/http/routes/prices.ts`

- ⬜ 9.1 Keyset pagination em `history`: `WHERE (observed_at, id) < (cursor)` `ORDER BY observed_at DESC` (a PK `(observed_at, id)` já dá suporte).
- ⬜ 9.2 Cursor opaco (base64 de `observedAt+id`) no envelope `meta.nextCursor`.
- ⬜ 9.3 Tornar `limit` de `compare` configurável (máx. 100), documentado no OpenAPI.
- ⬜ 9.4 Testes: página 2 não repete nem omite itens; cursor inválido ⇒ 400.
- ⬜ 9.5 Executar validação (Skills → BP1, BP5).

**Status:** ⬜ A fazer — PR/Data: —

---

### P10 — Modelo sem tipo de preço (promo vs regular)

**Arquivos:** `schema.ts`, `price.ts`, migração nova

- ⬜ 10.1 Migração: `price_type varchar(16) NOT NULL DEFAULT 'regular'` com CHECK em `current_prices` e `price_history`.
- ⬜ 10.2 Adicionar `priceType` a `PriceProps`/`Price` (default `regular`).
- ⬜ 10.3 Decisão documentada: qual `price_type` vence no `current_prices` (sugestão: promo não substitui regular na comparação; apenas é registrada no histórico).
- ⬜ 10.4 `unit_measure`/`unit_quantity` em `products` para preço normalizado por unidade.
- ⬜ 10.5 Testes unitário + integração da regra de substituição.
- ⬜ 10.6 Executar validação (Skills → BP2, BP5).

**Status:** ⬜ A fazer — PR/Data: —

---

### P12 — Métricas de domínio e trace nos jobs

**Arquivos:** `src/infrastructure/observability/*`, `src/infrastructure/queue/*`

- ⬜ 12.1 Gauges: `outbox_backlog_events` (se ainda não existir via P1), `price_ingestion_lag_seconds` (idade do evento pendente desde `created_at`), `price_served_age_seconds` (idade dos preços em `compare`).
- ⬜ 12.2 Propagar `traceparent` no payload da outbox e `trace.extract` no worker.
- ⬜ 12.3 Painel Grafana: backlog, lag de ingestão e idade de preços.
- ⬜ 12.4 Alertas Prometheus: backlog crescente por N minutos; lag acima de X.
- ⬜ 12.5 Executar validação (Skills → BP6).

**Status:** ⬜ A fazer — PR/Data: —

---

### P15 — Detalhes menores

- ⬜ 15.1 `main.ts`: injetar a mesma instância de `RedisCache` usada pelas rotas no shutdown (fechar a conexão real).
- ⬜ 15.2 Separar portas de leitura/escrita (`PriceReader` / `PriceWriter`) quando `compareMany` (P7d) entrar.
- ⬜ 15.3 `compare`: dedup por `chain` (ou limite por rede) para evitar uma rede ocupando as 100 ofertas.
- ⬜ 15.4 Remover `userId` do `AppEnv` se P7c não for implementado em 90 dias.
- ⬜ 15.5 DTO de fila explícito (não `PriceProps` como contrato de transporte).
- ⬜ 15.6 Executar validação (Skills → SV1, BP1, BP3, BP5).

**Status:** ⬜ A fazer — PR/Data: —

---

## Fase V3 — escala e maturidade (gatilhos baseados em dados)

| ID   | Item                                                                          | Gatilho sugerido                                      | Status     |
| ---- | ----------------------------------------------------------------------------- | ----------------------------------------------------- | ---------- |
| V3-1 | Particionamento mensal de `price_history`                                     | Tabela > 50–100 M linhas ou janelas de consulta > 1 s | ⬜ A fazer |
| V3-2 | Read replica para leitura (comparação/histórico)                              | CPU de leitura > 60 % sustentado                      | ⬜ A fazer |
| V3-3 | OLAP próprio (materialized views ou ClickHouse) para tendências               | Dashboards consultando histórico bruto                | ⬜ A fazer |
| V3-4 | Matching de produtos multi-fonte (GTIN canônico + resolução fuzzy assíncrona) | Catálogo > 100k produtos multi-fonte                  | ⬜ A fazer |
| V3-5 | JWT assimétrico (RS256) com rotação e refresh revogável                       | Multi-cliente / app mobile                            | ⬜ A fazer |
| V3-6 | Separação em serviços (ingestão vs consulta vs alertas)                       | Apenas com evidência de gargalo operacional           | ⬜ A fazer |
| V3-7 | Multi-região/tenant                                                           | Demanda de expansão geográfica confirmada             | ⬜ A fazer |

---

## Skills de validação

Checklists obrigatórios antes de marcar qualquer item como `✅ Concluído`. Rode os comandos indicados.

### SV1 — Segurança geral (obrigatório em todo item que toca HTTP, auth, filas ou dados)

- ⬜ Nenhum `process.env` fora de `src/config/env.ts` → `grep -rn "process.env" src/` retorna só `env.ts`.
- ⬜ Nenhum segredo, hash, token ou stack trace em respostas/logs → revisar o diff e `grep -rn "Authorization\|passwordHash\|JWT_SECRET" src/` (apenas fluxos internos legítimos).
- ⬜ Entradas de novas rotas têm schema Zod (params, query, headers, body) e resposta OpenAPI.
- ⬜ Novo endpoint privado usa o middleware `requireAuth`; nenhum registro de `Authorization` em log.
- ⬜ SQL: nenhum concat de string do usuário; parâmetros via Drizzle (checar interpolations).
- ⬜ Labels Prometheus sem IDs de produto/loja/usuário (cardinalidade).
- ⬜ Erros de terceiros traduzidos para envelope `{ error: { code, message } }` — sem vazamento de detalhes internos.

### SV2 — Segurança de autenticação (itens P6, P11, P14, V3-5)

- ⬜ Rate limit aplicado nas rotas de login/registro; `429` com `Retry-After`.
- ⬜ Falha de login genérica (`INVALID_CREDENTIALS`) — sem revelar se o e-mail existe.
- ⬜ Senha entre 12 e 128 chars; hash scrypt; comparação em tempo constante (`timingSafeEqual`).
- ⬜ JWT valida `issuer`, `audience` e algoritmo (`algorithms: ['HS256']`); sem `none`/fallback.
- ⬜ Registro não aceita `userId`/campos de privilégio do cliente.

### SV3 — Validação de dependências e APIs preteridas

Rode a cada item; remova o uso de APIs deprecadas antes de completar.

- ⬜ `bun outdated` sem dependências principais defasadas em minor crítico; registrar exceções com justificativa.
- ⬜ Deprecações conhecidas auditadas:
  - BullMQ: conferir changelog da major usada; APIs como `Queue.prototype.add` e opções de `removeOnComplete/removeOnFail` vigentes.
  - Drizzle ORM/Kit: conferir release notes; `setWhere` em `onConflictDoUpdate` requer versão ≥ 0.36 — confirmar suporte contínuo.
  - `postgres` (postgres.js): parâmetros de pool (`max`, `idle_timeout`, `connect_timeout`) vigentes na major.
  - ioredis: `maxRetriesPerRequest: null` obrigatório para conexão do BullMQ; confirmar na doc atual.
  - OpenTelemetry JS: API `resourceFromAttributes`/`NodeSDK` vigentes na versão (não usar `Resource` deprecado).
  - Bun: `Bun.serve`/`Bun.sleep` vigentes; conferir `Bun outdated` e changelog de runtime.
- ⬜ Nenhum `@deprecated` importado → `grep -rn "@deprecated" node_modules/...` sob demanda ou revisão no diff.
- ⬜ `bun.lock` atualizado e commitado junto da mudança de dependência.

### BP1 — Código e TypeScript

- ⬜ `bun run typecheck` sem erro (strict, sem `any`, sem `@ts-ignore`, casts justificados no diff).
- ⬜ `bun run lint` sem warnings (`--max-warnings 0`).
- ⬜ `bun run format:check` passando (Prettier).
- ⬜ `import type` para imports só-de-tipo; imports locais com extensão `.ts`.
- ⬜ Direção de dependências respeitada: HTTP → aplicação → domínio; domínio sem Hono/Drizzle/Redis/BullMQ/Pino/env.
- ⬜ Nenhuma regra de negócio nova na rota HTTP ou no adaptador.

### BP2 — Dados e migrações

- ⬜ `schema.ts` é a única fonte de DDL; `bun run db:generate` seguido de **revisão manual** do SQL e do journal.
- ⬜ Migração existente nunca reescrita; correção sempre em migração nova.
- ⬜ `current_prices` atualizado atomicamente com `price_history` (mesma transação); `setWhere` preserva regra de observação mais recente.
- ⬜ `price_history` append-only; CHECK de preço positivo mantido.
- ⬜ Consulta nova não varre o histórico inteiro; usa `current_prices`/índices e limites.
- ⬜ `RUN_INTEGRATION=1 bun run test:integration` executado (ou justificar ausência de PostgreSQL).

### BP3 — SOLID / Clean Architecture

- ⬜ Caso de uso depende de porta (`application/ports`), não de adaptador concreto.
- ⬜ Nenhum novo singleton global além dos existentes (`db`, conexões Redis); prefira injeção na composição.
- ⬜ Sem nova abstração sem uso concreto (nada de factory/evento genérico sem chamador).
- ⬜ Porta não engordou além do necessário (ISP); se cresceu, considerar split leitura/escrita.

### BP4 — Cache e filas

- ⬜ Nenhum `SCAN`/`KEYS` no caminho quente (ingestão ou request path).
- ⬜ Cache: chave versionada, TTL explícito, invalidação O(1) ou por chave exata.
- ⬜ Redis de cache ≠ Redis de fila; nenhuma mistura de conexões.
- ⬜ Jobs idempotentes; entrega at-least-once considerada; mudança incompatível de payload versiona o job/evento.
- ⬜ Falha de cache/queue não derruba request (best-effort) nem silencia erro (sempre log/contabilize).

### BP5 — Testes e entrega

- ⬜ Regra nova tem teste unitário; SQL novo tem teste de integração; contrato/middleware novo tem E2E.
- ⬜ `bun run test` verde (unitários + E2E em memória).
- ⬜ Testes determinísticos, sem ordem global/rede externa; fixtures de teste limpas (`afterAll`).
- ⬜ Nenhum teste de integração alegado sem PostgreSQL disponível (declarar como pulado).
- ⬜ Commit em Conventional Commits (ex.: `fix(queue): unblock outbox head-of-line`); hooks Husky não desativados.
- ⬜ `docker compose config --quiet` se o Compose foi alterado.

### BP6 — Observabilidade

- ⬜ Nova rota/caminho emite log `http_request` com `requestId`; erros logados com `err` sem segredos.
- ⬜ Métricas novas de baixa cardinalidade (sem IDs).
- ⬜ Mudança em worker/dispatcher emite sinal de progresso/falha (log estruturado + métrica).
- ⬜ Traces: spans novos encerrados em `finally`; exceções registradas no span.

---

### Registro de execução

| Data       | Item | PR/Branch                          | Resultado da validação                                                                                                                                                                                                                                                                              |
| ---------- | ---- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13/11/2026 | P1   | `fix/outbox-head-of-line`          | SV1: sem segredos/labels com ID no diff; desvio pré-existente de `process.env` em `src/http/app.ts` (`METRICS_TOKEN`) é escopo do P14. BP1: `typecheck`, `lint`, `format:check` verdes. BP5: `bun run test` 19/19; integração com PostgreSQL 5/5 (inclui `tests/integration/outbox-store.test.ts`). |
| 13/11/2026 | P2   | `fix/cache-versioned-invalidation` | SV1: sem segredos/labels com ID no diff. BP1: `typecheck`, `lint`, `format:check` verdes. BP4: removido `SCAN`/`deleteByPrefix`, invalidação O(1) por versão de produto e TTLs preservados. BP5: `bun run test` 20/20 (unitários + E2E); sem alteração SQL.                                         |
| 13/11/2026 | P3   | `fix/price-freshness-window`       | Concluído: SV1 sem segredos/labels de alta cardinalidade; BP1 `typecheck`, `lint`, `format:check` verdes; BP2 integração PostgreSQL 6/6 (`prices.test.ts` inclui filtro de frescor); BP5 `bun run test` 24/24. PostgreSQL de teste descartável parado após a validação.                             |
| 13/11/2026 | P4   | `fix/ingestion-dlq-feedback`       | Concluído: SV1 sem dados sensíveis/labels de alta cardinalidade; BP1 `typecheck`, `lint`, `format:check` verdes; BP2 migração revisada e integração PostgreSQL 8/8 (inclui FK real); BP5 `bun run test` 33/33. Falhas permanentes vão para `dead`; falhas transitórias preservam retry.             |
| 13/11/2026 | P6   | `feat/redis-rate-limiting`         | SV1/SV2 sem IPs ou user IDs em labels/logs; BP1 e BP5 válidos; 29/29 testes. E2E cobre 429, `Retry-After`, identidade e fail-open; Redis Lua e indisponibilidade validados.                                                                                                                         |
