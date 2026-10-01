# 12 — Parte 1: base da API (P1-B*)

Estas duas tarefas preparam o terreno. Nenhuma rota nova de negócio ainda.

---

## P1-B1 — Roteador por segmentos, helpers e catálogo de eventos

### Problema
`api/v1/[...path].js` roteia por `switch (route)` com a rota inteira (`'leads'`, `'contacts'`).
As rotas novas têm id no meio (`leads/{id}/notes`). Tudo continua no **mesmo arquivo de função**
(limite de 12 funções da Vercel).

### Estrutura de arquivos

```
api/v1/[...path].js          ← continua o único ponto de entrada (só roteia)
api/_lib/v1handlers.js       ← handlers antigos — NÃO mexer no comportamento
api/_lib/v1/http.js          ← NOVO: erros, paginação, leitura de query
api/_lib/v1/router.js        ← NOVO: casa método + padrão de rota
api/_lib/v1/<recurso>.js     ← NOVOS: um arquivo por recurso (pipelines, leads, contacts,
                               conversations, users, messages, events)
api/_lib/events.js           ← NOVO: catálogo de eventos de webhook
```

### Roteador
- Quebre a rota em segmentos: `'leads/abc-123/notes'` → `['leads','abc-123','notes']`.
- Tabela de rotas com padrões, ex.: `{ method: 'GET', pattern: 'leads/:id/notes', handler }`.
- **Ordem de resolução:** primeiro as rotas novas da tabela; se nenhuma casar, cai no `switch`
  antigo **exatamente como está hoje** (mesmos handlers, mesmas respostas). Assim
  `GET /v1/contacts?phone=` continua indo para `handleContacts`.
- Exceções planejadas (as únicas):
  - `GET /v1/contacts` **sem** `phone`, `id` e `external_id` vai para a listagem nova (P1-L4).
    Com qualquer um deles, continua no handler antigo.
  - `POST /v1/contacts` vai para o handler novo de criação (P1-E2), que **chama o antigo** quando
    o contato já existe. `PATCH /v1/contacts` continua indo direto para o antigo.
- Rota não encontrada: manter `404 { error: 'not_found', route }` (formato atual).
- Método errado numa rota que existe: `405 { error: 'method_not_allowed', message }`.
- CORS: manter os headers atuais e acrescentar `PUT`, `DELETE` e o header `Authorization` em
  `Access-Control-Allow-Methods/Headers`.

### `http.js`
```js
// Erro padrão das rotas novas: { error: 'snake_case_code', message: 'texto em português' }
export function fail(res, status, error, message) { ... }

// Paginação no formato Helena. Aceita pageNumber/pageSize em qualquer caixa
// (pageNumber, PageNumber). pageNumber >= 1 (padrão 1); pageSize 1..100 (padrão 20).
export function readPaging(query) { return { pageNumber, pageSize, from, to }; }

// Monta a resposta paginada a partir de { data, count } do Supabase (.select(..., { count: 'exact' }).range(from, to))
export function paged(res, { pageNumber, pageSize }, items, totalItems) {
  // { pageNumber, pageSize, totalPages, totalItems, hasMorePages, items }
}

// Datas de filtro: createdAfter / createdBefore / updatedAfter / updatedBefore (ISO 8601).
// Inválida → 400 invalid_date.
export function readDate(query, name) { ... }
```
`pageSize` acima de 100 → usa 100 (não dá erro). `pageNumber` além do fim → `items: []`.

### `events.js` (catálogo)
Uma constante única, usada pelo `GET /v1/webhook-events` (P1-L10) e, na P1-W3, pela tela:

```js
export const WEBHOOK_EVENTS = [
  { event: 'message.received',          description: 'Cliente mandou mensagem (só com a conversa em automação)', since: 'v1' },
  { event: 'message.sent',              description: 'O FlowMate enviou uma mensagem', since: 'v1' },
  { event: 'contact.created',           description: 'Contato criado', since: 'v1' },
  { event: 'lead.created',              description: 'Lead criado', since: 'v1' },
  { event: 'lead.moved',                description: 'Lead mudou de etapa ou de funil', since: 'v1' },
  // novos da Parte 1:
  { event: 'contact.updated',           description: 'Contato alterado pela API', since: 'p1' },
  { event: 'contact.tags_updated',      description: 'Tags do contato alteradas pela API', since: 'p1' },
  { event: 'lead.updated',              description: 'Lead alterado pela API', since: 'p1' },
  { event: 'note.created',              description: 'Nota interna criada pela API', since: 'p1' },
  { event: 'conversation.state_changed',description: 'Conversa mudou entre automação e humano', since: 'p1' },
  { event: 'whatsapp.connection',       description: 'Número conectou ou desconectou', since: 'p1' },
];
```

**Teste:** smoke test inteiro (nada pode mudar) + `GET /v1/qualquercoisa` → 404 igual a hoje.

---

## P1-B2 — Aceitar `Authorization: Bearer`

**Arquivo:** `api/v1/[...path].js` (só a linha que lê a chave).

Ordem de leitura da chave: `x-api-key` → `Authorization: Bearer <chave>` → `?key=` (mantida por
compatibilidade). Mesmo `resolveApiKey` de hoje. Não confunda com o JWT do Supabase: na `/v1` o
Bearer é **a chave da integração**.

Motivo: é o formato da Helena e o padrão do nó HTTP Request do n8n (credencial "Header Auth" ou
"Bearer"); facilita migrar fluxos.

**Teste:** a mesma chamada com `x-api-key` e com `Authorization: Bearer` dá o mesmo resultado;
sem chave → `401 { error: 'invalid_api_key' }` (igual hoje).
