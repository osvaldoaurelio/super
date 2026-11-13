# AGENTS.md — instruções para agentes de código

## Objetivo e idioma

Este repositório contém uma API REST modular para comparação de preços de supermercados. Mantenha documentação e comunicação voltadas ao usuário em português. Preserve nomes de código em inglês, seguindo o padrão existente.

## Stack técnica

- **Runtime e gerenciador:** Bun 1.3.14 (`packageManager` em `package.json`; `bun.lock`).
- **Linguagem:** TypeScript 5, modo `strict`, ESM e imports locais com extensão `.ts`.
- **HTTP/API:** Hono, `@hono/zod-openapi`, Zod 4 e Swagger UI.
- **Persistência:** PostgreSQL, Drizzle ORM/Drizzle Kit e driver `postgres`.
- **Cache:** Redis com `ioredis`.
- **Processamento assíncrono:** BullMQ em Redis separado do cache; ingestão aceita por outbox transacional no PostgreSQL.
- **Autenticação:** JWT HS256 com `jose`; hashing de senha scrypt.
- **Observabilidade:** Pino, OpenTelemetry (OTLP HTTP) e `prom-client`/Prometheus; Grafana provisionado em `monitoring/`.
- **Qualidade:** Vitest, ESLint flat config, Prettier, Husky e Commitlint/Conventional Commits.
- **Infra/CI:** Docker, Docker Compose e GitHub Actions.

## Comandos do projeto

Instale e execute com Bun 1.3.14. Na raiz:

```sh
bun install
bun run dev                 # API com reload
bun run start               # API
bun run worker              # processo de ingestão/outbox
bun run db:migrate          # aplica migrações Drizzle existentes
bun run db:generate         # gera migração; sempre revise o SQL e o journal
bun run db:seed             # dados de desenvolvimento
bun run typecheck           # tsc --noEmit
bun run lint                # ESLint sem warnings
bun run format              # aplica Prettier
bun run format:check        # valida formatação
bun run test                # testes unitários e E2E em memória
bun run test:integration    # Vitest; precisa PostgreSQL acessível
bun run test:e2e            # suíte E2E isolada
bun run test:coverage       # cobertura dos testes unitários
```

Não há script isolado para testes unitários: `bun run test` executa unitários e E2E.

Ambiente local com Docker Compose:

```sh
cp .env.example .env
# Antes de iniciar, troque JWT_SECRET e senhas padrão de desenvolvimento.
docker compose up --build
```

O Compose inicia API, worker, migração única, PostgreSQL, Redis de cache, Redis da fila, Prometheus, Grafana e OpenTelemetry Collector. Serviços de dados ficam na rede interna; a API/observabilidade ficam limitadas a localhost. Para validar a configuração sem iniciar containers: `docker compose config --quiet`.

Para testes de integração fora do Compose, inicie um PostgreSQL compatível e forneça `DATABASE_URL` apontando para ele; defina `RUN_INTEGRATION=1`. A suíte executa as migrações registradas em `drizzle/`. O teste E2E padrão usa `app.request`, sem depender de banco ou Redis.

## Estrutura do código

```text
src/
├── config/                         # Variáveis de ambiente validadas com Zod
├── domain/
│   ├── errors.ts                   # Erros de domínio
│   └── prices/                     # Entidade e invariantes de Price
├── application/
│   ├── ports/                      # Contratos para repositório, cache e fila
│   └── use-cases/                  # Comparar, consultar histórico, submeter preço
├── http/
│   ├── middleware/                 # Autorização JWT
│   ├── routes/                     # Rotas Hono, schemas Zod/OpenAPI
│   └── types.ts                    # Tipos compartilhados do contexto HTTP
├── infrastructure/
│   ├── auth/                       # JWT e hash/verificação de senha
│   ├── cache/                      # Adaptador Redis
│   ├── database/                   # Schema Drizzle, cliente, migração, repositório
│   ├── observability/              # Pino, tracing OTel e métricas Prometheus
│   └── queue/                      # BullMQ, worker e dispatcher da outbox
├── main.ts                         # Composição e servidor HTTP Bun
└── worker.ts                       # Processo de fila/outbox

drizzle/                            # Migrações SQL e metadados Drizzle
monitoring/                         # Configuração Prometheus, Grafana e OTel
tests/
├── unit/                            # Testes de domínio/casos de uso/adaptadores puros
├── integration/                     # Testes que usam PostgreSQL real
├── e2e/                             # Testes da aplicação HTTP Hono
└── support/                         # Auxiliares de integração
```

README.md contém os contratos REST, diagrama de módulos, decisões de arquitetura, modelo de dados e roadmap.

## Convenções de código (coding conventions)

### Arquitetura e dependências

1. Preserve o monólito modular e a direção das dependências: **HTTP → aplicação → domínio**. Infraestrutura implementa portas da aplicação; domínio não importa Hono, Drizzle, Redis, BullMQ, Pino ou variáveis de ambiente.
2. Mantenha regras de negócio no domínio/casos de uso. Rotas HTTP cuidam de protocolo, autenticação, validação de entrada e apresentação da resposta; adaptadores cuidam de I/O.
3. Prefira interfaces pequenas em `application/ports` e injeção de dependências na composição HTTP/worker. Use doubles nos testes unitários em vez de acoplar casos de uso a serviços externos.
4. Aplique DDD leve: adicione value objects/entidades/agregados apenas quando encapsularem invariantes reais. Evite camadas, factories, eventos genéricos e abstrações sem uso concreto.
5. Não faça consultas ao histórico inteiro para comparação: use `current_prices`, índices e limites. Valores monetários são inteiros em centavos.

### TypeScript e estilo

- Mantenha `strict`, `noUncheckedIndexedAccess` e `exactOptionalPropertyTypes`; não enfraqueça `tsconfig.json` para contornar erros.
- Não introduza `any`, casts sem justificativa, `@ts-ignore` ou tipos implícitos. Prefira `unknown` e narrowing.
- Use `import type` para imports usados só como tipos. Imports internos devem manter a extensão `.ts` e respeitar ESM/Bun.
- Acesse variáveis ambientais por `env` de `src/config/env.ts`; não espalhe `process.env` fora de configuração/integrações que precisem explicitamente do ambiente.
- Formate com Prettier e mantenha ESLint sem warnings. Não edite código gerado por ferramentas à mão, salvo correção explícita dos metadados exigidos.

### HTTP, validação e segurança

- Endpoints novos devem ter schemas Zod para parâmetros, query, headers e body, e respostas descritas com OpenAPI.
- Preserve o prefixo `/api/v1`, envelopes/erros JSON consistentes e status HTTP semântico. Não exponha stack traces, hashes, tokens ou segredos nas respostas/logs.
- Rotas privadas usam o middleware JWT existente. Nunca registre o header `Authorization`, senha, hash ou segredo.
- Senhas e segredos não entram no repositório. `.env` é local e ignorado; `.env.example` contém apenas valores demonstrativos.
- Tenha cuidado para não incluir identificadores de produto/loja como labels Prometheus (cardinalidade alta).

### Dados, cache e filas

- Atualize `src/infrastructure/database/schema.ts` e gere uma migração com `bun run db:generate`; revise o SQL gerado, metadados e journal antes de finalizar.
- Migrações aplicadas são imutáveis: crie uma nova migração corretiva em vez de reescrever uma migração já utilizada. Migração de produção é etapa única via serviço Compose `migrate`, não responsabilidade de cada réplica HTTP.
- Repositórios convertem modelo persistido para tipos da aplicação. Mantenha observações de `price_history` append-only e atualize `current_prices` atomicamente.
- Cache é otimização best-effort, com chave versionada, TTL explícito e invalidação após gravação. Não use o Redis de cache para BullMQ nem o Redis de fila como cache evictable.
- A fila é at-least-once: preserve idempotência e considere retries/replay ao mudar workers ou payloads. Alterações incompatíveis devem versionar o job/evento.

### Testes e entrega

- Cada regra nova deve ter teste unitário; query/SQL/integração com driver real pertence à suíte de integração; contrato e middleware HTTP devem ter cobertura E2E.
- Não alegue que testes de integração passaram se foram pulados ou executados sem PostgreSQL. Informe dependências externas indisponíveis.
- Antes de concluir uma mudança, execute, conforme aplicável:

```sh
bun run typecheck
bun run lint
bun run format:check
bun run test
# Se houver PostgreSQL disponível:
RUN_INTEGRATION=1 bun run test:integration
# Validar Compose quando alterado:
docker compose config --quiet
```

- Testes devem ser determinísticos, sem depender da ordem global, rede externa ou serviços não declarados. Limpe fixtures criadas em bancos de teste.
- Use Conventional Commits (ex.: `feat(prices): add regional comparison`, `fix(queue): retry outbox dispatch`, `test(auth): cover expired JWT`). Hooks Husky executam qualidade local; não desative hooks para esconder falhas.
- Mantenha alterações proporcionais ao pedido. Não adicione dependências ou arquivos auxiliares sem necessidade.
