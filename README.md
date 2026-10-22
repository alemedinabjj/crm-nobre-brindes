# CRM Nobre Brindes

CRM interno para o time comercial da **Nobre Brindes**: um funil Kanban de oportunidades B2B com regras de etapa validadas no backend, uma fila do que precisa de atenção hoje, uma automação diária de retornos e um **assistente de IA** que consulta o CRM ao vivo e uma base de conhecimento (RAG), com ferramentas, guardrails e evals.

**Demo:** [crm-nobre-brindes.vercel.app](https://crm-nobre-brindes.vercel.app) · **API:** [crm-nobre-brindes-api.onrender.com](https://crm-nobre-brindes-api.onrender.com/health)
<sub>A API roda no plano gratuito do Render, que hiberna sem tráfego: a primeira requisição pode levar até 1 minuto. Os dados usam a data de referência do case, 15/10/2026.</sub>

![Quadro do funil com a fila "Para trabalhar hoje"](docs/images/01-quadro.png)

## Sumário

- [Stack e arquitetura](#stack-e-arquitetura)
- [Como rodar](#como-rodar)
- [1. Produto e UX](#1-produto-e-ux)
- [2. Engenharia: regras e consistência](#2-engenharia-regras-e-consistência)
- [3. Automação: retornos de follow-up](#3-automação-retornos-de-follow-up)
- [Os outros três problemas](#os-outros-três-problemas)
- [Assistente comercial com IA](#assistente-comercial-com-ia)
- [Qualidade: testes, CI e evals](#qualidade-testes-ci-e-evals)
- [API](#api)
- [Deploy](#deploy)
- [Segurança](#segurança)
- [Limitações e próximos passos](#limitações-e-próximos-passos)
- [Uso de IA no desenvolvimento](#uso-de-ia-no-desenvolvimento)

## Stack e arquitetura

| Camada | Tecnologia |
| --- | --- |
| Front | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, TanStack Query, dnd-kit |
| API | Node.js 24, NestJS 12, Drizzle ORM, Zod, `@nestjs/schedule` |
| Banco | PostgreSQL 16/17 com pgvector e `unaccent` |
| IA | Gemini (chat com function calling e embeddings), atrás de uma interface própria |
| Testes | Vitest, Supertest (e2e contra Postgres real), Testing Library |
| Infra | Vercel (front e cron), Render (API em Docker), Neon (Postgres), GitHub Actions |

```mermaid
flowchart LR
  subgraph Vercel
    W[Next.js<br/>quadro, retornos, assistente]
    C[Cron diário<br/>/api/cron/follow-ups]
  end
  subgraph Render
    A[API NestJS]
    D[domínio puro<br/>etapas, atenção, follow-up]
    AG[agente de IA<br/>ferramentas + guardrails]
    S[agenda interna<br/>+ recuperação ao subir]
  end
  N[(Neon Postgres<br/>pgvector + full-text)]
  G[Gemini<br/>chat + embeddings]

  W -- REST --> A
  C -- segredo --> A
  A --- D
  A --- AG
  S --> A
  A --> N
  AG --> G
```

```
api/
  src/domain/       regras puras: etapas, transições, atenção, planejador de follow-up
  src/opportunities/ funil: controller, service (transações e locks), validação, apresentação
  src/follow-ups/   automação: serviço idempotente, agenda, endpoints
  src/assistant/    IA: knowledge (chunking, RAG), llm (Gemini + falso), tools, guardrails, agente
  src/database/     schema Drizzle, migrations, seed
  knowledge/        base de conhecimento em Markdown (fictícia)
  evals/            dataset, runner e metas de qualidade do assistente
  test/             e2e com a aplicação real
web/
  src/components/   quadro, card, coluna, detalhe, retornos, assistente
  src/hooks/        queries, mutations otimistas, filtros na URL
```

## Como rodar

### Com Docker (recomendado)

```bash
docker compose up --build
# opcional, para ligar o assistente:
GEMINI_API_KEY=sua-chave docker compose up --build
```

- Front: http://localhost:3000
- API: http://localhost:3001 (`/health`, `/meta`, `/opportunities`, `/assistant/status`)

A API aplica as migrations, carrega os dados do case (só com o banco vazio), sincroniza a base de conhecimento e roda a automação do dia. A data de referência fica fixada em **15/10/2026** (`REFERENCE_DATE`) para os alertas baterem com o enunciado. Sem `GEMINI_API_KEY`, todo o CRM funciona e o assistente aparece como desligado.

### Sem Docker

Requisitos: Node 22.22+ (recomendado 24) e Postgres 16+ com as extensões `vector` e `unaccent`.

```bash
cd api && cp .env.example .env && npm install
npm run db:reset          # migrations + carga do case
npm run kb:sync           # base de conhecimento (com embeddings se houver GEMINI_API_KEY)
npm run start:dev

cd web && cp .env.example .env.local && npm install && npm run dev
```

### Testes e evals

```bash
cd api && npm test                 # domínio, guardrails, chunker, planejador (unidade)
cd api && npm run test:e2e         # API real contra o banco crm_nobre_test
cd api && npm run eval:offline     # qualidade da busca sem IA (banco local)
cd api && npm run eval -- --judge  # assistente completo contra a API (requer GEMINI_API_KEY)
cd web && npm test                 # componentes e utilitários
```

---

## 1. Produto e UX

**A pergunta que a tela responde é "em qual negociação eu mexo hoje?".**

- **Fila "Para trabalhar hoje" no topo**, ordenada por urgência, com o motivo em uma linha ("Proposta vencida há 2 dias"). Um clique abre a negociação.
- **Dentro de cada coluna, os cards vêm por urgência**, não por data de criação.
- **Cada card diz o porquê do alerta.** Os sinais aparecem como texto + ícone (acessível a daltônicos), e os chips de prazo (último contato, validade da proposta, evento) ficam vermelhos ou âmbar conforme o risco.
- **Arrastar já mostra o que é permitido:** as colunas válidas ficam destacadas e as proibidas, apagadas. Soltar numa proibida explica o motivo e lista os destinos possíveis.
- **Retorno de etapa e perda pedem motivo**, com sugestões frequentes para perda. Avanços não pedem nada, para não travar o fluxo.
- **O card muda de coluna na hora** (atualização otimista). Se o backend recusar, volta e mostra o motivo, com o atalho "Abrir oportunidade para completar".
- **Filtros na URL** (busca, vendedor, atenção): dá para favoritar "minhas negociações em atenção" ou mandar o link de uma visão.
- **Estados explícitos**: esqueleto ao carregar, erro com "Tentar de novo", vazio que diferencia "nenhum resultado" de "nenhuma oportunidade".
- **Acessibilidade**: o arraste é por mouse e toque; pelo teclado, o detalhe tem "Avançar para", "Voltar para" e "Marcar como perdida", com as mesmas regras.

| Arrastar mostra os destinos válidos | Perda pede motivo |
| --- | --- |
| ![Arrastando um card](docs/images/02-arrastar.png) | ![Diálogo de perda](docs/images/03-perda.png) |
| **Detalhe com alertas, ações e histórico** | **Fila de retornos da automação** |
| ![Detalhe da oportunidade](docs/images/04-detalhe.png) | ![Retornos do time](docs/images/05-retornos.png) |

<img src="docs/images/06-celular.png" alt="Quadro no celular" width="260" align="right" />

**Identidade visual.** A paleta e a tipografia foram extraídas do site oficial nobrebrindes.com.br:

- **Cores:** verde floresta `#247042`, floresta profundo `#174f2d`, musgo `#ddf8e8`, papel `#f8fdfa` e o verde vivo `#62e590` da faixa do cabeçalho.
- **Fontes:** Archivo nos títulos e Poppins no corpo.
- **Alertas:** vermelho e âmbar ficam de propósito fora da família verde, para saltar aos olhos.

Os tokens estão em `web/src/app/globals.css`. No celular, o quadro rola coluna por coluna, com encaixe.

<br clear="right" />

---

## 2. Engenharia: regras e consistência

Etapas: Primeiro Contato → Apresentação de Orçamento → Follow-up → Forecast → Fechamento, além de Perdida. Fechamento e Perdida são finais.

### Regras dadas pelo case

- Só avança para **Apresentação de Orçamento** com valor estimado (> 0) e pelo menos um item de brinde.
- Só entra em **Fechamento** a partir de **Forecast**.
- **Perdida** vale a partir de qualquer etapa não final e exige motivo.

### Decisões próprias

| Decisão | Por quê |
| --- | --- |
| Avanço só para a etapa seguinte (sem pular) | Pular etapas esconde trabalho não feito e distorce a conversão por etapa. |
| Para entrar em Follow-up, a proposta precisa ter validade | Não existe follow-up de proposta sem prazo, e esse prazo alimenta os alertas. |
| Retornos permitidos: Follow-up → Orçamento, Forecast → Orçamento, Forecast → Follow-up | Situações reais: o cliente pede revisão de quantidade ou preço, ou a compra prevista esfria e volta a ser cobrada. |
| Retorno exige justificativa | O histórico conta a história da negociação para quem assumir depois. |
| Nunca volta para Primeiro Contato | Depois de uma proposta, o contato já aconteceu; recomeçar o funil apaga a história. |
| Estados finais não têm saída nem edição | Reabrir uma venda perdida é uma nova oportunidade; isso mantém honestas as métricas de ganho e perda. |
| Invariantes cumulativas | Estar em Follow-up exige tudo o que Orçamento exige. A mesma checagem vale na transição, na edição (não dá para remover itens de quem já tem proposta) e na carga inicial. |
| Contato não pode ser registrado no futuro, e um contato antigo não "volta no tempo" o último contato | Os dois casos mascarariam um lead esquecido. |

### Onde as regras vivem

1. **`api/src/domain`**: TypeScript puro, sem Nest nem banco, com cobertura completa de testes. É a fonte da verdade.
2. **API**: toda mudança de etapa passa por `POST /opportunities/:id/stage-transitions`. A operação trava a linha (`SELECT … FOR UPDATE`), valida no domínio e grava o histórico na mesma transação. Um teste e2e dispara dois movimentos simultâneos no mesmo card: só um vence, e o histórico não duplica. A etapa não muda por `PATCH`.
3. **Banco**: as invariantes críticas também viram CHECK constraints (Perdida com motivo, valor positivo, valor obrigatório a partir de Orçamento, quantidade > 0), como defesa caso algum script ou serviço futuro contorne a API.
4. **Front**: usa `allowedTransitions`, que vem da API, só para orientar a interação. Ele nunca decide sozinho.

### "Precisa de atenção"

Três sinais independentes, calculados na API com a data de hoje no fuso de São Paulo:

| Sinal | Alerta | Urgente |
| --- | --- | --- |
| Dias sem contato | acima do limite da etapa (Primeiro Contato 1, Orçamento 3, Follow-up 3, Forecast 2 dias) | acima do dobro do limite, ou nenhum contato registrado |
| Proposta | vence em até 3 dias | vencida |
| Evento do cliente | em até 14 dias | em até 7 dias (prazo de produção em risco) ou já passou |

Em 15/10/2026, isso aponta, por urgência, a **OPP-2002** (proposta vencida, 9 dias sem contato e evento em 10 dias), a **OPP-2004** (13 dias sem contato e proposta vencida) e a **OPP-2003** (evento em 3 dias). Os limites ficam em `DEFAULT_ATTENTION_POLICY`, num só lugar, para o comercial calibrar.

### Dados do case e campos em branco

- **OPP-2001** tem só duas datas. Interpretei a validade da proposta como vazia, porque em Primeiro Contato ainda não há proposta.
- **OPP-2007** está Perdida sem motivo, o que viola a regra. Em vez de inventar um motivo, a carga registra "Não informado na planilha de origem (registro importado)", e o registro fica auditável.
- **OPP-2006** está em Fechamento sem histórico de ter passado por Forecast. A carga cria um único registro, "Carga inicial: etapa importada", em vez de fabricar uma trajetória.
- A carga passa pelas mesmas invariantes da API: um dado inválido faz a carga falhar com uma mensagem clara.

---

## 3. Automação: retornos de follow-up

**Problema escolhido: o 4, "é fácil esquecer de dar retorno a um lead".** É a tese central do case ("o vendedor que esquece uma proposta na gaveta perde a venda"), e reaproveita as regras de atenção que o CRM já calcula. Assim, a tela e a automação não divergem sobre o que é "urgente".

**Como funciona:**

1. Todo dia útil, às 7h40 (São Paulo), o job varre o funil e cria **uma tarefa de retorno por negociação em risco**. A tarefa vai para o vendedor dono, com uma ação clara ("Renovar a proposta vencida de…", "Garantir o prazo de produção para o evento de…"), todos os motivos e um prazo: urgente vence hoje; alerta vence no próximo dia útil.
2. **O trabalho do vendedor fecha a tarefa sozinho.** Registrar contato conclui o retorno, mudar de etapa conclui, e marcar como perdida cancela. O vendedor também pode concluir ou dispensar na fila.
3. A tarefa de uma negociação encerrada é cancelada na próxima execução.

**Garantias:**

- **Idempotente em três camadas**, porque dois disparos simultâneos são um cenário real (agenda interna e cron da Vercel):
  1. O planejador ignora negociação que já tem tarefa aberta.
  2. Um `pg_advisory_xact_lock` serializa as execuções.
  3. Um índice único parcial (`WHERE status = 'OPEN'`) barra duplicatas no banco.

  O e2e dispara três execuções em paralelo e confere que só três tarefas existem.
- **Resiliente à hibernação.** No plano gratuito, o Render dorme sem tráfego, e a agenda interna não roda. Por isso há dois mecanismos:
  - Um cron da Vercel chama `/api/cron/follow-ups`, protegido por `CRON_SECRET`, que acorda a API e dispara o job.
  - Ao subir, a API roda uma **execução de recuperação** se ainda não houve execução no dia.
- **Auditável.** Cada execução fica em `automation_runs`, com gatilho (`schedule`, `cron`, `startup` ou `manual`), data e contagens. A fila mostra a última execução.
- **Testável.** O planejador é uma função pura (14 testes de unidade: idempotência, dias úteis, sexta → segunda, encerradas). Os e2e cobrem concorrência, conclusão por contato, cancelamento por perda, segredo e recuperação.

---

## Os outros três problemas

### 1. SLA do primeiro contato (lead esperando)

**Ideia:** todo lead entra por um ponto só e já sai com dono e relógio correndo.

**Implementação:**
- **Entrada:** um webhook `POST /leads` recebe os formulários do site e das campanhas e cria a oportunidade em Primeiro Contato. A distribuição entre vendedores é por rodízio ponderado pela carga atual, com o vendedor anterior priorizado quando o CNPJ já é cliente.
- **SLA no funil:** o prazo do primeiro contato vira um sinal de atenção de **horas**, não de dias. Por exemplo, alerta com 1 hora útil e urgente com 4 horas.
- **Escalonamento:** se o lead passar do SLA sem contato registrado, um job a cada 15 minutos notifica o vendedor (WhatsApp ou Slack) e, depois do dobro do prazo, o gestor, que pode redistribuir.
- **Métrica:** o tempo até o primeiro contato fica no histórico, para medir o SLA por vendedor e por canal.

### 2. Conhecer a empresa do lead antes da ligação

**Ideia:** enriquecer automaticamente cada lead com dados públicos.

**Implementação:**
- **Dados cadastrais:** ao criar a oportunidade com CNPJ, uma fila consulta a BrasilAPI ou a Receita Federal (razão social, porte, CNAE, data de abertura, endereço e capital social).
- **Contexto público:** a fila busca o site e o LinkedIn da empresa. Um LLM resume em 5 linhas o que a empresa faz e sugere ocasiões de brinde a partir do CNAE e do porte (onboarding, feiras, datas do setor).
- **Na tela:** tudo aparece num painel "Sobre a empresa" no detalhe. O assistente ganha a ferramenta `consultar_empresa`, com o mesmo cuidado de guardrails: dado externo é tratado como não confiável.
- **Infra:** cache por CNPJ e reprocessamento mensal.

### 3. Informações da ligação acessíveis depois

**Ideia:** transformar o roteiro da ligação em dados estruturados, não em anotações soltas.

**Implementação:**
- **Formulário guiado:** o roteiro (que já está na base de conhecimento, em `roteiro-ligacao.md`) vira um formulário com os campos que alimentam o orçamento: ocasião, data do evento, quantidade, orçamento, arte e decisor.
- **Gravação opcional:** com consentimento do cliente, a ligação é gravada. Transcrição (Whisper ou Gemini) e um LLM com saída em JSON Schema preenchem o formulário a partir dela. O vendedor revisa antes de salvar: humano no circuito, como nas ações do assistente.
- **Efeitos no funil:** os campos atualizam a oportunidade (data do evento, valor estimado), o que já alimenta os alertas. O resumo vai para o histórico e fica pesquisável pelo assistente.

---

## Assistente comercial com IA

Um chat lateral no CRM que responde sobre **o funil, ao vivo**, e sobre **como vender**, a partir de uma base de conhecimento. Ele pode preparar ações (mover etapa, registrar contato), que **só acontecem quando o vendedor confirma**. O objetivo é tirar o vendedor da planilha e do "deixa eu perguntar para alguém" sem abrir mão de controle e rastreabilidade.

Capturas da versão publicada (Gemini de verdade, base sincronizada com embeddings):

| Funil ao vivo e base de conhecimento, com fonte citada | Ação proposta, que só executa com confirmação |
| --- | --- |
| ![Assistente respondendo prioridades e prazo do bordado](docs/images/07-assistente-rag.jpg) | ![Assistente propondo fechar a OPP-2005](docs/images/08-assistente-acao.jpg) |

![Prompt injection bloqueado antes de chegar ao modelo](docs/images/09-assistente-guardrail.jpg)

A última captura mostra o guardrail de entrada: a tentativa de injection é recusada em 0,0 s, sem chamar o modelo. Acima dela, a ação descartada fica registrada como "Descartado".

### Visão geral

```mermaid
sequenceDiagram
  participant V as Vendedor
  participant UI as Painel do assistente
  participant G as Guardrails
  participant A as Agente
  participant M as Gemini
  participant T as Ferramentas (CRM + RAG)

  V->>UI: "A Construtora Horizonte tem evento dia 25/10, dá tempo com silk?"
  UI->>G: entrada (injection, segredos, CPF/cartão, tamanho)
  G->>A: pergunta higienizada
  loop até 5 chamadas ao modelo / 8 ferramentas
    A->>M: prompt + histórico + declarações das ferramentas
    M-->>A: chamada de ferramenta
    A->>T: argumentos validados (Zod)
    T-->>A: dados do CRM ou trechos numerados [1], [2]
  end
  M-->>A: resposta com citações
  A->>G: saída (citações reais? códigos OPP reais? vazou prompt/segredo?)
  G-->>UI: resposta + fontes + ações propostas + avisos
  V->>UI: confirma a ação → mesma rota do quadro (regras revalidadas)
```

### RAG: base de conhecimento

- **Fontes.** São 8 documentos Markdown **fictícios** em `api/knowledge`, coerentes com as regras do CRM: processo comercial, prazos de produção, técnicas de personalização, catálogo e mínimos, políticas de pagamento, desconto e frete, playbook de objeções, roteiro de ligação e FAQ. Nada foi copiado do site real.
- **Chunking por seção** (## e ###), porque a seção é a menor unidade que faz sentido sozinha.
  - Seções longas quebram por parágrafo, com um bloco de sobreposição, sem cortar tabelas ou listas.
  - Cada pedaço leva "Documento > Seção" no texto do embedding, para "qual o prazo do bordado?" achar a tabela certa mesmo que o parágrafo não repita a palavra "prazo".
- **Sincronização incremental.** Cada pedaço tem hash do conteúdo; a sincronização insere o novo, atualiza o que mudou, remove o que sumiu e **só gera embedding do necessário**. Rodar duas vezes não chama a IA nenhuma vez. Ela roda a cada subida da API.
- **Embeddings:** `gemini-embedding-001` com 768 dimensões, tipos de tarefa diferentes para documento e pergunta, e vetores normalizados. Ficam no pgvector, com índice HNSW por cosseno.
- **Busca híbrida.** Numa única consulta SQL, o top 20 semântico e o top 20 por full-text em português são fundidos por **Reciprocal Rank Fusion**. A busca por palavra-chave acerta termos exatos (códigos, "bordado", "5%"); a semântica acerta paráfrases. Se o provedor de IA cair, a busca segue só por palavra-chave, em vez de falhar.
- **Um bug que os testes pegaram.** A primeira versão tirava os acentos da pergunta, mas o índice guardava as palavras com acento: "ligação" virava "ligacao" e não casava. Como vendedor digita rápido e sem acento, a correção foi indexar **e** consultar sem acento (`unaccent` envolvido numa função imutável, exigência de coluna gerada). Um teste fixa esse comportamento.

### Ferramentas (function calling)

| Ferramenta | Tipo | O que faz |
| --- | --- | --- |
| `buscar_base_conhecimento` | leitura | Busca híbrida; devolve trechos numerados para citação |
| `listar_oportunidades` | leitura | Funil filtrado por vendedor, etapa, atenção ou texto, já ordenado por urgência |
| `detalhar_oportunidade` | leitura | Itens, datas, motivos de atenção, histórico e destinos possíveis |
| `listar_retornos` | leitura | Fila da automação de follow-up |
| `resumo_funil` | leitura | Quantidade e valor por etapa, valor em aberto, quantas precisam de atenção |
| `propor_mudanca_etapa` | ação | Prepara a mudança; recusa movimento proibido e devolve os destinos válidos |
| `propor_registro_contato` | ação | Prepara o registro de contato |

As ferramentas reaproveitam os serviços da API: o assistente enxerga exatamente as mesmas regras e o mesmo cálculo de atenção que a tela. Cada ferramenta tem um schema Zod, que **gera a declaração JSON Schema enviada ao Gemini e valida os argumentos devolvidos por ele**. Contrato e código não divergem. Argumento inválido volta como erro para o modelo se corrigir, em vez de virar exceção.

**Humano no circuito.** As ferramentas `propor_*` nunca executam nada. Elas viram cartões "Confirmar / Descartar" no chat, e confirmar chama as **mesmas rotas do quadro**, que revalidam tudo. Perda e retorno pedem motivo no próprio cartão.

### Guardrails em camadas

| Camada | O que barra | Como |
| --- | --- | --- |
| Entrada | Prompt injection (pt e en), pedido de segredos, texto acima de 1.500 caracteres | Padrões determinísticos; bloqueia **sem chamar o modelo** |
| Entrada | CPF e cartão | Mascarados antes do envio e do registro, com validação de dígito verificador e Luhn (não mascara qualquer número) |
| Prompt | Tom, escopo, "consulte antes de afirmar", "cite as fontes", "ações só propostas" | Regras curtas e verificáveis, cada uma coberta por guardrail ou eval |
| Contexto | Instruções escondidas em documentos ou dados | Resultado de ferramenta é declarado como dado; trecho da base com cara de injection é descartado |
| Execução | Loop infinito, custo, ferramenta inexistente | Até 5 chamadas ao modelo e 8 ferramentas por pergunta; lista fechada; argumentos validados; saída truncada |
| Disponibilidade | Gemini sobrecarregado (503), deadline (504), cota (429) | Nova tentativa com espera crescente e queda para modelos reserva (`GEMINI_FALLBACK_MODELS`; timeout e modelo aposentado vão direto ao próximo; modelo que falhou fica 2 min no fim da fila); a conversa fica no modelo que já respondeu e as thought signatures só são reenviadas a quem as gerou. Esgotado, responde 503 com mensagem clara e o CRM segue normal |
| Saída | Citação inventada | `[n]` que não corresponde a uma fonte recuperada é removido |
| Saída | Oportunidade inventada | `OPP-XXXX` que não veio das ferramentas nem da pergunta recebe aviso visível |
| Saída | Vazamento | Segredos (chave Google, URL de banco, senha Neon) são removidos; uma **canary** no prompt de sistema detecta vazamento do prompt e troca a resposta |
| Borda | Abuso de cota | Rate limit por cliente (30 perguntas a cada 10 minutos) |

O que foi bloqueado ou corrigido aparece na tela ("Dados pessoais foram removidos antes de enviar à IA") e fica registrado.

### Observabilidade

Toda pergunta fica em `assistant_interactions`, com a pergunta já mascarada, a resposta, as ferramentas chamadas (com duração e erro), as fontes citadas, os guardrails acionados, os tokens e a latência. Isso serve para auditoria, para estimar custo e para transformar conversas reais em novos casos de eval.

### Decisões e alternativas

- **Ferramentas em vez de colocar o funil no prompt:** os dados mudam a todo momento e precisam respeitar filtro e permissão. A ferramenta consulta o dado na hora e mantém o prompt pequeno.
- **RAG como ferramenta, não sempre ligado:** "quantas negociações estão em Follow-up?" não precisa da base; o modelo decide. O eval mede se ele decide bem.
- **Interface própria de provedor:** o Gemini fica atrás de `LlmProvider`, e trocar de provedor é escrever outra implementação. O mesmo contrato tem um **provedor roteirizado** que os testes usam para verificar o comportamento em volta do modelo sem rede nem aleatoriedade.
- **Modelo em produção:** `gemini-flash-lite-latest`, com `gemini-flash-latest` e `gemini-3.8-flash` de reserva. No dia da publicação o Flash completo devolvia 503 e 504 por excesso de demanda. O Lite responde em 2 a 4 s e passa nos evals abaixo. Trocar é só mudar `GEMINI_CHAT_MODEL`, sem tocar no código.
- **Sem streaming nesta versão:** as respostas levam poucos segundos e o painel mostra o andamento. Streaming seria o próximo passo de UX.

---

## Qualidade: testes, CI e evals

| Suíte | O que cobre | Testes |
| --- | --- | --- |
| API, unidade | Transições, atenção, planejador de follow-up, chunker, guardrails, novas tentativas do provedor | 115 |
| API, e2e (Postgres real com pgvector) | Rotas do funil, concorrência, automação, RAG (ingestão e busca), agente com provedor roteirizado | 71 |
| Front | Formatação, etapas, card, renderização das respostas da IA (inclusive tentativa de injetar HTML) | 22 |

O **CI** (GitHub Actions) roda tudo a cada push, com Postgres + pgvector como serviço, e publica o eval offline no resumo do job.

### Evals do assistente

Testes conferem comportamento determinístico. **Evals medem a qualidade do sistema com o modelo de verdade**, que varia. Há duas suítes, rodando contra a API por HTTP, ou seja, medindo o sistema inteiro:

**1. Recuperação (RAG).** São 20 perguntas com documento e seção esperados. Seis delas são **paráfrases sem palavra em comum** com o trecho certo, como "Quanto tempo demora para chegar em Recife?", cuja resposta está em "Frete e entrega: Norte e Nordeste". Métricas: hit@1, hit@4 (documento e seção), MRR e acerto nas paráfrases.

**2. Agente.** São 28 casos em seis categorias:

| Categoria | Exemplos do que se verifica |
| --- | --- |
| CRM | Consulta antes de responder; prioridades certas; valor em aberto R$ 63.400; "minhas" respeita o vendedor |
| RAG | Fatos certos (bordado 15 dias úteis, desconto de 5%) **com citação válida** |
| Ações | Fechar OPP-2005 propõe a ação certa; fechar OPP-2003 não propõe nada; nunca afirma ter executado |
| Escopo | Recusa capital da Austrália e código Python |
| Segurança | Injection direta é bloqueada; injection indireta não vaza o prompt; segredo é recusado; CPF não volta na resposta |
| Robustez | Código inexistente; pergunta que a base não responde ("não encontrei", em vez de inventar) |

As métricas são: casos aprovados, segurança (meta de 100%), escolha de ferramenta, taxa de citação válida, **fidelidade às fontes** (um juiz de IA dá nota de 1 a 5 se cada afirmação está sustentada pelos trechos), latência p50/p95 e tokens por pergunta. As metas ficam em `evals/thresholds.ts`. Abaixo delas o comando falha, o que serve de portão antes de trocar modelo, prompt ou chunking.

**Resultados.** A busca só por palavra-chave, sem IA, já acerta bem termos exatos, mas tropeça nas paráfrases:

| Modo | hit@1 | hit@4 | seção hit@4 | MRR | paráfrases hit@4 |
| --- | --- | --- | --- | --- | --- |
| Só palavra-chave (offline, sem IA) | 75% | 90% | 94% | 0,80 | 67% |

Os erros da busca por palavra-chave são justamente as perguntas sem palavra em comum com o trecho ("o contato disse que precisa consultar a diretoria", "chegou peça com defeito"). É a lacuna que o embedding semântico existe para fechar, e o eval online mede quanto ela fecha.

Contra a **API publicada** (Gemini de verdade, `gemini-flash-lite-latest`, embeddings `gemini-embedding-001`), a busca híbrida fecha essa lacuna:

| Modo | hit@1 | hit@4 | seção hit@4 | MRR | paráfrases hit@4 |
| --- | --- | --- | --- | --- | --- |
| Híbrida (semântica + palavra-chave, online) | 95% | 100% | 100% | 0,98 | 100% |

O único caso fora do 1º lugar ("o contato disse que precisa consultar a diretoria") achou o trecho certo em 2º.

E o agente, nas mesmas condições:

| Métrica | Resultado | Meta |
| --- | --- | --- |
| Casos aprovados | 93% (26/28) | 85% |
| Segurança (injection, segredos, CPF, vazamento) | 100% | 100% |
| Escolha de ferramenta | 100% | 85% |
| Respostas de base com citação válida | 100% | 90% |
| Latência p50 / p95 | 1,5 s / 2,4 s | p95 ≤ 20 s |
| Tokens por pergunta (média) | 2.663 | |

As duas falhas, sem maquiagem:

- `crm-minhas`: "quais são as minhas negociações em aberto?" (vendedora Ana). O modelo listou só a urgente (OPP-2003) e deixou de fora a OPP-2001, que está em dia. É um erro real de interpretação do modelo leve. O caminho é deixar mais explícito na descrição da ferramenta que "em aberto" não é sinônimo de "precisa de atenção".
- `crm-inexistente`: a resposta estava certa ("A OPP-7777 não foi encontrada"), mas o verificador só aceitava "não encontr…". O erro era do eval, que já foi corrigido no dataset.

Esta rodada foi sem o juiz de fidelidade, que precisa do segredo `GEMINI_API_KEY` no GitHub Actions. Ele entra no workflow semanal.

O workflow **Evals do assistente** (manual ou semanal) sobe a API com os dados do case, sincroniza a base com o Gemini e roda as duas suítes com o juiz. O relatório completo, com cada falha, sai no resumo do job e como artefato.

---

## API

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/opportunities?search=&stage=&seller=&attention=` | Lista com atenção calculada, por urgência. `stage` aceita lista separada por vírgula; `attention` aceita `any`, `critical` ou `warning` |
| GET | `/opportunities/:id` | Detalhe com itens, histórico e destinos permitidos |
| POST | `/opportunities` | Cria em Primeiro Contato, com código OPP sequencial |
| PATCH | `/opportunities/:id` | Edita dados (não a etapa); `items` substitui a lista |
| POST | `/opportunities/:id/stage-transitions` | `{ to, reason?, changedBy? }` |
| POST | `/opportunities/:id/contacts` | Registra contato (padrão: hoje); conclui o retorno aberto |
| GET | `/follow-up-tasks?status=&seller=` | Fila de retornos |
| PATCH | `/follow-up-tasks/:id` | `{ status: DONE \| CANCELED, resolution? }` |
| POST | `/automations/follow-ups/run` · `/cron` | Dispara a automação (`x-automation-secret`) |
| GET | `/automations/follow-ups/runs` | Histórico de execuções |
| POST | `/assistant/chat` | `{ message, history?, seller? }` → resposta, fontes, ferramentas, ações, guardrails |
| POST | `/assistant/search` | Busca híbrida direta na base (usada pelos evals) |
| GET | `/assistant/status` | Provedor, modelos e modo da busca |
| POST | `/assistant/knowledge/sync` | Reprocessa a base (`x-automation-secret`) |
| GET | `/meta` · `/health` | Etapas, transições, data de referência e vendedores · checagem do banco |

**Erros** seguem um formato único: `{ error, message, violations?, fields? }`.

- **400**: entrada inválida.
- **422**: regra de negócio, com **todas** as violações de uma vez.
- **404**: recurso não encontrado.
- **401**: segredo ou chave ausente ou inválido.
- **429**: limite do assistente atingido.
- **503**: assistente desligado, ou provedor de IA sobrecarregado depois das novas tentativas (`ASSISTANT_UNAVAILABLE`).

## Deploy

| Peça | Onde | Por quê |
| --- | --- | --- |
| Front e cron diário | **Vercel** | É a casa natural do Next; o cron do plano gratuito cobre a automação diária |
| API | **Render** (Docker, Virgínia) | A API é um servidor contínuo com agenda interna, que não cabe bem como função serverless; o Dockerfile é o mesmo do docker compose |
| Banco | **Neon** (us-east-1) | Postgres gerenciado com pgvector e `unaccent`; o gratuito não expira, ao contrário do Postgres gratuito do Render (30 dias) |

- **Latência:** API e banco ficam na mesma região. O Render não tem região no Brasil, e uma tela faz várias consultas: com o banco em São Paulo e a API na Virgínia, cada consulta cruzaria o continente.
- **Hibernação:** o Render gratuito dorme sem tráfego. O cron da Vercel e a execução de recuperação ao subir garantem que a automação rode mesmo assim. A carga inicial só acontece com banco vazio, então reinícios não apagam o que foi feito na demo.
- **Variáveis:**
  - **API:** `DATABASE_URL`, `REFERENCE_DATE`, `AUTOMATION_SECRET`, `CORS_ORIGIN` e `GEMINI_API_KEY`.
  - **Vercel:** `NEXT_PUBLIC_API_URL`, `CRON_SECRET` e `AUTOMATION_SECRET`.

  A lista completa está nos `.env.example`.

## Segurança

- **Credenciais:** nenhuma no código. A configuração vem do ambiente, validada com Zod na subida, e só há `.env.example` no repositório. A chave do Gemini nunca vai para o navegador.
- **Entrada:** validação estrita, que rejeita campos desconhecidos. A busca escapa curingas do `LIKE` e a consulta de full-text só aceita letras e dígitos. O SQL é sempre parametrizado.
- **Rotas de máquina** (automação e sincronização da base) exigem segredo, comparado em tempo constante.
- **API key opcional (`API_KEY`)** para todas as rotas, exceto `/health`.
- **Assistente:** guardrails, rate limit e mascaramento de dados pessoais, descritos acima.

**Em produção, eu completaria assim:**

- **Autenticação:** SSO do Google Workspace ou Microsoft com JWT validado na API (OIDC).
- **Autorização:** papéis de vendedor e gestor. O `changedBy` e o "minhas negociações" do assistente passariam a vir do token, e as ferramentas do assistente filtrariam pelo usuário logado.
- **Rede e borda:** CORS restrito ao domínio, rate limit distribuído (Redis) e WAF.
- **Segredos e banco:** segredos em cofre; banco em rede privada, com usuário de aplicação sem DDL.
- **Observabilidade:** logs estruturados sem dados pessoais e alertas de erro.
- **IA:** termos de uso de dados do provedor revisados. Para dados sensíveis, um modelo com retenção zero ou hospedado na própria nuvem.

## Limitações e próximos passos

- A atenção é calculada na aplicação a cada listagem: simples e correto para um time comercial. Com milhares de oportunidades, o caminho seria materializar o score e paginar as colunas finais.
- Vendedor é texto livre, porque não há autenticação nesta versão.
- O front tem os tipos da API escritos à mão. O próximo passo seria gerá-los de um OpenAPI exportado pelo Nest.
- Criar e editar oportunidades existe na API, mas ainda não tem tela; o foco da UI foi o funil e o trabalho diário.
- Feriados não entram no cálculo de dias úteis.
- **Assistente:**
  - Não tem streaming.
  - A conversa vive no navegador (a API é stateless).
  - A base de conhecimento é fictícia e pequena: com centenas de documentos, valeria reranking e avaliação contínua com perguntas reais tiradas de `assistant_interactions`.

## Uso de IA no desenvolvimento

Usei um assistente de IA (Claude) como par de programação ao longo do case. Ele participou de:

- **Código:** gerar rascunhos de código e testes e revisar alternativas de arquitetura.
- **Base fictícia:** escrever os documentos da base de conhecimento.
- **Paleta visual:** extrair a paleta do site oficial.
- **Diagnóstico:** investigar falhas.

As decisões de produto e de regra, a revisão do código e a validação foram minhas. Toda funcionalidade foi verificada com testes automatizados, CI e uso real da aplicação. Alguns erros foram pegos e corrigidos nesse processo e estão documentados aqui (o bug de acentos na busca, por exemplo).

O próprio produto também usa IA: o assistente comercial descrito acima, com Gemini.
