# Plano — Etiquetas (a trava de conversa vira etiqueta)

> **Status (2026-10-17):** ET-0 (SQL, CF-A PARTE 6) aplicada; **ET-2 e ET-4 no ar atrás da chave
> `labels` desligada** (`relatorios/ET-2-ET-4.md`). **ET-3 no ar (2026-10-20, `relatorios/ET-3.md`).**
> Falta: ET-5 (`INTEGRATIONS.md`) e ET-B.
> Pedido do Agadir em 2026-10-13.
>
> **Onde entra no `PLANO-CONFIABILIDADE.md`:**
> - **ET-0 (SQL):** no arquivo único da CF-A (`supabase_cf_a.sql`).
> - **ET-1/ET-2** (chaves e API de etiquetas, sem tocar no caminho de mensagens): durante a CF-A.
> - **ET-3/ET-4** (envio/recebimento e tela): **depois da A6 e antes da B2** (CF-B), porque mexem
>   no mesmo caminho que a CF-A e precisam existir antes de a B2 refazer a chave de
>   `conversations`.
> - **ET-B:** junto com a contração da B2.
>
> **Decisões do Agadir (2026-10-13):**
> - `message.received` com a chave `labels` ligada sai **sempre**, com as etiquetas da conversa
>   no payload, mesmo com `block_api_send_on_human` ligada;
> - etiqueta de sistema **proibida em contato** (só em conversa);
> - paleta de 8 cores fixas + cinza padrão: **aprovada**.
>
> **Regra de produto:** etiqueta nunca trava envio, recebimento, roteamento nem atendimento (ver
> o contrato).

## Regra de produto (nova)
- "Atendimento humano" e "Atendimento IA" deixam de ser **trava** e viram **etiquetas**, como na
  Helena. O FlowMate **só marca**; quem decide se responde é a automação do cliente (n8n).
- O usuário cria as próprias etiquetas (nome + cor), aplicáveis a **contato** e a **conversa**.
- **Sem trava por padrão.** Trava opcional por empresa, **desligada**: "bloquear envio pela API
  em conversas com a etiqueta Atendimento humano", que reproduz o 409 de hoje.

## Duas chaves por empresa (`companies.features`, jsonb)
| Chave | Padrão | Efeito |
| --- | --- | --- |
| `labels` | `false` | **Liga o comportamento novo** (marcação por etiqueta, sem trava). Desligada = tudo como hoje (estado + 409), mas as tabelas de etiqueta já ficam em dia por gatilho (abaixo), para a virada não precisar de migração. |
| `block_api_send_on_human` | `false` | Só vale com `labels` ligada: envio automático em conversa com "Atendimento humano" (nela ou na gêmea) → **409**, como hoje. |

- A leitura da chave é defensiva: coluna ausente ou erro → `false` (comportamento atual).
- Liga primeiro na empresa do Agadir; depois para todos. Volta atrás sem deploy.

## Modelo de dados (SQL, Fase A: só acrescenta)
```sql
create table public.labels (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 100),
  color       text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  kind        text not null check (kind in ('system','user')),
  system_key  text check (system_key in ('human','ai')),          -- só nas de sistema
  created_by  uuid references public.user_profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, name),                                       -- exato: "VIP" ≠ "vip" (igual às tags de hoje)
  unique (company_id, system_key),
  check ((kind = 'system') = (system_key is not null))
);
create table public.contact_labels (
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid not null references public.crm_contacts(id) on delete cascade,
  label_id   uuid not null references public.labels(id) on delete cascade,
  source     text not null default 'user' check (source in ('api','user','phone','system')),
  created_at timestamptz not null default now(),
  primary key (contact_id, label_id)
);
create table public.conversation_labels (
  company_id      uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  label_id        uuid not null references public.labels(id) on delete cascade,
  source          text not null default 'user' check (source in ('api','user','phone','system')),
  created_at      timestamptz not null default now(),
  primary key (conversation_id, label_id)
);
-- + índices por (company_id, label_id); RLS tenant_isolation por company_id (como as demais).
```

**Funções e gatilhos (a regra fica no banco, atômica):**
- `ensure_system_labels(company)`: cria "Atendimento humano" e "Atendimento IA" se faltarem.
  - Gatilho `after insert on companies` chama essa função.
  - O backfill roda para todas as empresas existentes.
- `set_conversation_attendance(conversation, 'human'|'ai', source)`: numa transação, troca a
  etiqueta de sistema e mantém a coluna `conversations.state` igual (`human`/`automation`).
  - É o único jeito de mexer nas etiquetas de sistema.
  - Garante **exatamente uma** das duas.
- Gatilho `after insert on conversations`: aplica a etiqueta conforme o `state` (nova conversa →
  "Atendimento IA"). Assim nenhum caminho antigo cria conversa sem etiqueta.
- Gatilho `after update of state on conversations`: aplica a etiqueta correspondente. Com a
  chave desligada, o código atual (que só mexe em `state`) mantém as etiquetas em dia sozinho.
  Com a chave ligada, a função acima mexe nos dois; o gatilho vê o mesmo valor e não faz nada.
- **Tags do contato (Fase A, uma direção):** gatilho em `crm_contacts.tags` → cria a etiqueta
  `user` que faltar (cor padrão) e sincroniza `contact_labels`.
  - O array `tags` continua sendo **a fonte** na Fase A.
  - Renomear ou excluir etiqueta atualiza os arrays por função (`rename_label`,
    `delete_label`), na mesma transação.

**Regras de implementação do SQL (achados do revisor; obrigatórias na ET-0):**
- **Gatilhos à prova de falha.** Nenhum gatilho pode derrubar o `INSERT`/`UPDATE` de
  `conversations` ou `crm_contacts`:
  - `ensure_system_labels` é chamada dentro do gatilho se faltar a etiqueta;
  - `insert … on conflict do nothing`;
  - bloco `exception when others` que só registra o erro (tabela `label_sync_errors` ou
    `raise warning`) e deixa a escrita principal passar.

  Sem isso, uma falha no gatilho faria o `getOrCreateConversation` devolver `null` (409/503)
  mesmo com a chave desligada.
- **Gatilhos estreitos e sem recursão:**
  - `when (old.state is distinct from new.state)`;
  - `when (old.tags is distinct from new.tags)`;
  - guarda `pg_trigger_depth() > 1` → sai;
  - `rename_label`/`delete_label` atualizam os arrays com a sincronização desligada na
    transação (`set_config('flowmate.skip_label_sync','on', true)`).
- **Grupos ficam sem etiqueta de sistema.** Gatilho, backfill e `set_conversation_attendance`
  pulam/recusam `@g.us`, `@broadcast` e `@newsletter`. A conferência conta só conversas
  individuais (grupos não pausam hoje e continuam assim).
- **Tags que não cabem numa etiqueta** (vazias, só espaços, mais de 100 caracteres — a tela e o
  `PATCH /v1/contacts` antigo não validam): o gatilho e o backfill **pulam** e registram. A
  conferência lista quantas foram puladas. O array não é alterado, então nada se perde.
- **Tag com o mesmo nome de uma etiqueta de sistema** ("Atendimento humano"/"Atendimento IA"):
  nunca liga o contato à etiqueta de sistema. Pula e registra; a conferência lista.
- **Remoção:** tirar a tag do array apaga a linha de `contact_labels` (sincronização completa:
  o conjunto de etiquetas `user` do contato = o array).
- **Corrida:** `on conflict (company_id, name) do nothing` + releitura do id.
- **Segurança:**
  - funções e gatilhos `SECURITY DEFINER` com `search_path` fixo, sempre filtrando por
    `company_id`;
  - `revoke execute … from public, anon, authenticated`: só o servidor (`service_role`) chama
    as funções;
  - **RLS das 3 tabelas: só `SELECT` para o usuário da própria empresa.** Toda escrita passa
    pelo servidor (gera o evento com `source`) ou pelos gatilhos.
- **Realtime:** está desligado no projeto (o Chats usa polling, ver HANDOFF). As tabelas novas
  entram no polling, não na publicação.

**Backfill e migração (no mesmo arquivo, com conferência e rollback):**
1. `ensure_system_labels` para todas as empresas.
2. **Conversas:** `state = 'human'` → "Atendimento humano"; as demais → "Atendimento IA".
3. **Tags:** cada tag distinta por empresa vira etiqueta `user` (nome exato, cor padrão) +
   `contact_labels`.
4. **Conferência:**
   - 0 conversas **individuais** sem etiqueta de sistema;
   - 0 conversas com as duas;
   - 0 grupos com etiqueta de sistema;
   - lista de tags puladas (vazias, longas, nome de sistema);
   - contagem de "humano" = contagem de `state = 'human'`;
   - para cada contato, `tags` = nomes das suas etiquetas;
   - 2 etiquetas de sistema por empresa.
5. **Rollback:** dropar gatilhos, funções e as 3 tabelas.
   - `conversations.state` e `crm_contacts.tags` nunca são alterados pela migração: o rollback
     não perde nada do que existe hoje.

## As tags atuais migram sem perda? Sim, com o contrato da E3 intacto
- **Sem perda:**
  - nome exato vira etiqueta; `VIP` e `vip` continuam diferentes (`unique` exato, igual ao
    comportamento atual);
  - a ordem das tags de cada contato continua no array (fonte na Fase A).
- **Contrato da E3 intacto:** `POST /v1/contacts/{id}/tags` continua recebendo **nomes**, com as
  mesmas 3 operações e a mesma resposta.
  - Escreve no array como hoje; o gatilho reflete nas etiquetas.
  - Nome novo cria a etiqueta (cor padrão), como já acontece hoje com tag nova.
  - `contact.tags_updated` continua saindo.
- **Quem mais escreve tags hoje:**
  - automações do navegador ("adicionar tag", gatilho "tag adicionada");
  - `PATCH`/`POST /v1/contacts`;
  - `POST /v1/leads`.
  - Todos continuam funcionando sem mudança, porque o array segue como fonte.
- **Fase B (contrair, outro deploy):**
  - `contact_labels` vira a fonte e `tags` passa a ser derivado nas respostas;
  - o gatilho de sincronização sai.
  - **A decidir:** normalizar maiúsculas (`VIP`/`vip`) ou manter. Pendência já aberta na P1-Z.

## API `/v1` (rotas novas, no catch-all; nenhuma função nova)
| Rota | O que faz |
| --- | --- |
| `GET /v1/labels` | Lista (filtro `kind`), com `id, name, color, kind, system_key, created_at, updated_at` |
| `POST /v1/labels` | Cria `{ name, color? }` (`kind: user`). Nome repetido → `409 label_exists` |
| `PATCH /v1/labels/{id}` | Edita nome/cor. Sistema: só a cor (nome → `422 label_is_system`) |
| `DELETE /v1/labels/{id}` | Exclui e tira de contatos/conversas. Sistema → `422 label_is_system` |
| `POST /v1/contacts/{id}/labels` | `{ labels: [id ou nome], operation: InsertIfNotExists \| DeleteIfExists \| ReplaceAll }` (mesmos nomes da E3). Etiqueta de sistema em contato → `422` |
| `POST /v1/conversations/{id}/labels` | Mesmo corpo. As de sistema são exclusivas: aplicar uma tira a outra; não dá para ficar sem nenhuma (`422`). Aplica também na **gêmea** quando é etiqueta de sistema |

**Respostas:**
- **Contato** (rotas novas) e **Conversa** ganham `labels: [{ id, name, color, kind }]`.
- A **Conversa** mantém `state`, derivado: "Atendimento humano" → `human`; senão, `automation`.
- A rota antiga `GET /v1/contacts?phone=` não muda (regra da Parte 1).

**Compatibilidade:**
- `PATCH /v1/conversations/{id}` com `state` continua: `human`/`automation` → aplica a etiqueta
  de sistema correspondente na conversa e na gêmea, pela função do banco.

## Eventos (catálogo `api/_lib/events.js`)
| Evento | `data` |
| --- | --- |
| `contact.labels_updated` (novo) | `{ contact_id, labels: [{id,name}], added, removed, source }` |
| `conversation.labels_updated` (novo) | `{ conversation_id, contact_id, remote_jid, labels, added, removed, source, user_id }` |

- **`source`:** `api` | `user` (tela) | `phone` (respondeu pelo celular) | `system` (marcação
  automática do FlowMate: conversa nova, migração, automações).
- **Continuam saindo enquanto existirem** (obsoletos; somem na Fase B):
  - `conversation.state_changed`, junto com o `conversation.labels_updated` quando a etiqueta de
    sistema muda;
  - `contact.tags_updated`, junto com o `contact.labels_updated`.
- **`message.received`** com a chave ligada passa a sair **sempre** (inclusive em "Atendimento
  humano"), com `labels` e `state` no payload. Sem isso o n8n não teria como decidir.
  **Decidido (2026-10-13): sempre**, mesmo com `block_api_send_on_human` ligada.

## Marcação automática (substitui as transições de estado de hoje)
| Quando | Hoje (chave desligada) | Com `labels` ligada |
| --- | --- | --- |
| Atendente envia pela tela | conversa → `human` | conversa **e gêmea** → "Atendimento humano" (`source: user`) |
| Dono responde pelo celular | → `human` | conversa e gêmea → "Atendimento humano" (`phone`) |
| "Devolver para automação" (tela/PATCH) | conversa e gêmea → `automation` (E0b) | conversa e gêmea → "Atendimento IA" |
| Conversa nova | `automation` | "Atendimento IA" (gatilho) |
| Envio automático em "humano" | **409** | **envia** (sem trava); com `block_api_send_on_human`, 409 como hoje |

## O que muda no código de envio/recebimento (só com a chave ligada)
- **`sendMessage`:**
  - **trava:** a checagem do 409 (`findPausedConversation`) só roda se
    `block_api_send_on_human` estiver ligada;
  - **marcação:** a transição humano vira `set_conversation_attendance` na conversa e na gêmea;
  - **conversa nula:** a regra da E0b continua. `getOrCreateConversation` devolver `null` →
    **503** (não há onde registrar). Com a trava ligada, o envio automático → 409, como hoje.
- **Webhook da Evolution:**
  - resposta pelo celular → etiqueta humana na conversa e na gêmea;
  - `message.received` conforme a decisão acima;
  - conversa nula → igual à E0b (grava a mensagem e não mexe em nada).
- **`getOrCreateConversation`:** não muda. O insert continua com `state: automation`; o gatilho
  põe "Atendimento IA". A regra da E0b ("nunca sobrescrever") continua valendo.
- **E0 (telefone/JID e gêmea):** sem mudança na regra de telefone; a gêmea passa a receber a
  mesma etiqueta.
- **Chave desligada:** a lógica é idêntica à de hoje. Os gatilhos só **leem** `state`, nunca o
  alteram, e são à prova de falha (acima). A disponibilidade passa a depender deles não
  derrubarem a escrita: por isso o `exception when others`.
- **Mudança real com a chave ligada:** a marcação humana passa a valer também para a **gêmea**.
  Hoje, enviar pela tela ou responder pelo celular só pausa a própria conversa; a gêmea só é
  considerada no 409 e no "devolver".
- **Catch-all novo da tela** (`api/conversations/[...path].js`): com o fallback de `req.url`
  (gotcha do HANDOFF), e a rota antiga `/api/conversations/state` continua respondendo.

## Tela
- **Configurações → Etiquetas:** lista; criar/editar (nome, cor); excluir (confirmação com o
  número de contatos/conversas). As de sistema aparecem com cadeado: só a cor é editável.
- **Contato** (painel do contato, no Chats e em Contatos): chips de etiqueta; adicionar/remover.
  Hoje as tags **não aparecem em nenhuma tela**; passam a aparecer como etiquetas.
- **Chats:**
  - chips de etiqueta da conversa **no lugar do badge de estado**;
  - **filtro por etiqueta** na lista;
  - o botão "Devolver para automação" continua (vira "marcar como Atendimento IA").
- **Configurações → Integrações:** liga/desliga "bloquear envio pela API em conversas com
  Atendimento humano" (só admin).
- As escritas da tela passam pelo servidor, para gerar evento com `source: user`. Sem função
  nova: o `api/conversations/state.js` vira um catch-all `api/conversations/[...path].js`
  (estado + etiquetas da conversa), e as etiquetas de contato e o CRUD entram no mesmo
  catch-all. Continua com 7 funções.

## Riscos
1. **Caminho de envio e recebimento:** coberto pela chave (desligada = comportamento atual) e
   pelos gatilhos, que nunca alteram `state`. Testes locais com banco falso, como na E0b.
2. **n8n do cliente que confia no 409** passa a enviar em "Atendimento humano" quando a chave
   for ligada. Por isso a trava opcional existe, o kit muda antes, e a chave liga primeiro só na
   empresa do Agadir.
3. **Dois lugares para tags na Fase A** (array + tabela): sincronização numa direção só, por
   gatilho. Renomear/excluir por função transacional. Conferência no SQL.
4. **Automações do navegador** (gatilho "tag adicionada") não disparam quando a etiqueta é
   aplicada pela API ou pelo servidor. Já é a limitação conhecida da Parte 1; resolve no bloco
   16 (automações no servidor).
5. **Volume:** `conversation_labels` cresce com as conversas (1 linha de sistema por conversa
   + as do usuário). Pequeno.
6. **Gêmeas:** a mesma etiqueta nas duas. A fusão das duplicadas continua na Parte 2.

## Etapas e tamanho
| Etapa | O quê | Depende de SQL | Tamanho |
| --- | --- | --- | --- |
| ET-0 | SQL: tabelas, RLS, funções, gatilhos, backfill, migração, conferência, rollback (no arquivo único da Fase A) | é o SQL | **M** |
| ET-1 | Leitura das chaves (`companies.features`, defensiva) + biblioteca `api/_lib/labels.js` (sem uso) | não (código dormente) | **P** |
| ET-2 | API: CRUD de etiquetas, aplicar em contato/conversa, `labels` nas respostas, eventos novos no catálogo (`available: false` até ligar) | sim, para testar | **M** |
| ET-3 | Envio/recebimento atrás da chave: `sendMessage`, webhook, devolver, `PATCH` com `state`, trava opcional | sim | **M** (caminho mais sensível; revisor com o modelo completo) |
| ET-4 | Tela: Configurações → Etiquetas, chips no contato e na conversa, filtro no Chats, badge, chave da trava | sim | **G** |
| ET-5 | Kit do tester, contrato, `INTEGRATIONS.md`; ligar na empresa do Agadir (ele liga) | não | **P** |
| ET-B | Fase B: `tags` derivado, sai o gatilho de sincronização; `state`/`state_changed`/`tags_updated` obsoletos removidos (com aviso prévio) | sim | **M** |

## O que vira obsoleto (com a chave ligada; remoção só na Fase B)
- **`conversations.state` e `state_since`/`state_by`:** continuam gravados (pela função) e
  respondidos (`state` derivado). Viram leitura de compatibilidade.
- **`conversation.state_changed`:** substituído por `conversation.labels_updated`.
- **`contact.tags_updated` e o campo `tags`:** substituídos por `contact.labels_updated` e
  `labels`.
- **O 409 `conversation_paused`:** só existe com a trava opcional ligada.
- **`PATCH /v1/conversations/{id}` com `state`:** continua aceito; o caminho recomendado passa a
  ser `POST /v1/conversations/{id}/labels`.

## Decisões (respondidas em 2026-10-13)
Todas no topo deste arquivo. Nada em aberto.
