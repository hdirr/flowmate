# P1-E0b — Conversa nunca volta a `automation` por falha de leitura; devolver retoma a gêmea

**Status:** pronto · **Commit:** `eefaf17` — fix(P1-E0b) · **SQL:** não se aplica
**Pedido do Agadir (2026-10-06):** prioridade máxima; pendência 2 da P1-E0.

## O problema
`getOrCreateConversation`:
- ignorava erro na leitura;
- se a leitura falhasse, criava a conversa com um `upsert` + `onConflict`, que **sobrescrevia** o
  `state` de uma conversa existente para `automation`;
- uma falha transitória do banco podia, assim, soltar a automação em cima de um atendente.

## O que mudou
- **`api/_lib/conversations.js`:**
  - **`getOrCreateConversation`:**
    - leitura com erro → **`null`** (não cria, não grava nada);
    - criação com **`INSERT`**, não upsert. Se outra requisição criou no meio-tempo (`23505`),
      relê e usa a do banco com o estado dela; se a releitura falhar, `null`;
    - **nenhum caminho grava `automation` sobre conversa existente.** Só gravam `automation` o
      insert de conversa nova e as ordens explícitas de "devolver".
  - **`findTwinConversation`** (gêmea com/sem o 9º dígito, filtrada por `company_id`).
  - **`resumeAutomation`:** "devolver para automação" retoma a conversa **e a gêmea em `human`**.
    Devolve os ids que mudaram.
  - O cliente do banco virou parâmetro opcional (padrão: o do servidor), só para os testes.
- **Quem usa a conversa trata `null` / estado incompleto como "não sei":**
  - **`sendMessage`:** envio automático em 1:1 → **409** quando:
    - a conversa é `null`;
    - o estado não é exatamente `automation`;
    - a gêmea não é `automation`;
    - deu erro ao ler a gêmea.

    Envio pela tela e para grupo sem conversa → **503 `conversation_unavailable`**, sem enviar.
  - **Webhook da Evolution:** conversa `null` →
    - a mensagem é **gravada** (com `conversation_id` nulo);
    - o estado não é mexido;
    - **não** sai `message.received`;
    - resposta pelo celular sem conversa legível só gera log.
  - **Tela (`/api/conversations/state`):**
    - **GET:** mostra `human` se qualquer uma das gêmeas estiver em `human`; leitura com erro →
      503 (não afirma "automação");
    - **POST "devolver":** retoma as duas;
    - **POST "pausar":** só a conversa da tela.
  - **`PATCH /v1/conversations/{id}`:** `automation` retoma também a gêmea, **mesmo que a
    conversa pedida já esteja em `automation`** (é o caso de ficar preso em 409). A resposta
    continua sendo só a conversa pedida.
  - **Rotas antigas** (`GET /v1/contacts?phone=…`, `GET /v1/messages?phone=`): leitura com erro
    → **503 `conversation_unavailable`** (antes afirmavam `automation`). Na escolha entre gêmeas,
    estado incompleto conta como não-`automation`.
  - **`Chats.jsx`:** o badge zera ao trocar de conversa e só mostra "automação" quando o estado
    lido é `automation`. Sem estado lido, não mostra badge.
- **Contrato e kit do tester** atualizados, incluindo como o n8n deve tratar o 503.

### Comportamento escolhido: gêmea em `human` "por outro motivo"
"Devolver para automação" retoma a gêmea **sempre**, mesmo que ela tenha sido pausada por outro
caminho (atendente pela tela, celular ou API):
- as duas conversas são o **mesmo celular**;
- a ordem de devolver é explícita;
- deixar a gêmea em `human` manteria a automação presa em 409 sem motivo visível.

Cada conversa que muda gera o **seu** `conversation.state_changed` (com o `changed_by` de quem
devolveu: `user` pela tela, `api` pelo PATCH). Se a leitura da gêmea falhar na hora de devolver,
só a conversa pedida é retomada (log); o envio segue em 409 enquanto a gêmea estiver em `human`.
É o lado seguro.

## Como testei
- **Local:**
  - **24/24, banco falso com falhas injetadas:**
    - **`getOrCreateConversation`:**
      - leitura falha com conversa `human` → `null`, **nenhuma escrita**, banco segue `human`;
      - conversa `human` lida → devolve `human`, sem escrita;
      - inexistente → um insert;
      - corrida `23505` → relê e devolve `human`, sem sobrescrever;
      - corrida + releitura falha → `null`;
      - insert com outro erro → `null`.
    - **Os dois cenários pedidos:**
      - **(1)** falha de leitura com a conversa em `human` → **409, nada gravado**;
      - **(2)** própria em `automation` e falha ao ler a gêmea em `human` → **409**.
    - **Mais:**
      - gêmea `human` lida normalmente;
      - falha ao ler a própria com gêmea `human`;
      - as duas `automation` → envia;
      - estado nulo/incompleto na própria e na gêmea → 409.
    - **`resumeAutomation`:**
      - as duas `human` → retoma as duas;
      - própria `automation` + gêmea `human` → retoma a gêmea;
      - sem gêmea;
      - erro ao ler a gêmea → só a própria;
      - gêmea de outra empresa → intocada;
      - tudo em `automation` → nada.
  - **Os 42 testes da E0** continuam passando; `npm run build` ok.
- **Revisor:** aprovado com ressalvas. Duas foram aplicadas antes do commit (badge da tela e o 503
  das rotas antigas); as outras estão nas pendências.
- **Produção** (`eefaf17`; deploy concluído antes dos testes, conferido pelo status de deploy do
  GitHub), **nenhum envio de WhatsApp**:

| Caso | Resultado |
| --- | --- |
| `POST /v1/messages` na conversa "Teste 409" (`human`) | 409 |
| `POST /v1/conversations/{id}/messages` na mesma | 409 |
| Estado / mensagens da "Teste 409" antes → depois | `human` / 0 → `human` / 0 (não alterado) |
| `GET /v1/messages?phone=` da "Teste 409" | `human` |
| `PATCH` "Teste S4b" (fictício, sem gêmea): `human` → `automation` → `automation` de novo | 200 / 200 / 200 sem mudança (`state_since` igual); terminou em `automation` |
| Smoke | **idêntico** ao da E0 |

**Não testado em produção:** retomar com gêmea, porque os 3 pares de gêmeas que existem são de
contatos reais e não mexo neles. Também não testei a falha de leitura, que não dá para provocar
de fora. Os dois casos estão cobertos nos testes locais.

## Pendências
1. **Conferir a unicidade (Agadir, só leitura):** o `23505` pressupõe uma restrição única em
   `conversations(company_id, remote_jid)`. Há evidência indireta forte de que ela existe: o
   upsert antigo usava `onConflict` nela e funcionava. Mesmo assim, o revisor pediu confirmação.
   - **Se não existir:** uma corrida cria linha duplicada; esse contato passa a ficar em
     409/503 (lado seguro, mas não se resolve sozinho).
   - **Consulta para o SQL Editor:**
     ```sql
     select conname, pg_get_constraintdef(oid) from pg_constraint
      where conrelid = 'public.conversations'::regclass and contype in ('u','p');
     ```
2. **`message.received` não olha a gêmea:** uma mensagem que chega pela conversa em
   `automation` vai para o n8n mesmo com a gêmea em `human`. A resposta do n8n leva 409, então
   ninguém é atropelado. Fica para a Parte 2, junto com a fusão das duplicadas.
3. **"Devolver" pela tela cria a conversa do JID normalizado se ela não existir** (já era
   assim), o que aumenta as duplicadas. Fica para a Parte 2.
4. **Webhook:** 2 `conversation.state_changed` (`changed_by: "api"`, `human` e `automation`)
   da "Teste S4b" por volta de 20:43 UTC de 06/10. Conferir no webhook.site.
5. **Roteiro pelo celular da E0** (relatório P1-E0) continua com o Agadir. O passo 2 (devolver)
   agora também confere que o badge volta a "automação".
