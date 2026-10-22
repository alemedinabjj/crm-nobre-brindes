# CRM Nobre Brindes

Primeira versão do CRM interno do time comercial da Nobre Brindes: um funil Kanban para acompanhar oportunidades B2B, mover negociações entre etapas com regras validadas no backend e enxergar, logo ao abrir a tela, o que precisa ser trabalhado hoje.

| Camada | Stack |
| --- | --- |
| Front | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, TanStack Query, dnd-kit |
| API | Node.js, NestJS 12, Drizzle ORM, Zod |
| Banco | PostgreSQL 16 |
| Testes | Vitest (unidade e e2e com Supertest contra Postgres real), Testing Library |

## Como rodar

### Com Docker (recomendado)

```bash
docker compose up --build
```

- Front: http://localhost:3000
- API: http://localhost:3001 (`/health`, `/meta`, `/opportunities`)

A API aplica as migrations e carrega os dados do case na subida. A data de referência fica fixada em **15/10/2026** (`REFERENCE_DATE`), para que os alertas batam com o enunciado. Para usar a data real: `REFERENCE_DATE= docker compose up --build`.

### Sem Docker

Requisitos: Node 22.22+ (recomendado 24) e um Postgres 16 acessível.

```bash
# API
cd api
cp .env.example .env          # ajuste DATABASE_URL se precisar
npm install
npm run db:reset              # migrations + carga do case
npm run start:dev

# Front (outro terminal)
cd web
cp .env.example .env.local
npm install
npm run dev
```

### Testes

```bash
cd api && npm test            # regras de domínio (unidade)
cd api && npm run test:e2e    # API real contra o banco crm_nobre_test
cd web && npm test            # componentes e utilitários do front
```

Os testes e2e esperam um banco `crm_nobre_test` (configurável por `TEST_DATABASE_URL`) e recriam os dados a cada teste.

## Estrutura

```
api/
  src/domain/          regras puras: etapas, transições, atenção (sem framework)
  src/database/        schema Drizzle, migrations, seed
  src/opportunities/   controller, service, validação de entrada, apresentação
  test/                e2e com a aplicação real
web/
  src/components/      quadro, card, coluna, detalhe, diálogo de motivo
  src/hooks/           queries/mutations e filtros na URL
  src/lib/             cliente da API, formatação, etapas
```

## Decisões de produto e UX

**A pergunta que a tela responde é "em qual negociação eu mexo hoje?".** Por isso:

- **Fila "Para trabalhar hoje" no topo**, já ordenada por urgência, com o motivo em uma linha ("Proposta vencida há 2 dias"). Um clique abre a negociação.
- **Dentro de cada coluna, os cards vêm por urgência**, não por data de criação.
- **Cada card mostra o porquê do alerta**, não só uma cor. Os sinais aparecem como texto + ícone (acessível a daltônicos), e os chips de prazo (último contato, validade da proposta, evento) ficam vermelhos ou amarelos conforme o risco.
- **Arrastar já mostra o que é permitido**: as colunas válidas ficam destacadas e as proibidas aparecem apagadas, com "Movimento não permitido". Soltar numa coluna proibida explica o motivo e lista os destinos possíveis.
- **Retorno de etapa e perda pedem motivo num diálogo**, com sugestões frequentes para perda. Avanços não pedem nada, para não travar o fluxo.
- **O card muda de coluna na hora** (atualização otimista). Se o backend recusar, volta para a coluna anterior e mostra o motivo com um atalho "Abrir oportunidade para completar".
- **Filtros na URL** (busca, vendedor, atenção): dá para favoritar "minhas negociações em atenção" ou mandar o link de uma visão.
- **Estados explícitos**: esqueleto ao carregar, erro com "Tentar de novo", vazio diferenciando "nenhum resultado para o filtro" de "nenhuma oportunidade".
- **Acessibilidade**: o arraste é por mouse e toque; pelo teclado, o detalhe tem os botões "Avançar para", "Voltar para" e "Marcar como perdida", com o mesmo fluxo e as mesmas regras.

**Identidade visual**: paleta e tipografia extraídas do site oficial nobrebrindes.com.br. As cores são o verde floresta `#247042`, o floresta profundo `#174f2d`, o musgo `#ddf8e8`, o papel `#f8fdfa` e o verde vivo `#62e590` da faixa do cabeçalho. Os títulos usam Archivo e o corpo usa Poppins. As cores de alerta (vermelho e âmbar) ficam fora da família verde de propósito, para saltar aos olhos. Todos os valores estão em tokens em `web/src/app/globals.css`. A marca no cabeçalho é texto: o logotipo oficial em SVG pode ser colocado no lugar.

## Regras do funil

Etapas: Primeiro Contato → Apresentação de Orçamento → Follow-up → Forecast → Fechamento, além de Perdida. Fechamento e Perdida são finais.

### Regras dadas pelo case

- Só avança para **Apresentação de Orçamento** com valor estimado (> 0) e pelo menos um item de brinde.
- Só entra em **Fechamento** a partir de **Forecast**.
- **Perdida** vale a partir de qualquer etapa não final e exige motivo.

### Decisões próprias

| Decisão | Por quê |
| --- | --- |
| Avanço só para a etapa seguinte (sem pular) | Pular etapas esconde trabalho não feito e distorce a conversão por etapa. |
| Para entrar em Follow-up, a proposta precisa ter validade | Não existe follow-up de proposta sem prazo; o prazo alimenta os alertas. |
| Retornos permitidos: Follow-up → Orçamento, Forecast → Orçamento, Forecast → Follow-up | Representam situações reais: o cliente pede revisão de quantidade ou preço, ou a compra prevista esfria e volta a ser cobrada. |
| Retorno exige justificativa | O histórico conta a história da negociação para quem assumir depois. |
| Nunca volta para Primeiro Contato | Depois de uma proposta, o contato já aconteceu; recomeçar o funil apaga a história. |
| Estados finais não têm saída | Reabrir uma venda perdida é uma nova oportunidade; isso mantém as métricas de ganho e perda honestas. |
| Invariantes cumulativas | Estar em Follow-up exige tudo o que Orçamento exige. A mesma checagem vale na transição, na edição (não dá para remover itens de quem já tem proposta) e na carga inicial. |
| Oportunidades em estado final são somente leitura | Editar valor de venda fechada distorce o relatório. |
| Contato não pode ser registrado no futuro, e um contato antigo não "volta no tempo" o último contato | Os dois casos mascarariam um lead esquecido. |

### Onde as regras vivem

1. **`api/src/domain`**: TypeScript puro, sem dependência de Nest ou do banco, com cobertura completa de testes. É a fonte da verdade.
2. **API**: toda mudança de etapa passa por `POST /opportunities/:id/stage-transitions`. A operação trava a linha (`SELECT … FOR UPDATE`), valida no domínio e grava o histórico na mesma transação. Há um teste e2e que dispara dois movimentos simultâneos no mesmo card: só um vence e o histórico não duplica. A etapa não muda por `PATCH`.
3. **Banco**: as invariantes críticas também viram CHECK constraints (Perdida com motivo, valor positivo, valor obrigatório a partir de Orçamento, quantidade > 0), como defesa caso algum script ou serviço futuro contorne a API.
4. **Front**: usa `allowedTransitions`, que vem da API, só para orientar a interação. Ele nunca decide sozinho.

### "Precisa de atenção"

Três sinais independentes, calculados na API a partir da data de hoje no fuso de São Paulo:

| Sinal | Alerta | Urgente |
| --- | --- | --- |
| Dias sem contato | acima do SLA da etapa (Primeiro Contato 1, Orçamento 3, Follow-up 3, Forecast 2 dias) | acima do dobro do SLA, ou nenhum contato registrado |
| Proposta | vence em até 3 dias | vencida |
| Evento do cliente | em até 14 dias | em até 7 dias (prazo de produção em risco) ou já passou |

Em 15/10/2026 isso aponta, por ordem de urgência, a OPP-2002, a OPP-2004 e a OPP-2003. Os limites estão em `DEFAULT_ATTENTION_POLICY`, num só lugar, para o comercial calibrar.

### Dados do case e campos em branco

- **OPP-2001** tem só duas datas. Interpretei a validade da proposta como vazia, porque em Primeiro Contato ainda não há proposta.
- **OPP-2007** está Perdida sem motivo, o que viola a regra. Em vez de inventar um motivo, a carga registra "Não informado na planilha de origem (registro importado)", e o registro fica auditável.
- **OPP-2006** está em Fechamento sem histórico de ter passado por Forecast. A carga cria um único registro de histórico, "Carga inicial: etapa importada", em vez de fabricar uma trajetória.
- A carga passa pelas mesmas invariantes da API: um dado inválido faz a carga falhar com uma mensagem clara.

## API

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/opportunities?search=&stage=&seller=&attention=` | Lista com atenção calculada, ordenada por urgência. `stage` aceita lista separada por vírgula; `attention` aceita `any`, `critical` ou `warning`. |
| GET | `/opportunities/:id` | Detalhe com itens, histórico e destinos permitidos |
| POST | `/opportunities` | Cria em Primeiro Contato, com código OPP sequencial |
| PATCH | `/opportunities/:id` | Edita dados (não a etapa); `items` substitui a lista |
| POST | `/opportunities/:id/stage-transitions` | `{ to, reason?, changedBy? }` |
| POST | `/opportunities/:id/contacts` | Registra contato (padrão: hoje) |
| GET | `/meta` | Etapas, transições, data de referência, vendedores |
| GET | `/health` | Checagem do banco |

**Erros** seguem um formato único: `{ error, message, violations?, fields? }`.

- **400**: entrada inválida, com a lista de `fields`.
- **422**: regra de negócio, com **todas** as `violations` de uma vez, para a tela mostrar o que falta.
- **404**: oportunidade não encontrada.
- **401**: API key ausente ou inválida.

## Segurança

- **Credenciais**: nenhuma no código. A configuração vem do ambiente, validada com Zod na subida, e só há `.env.example` no repositório.
- **Entrada**: toda entrada passa por validação estrita, que rejeita campos desconhecidos (não dá para mudar a etapa por PATCH). A busca escapa os curingas do `LIKE`. O SQL é sempre parametrizado.
- **API key opcional (`API_KEY`)**: quando definida, exige o header `x-api-key`, comparado em tempo constante. O `/health` fica público para o orquestrador.

**Em produção**, eu protegeria a API assim:

- **Autenticação**: SSO do Google Workspace ou Microsoft com JWT validado na API (OIDC).
- **Autorização**: papéis por vendedor e gestor. O vendedor edita as próprias oportunidades; o gestor vê o time. O `changedBy` do histórico passaria a vir do token, não do corpo da requisição.
- **Rede e borda**: TLS, CORS restrito ao domínio do CRM, rate limiting por usuário e IP, e API atrás de WAF.
- **Segredos e banco**: segredos em cofre (AWS Secrets Manager ou similar). O banco fica em rede privada, com usuário de aplicação sem permissão de DDL.
- **Observabilidade**: logs estruturados sem dados pessoais e alertas de erro (Sentry).

## Limitações conhecidas

- A atenção é calculada na aplicação a cada listagem. Isso é simples e correto para o volume de um time comercial; com milhares de oportunidades, o caminho seria materializar o score ou calcular em SQL e paginar as colunas finais.
- Vendedor é texto livre, sem tabela de usuários, porque não há autenticação nesta versão.
- O front tem os tipos da API escritos à mão. O próximo passo seria gerá-los de um OpenAPI exportado pelo Nest.
- Criar e editar oportunidades existe na API, mas ainda não tem tela. O foco da UI foi o funil e o trabalho diário.
