# CF-A · A1/A2/A3 — Caixa de entrada durável (código atrás da chave)

**Status:** código no ar, **chave `inbound_inbox` desligada** (nenhuma empresa usa ainda).
Depende do SQL (`supabase_cf_a.sql`, partes 1, 2, 3 e 7), que o Agadir ainda não rodou.
**Plano:** `PLANO-CONFIABILIDADE.md`.

## O que mudou
- **`api/_lib/inbound.js` (novo):**
  - **Caminho legado** (`handleIncomingMessageLegacy`): é o corpo do laço que estava em
    `handleWebhook`, **movido sem mudança de lógica**. Comparação mecânica do texto: a única
    diferença é `continue` → `return`.
  - **Caminho novo** (chave `inbound_inbox` ligada):
    1. `acceptWebhook` grava cada evento cru em `inbound_events` **antes** de processar (um
       `messages.upsert` com N mensagens = N linhas). Um reenvio da Evolution não duplica (chave
       única empresa + instância + evento + `message_id`). Não conseguiu gravar → **503**, e a
       Evolution reenvia (até 10 vezes em ≈ 20 min).
    2. Processa em seguida. Falha → `failed`, com nova tentativa em 30 s, 1, 2, 4… min (teto
       1 h); na 8ª → `dead` (fila de mortos). **Nunca descarta.**
    3. **`processIncomingMessage`, idempotente:**
       - já gravada (23505) = sucesso, mas **só se a linha for desta empresa** (R1);
       - `message.received` sai com **`event_id` fixo** (o id do evento de entrada): nas
         repetições o n8n deduplica;
       - "envio do FlowMate" = linha com `sender` preenchido, filtrada por empresa (o
         reprocessamento de uma resposta pelo celular não se confunde com eco);
       - pausa não gravada → erro → nova tentativa (R3);
       - resposta do celular reprocessada tarde **não** desfaz um "devolver" feito depois dela
         (R5). Só vale quando houve troca de estado explícita: conversa nova puxada pelo celular
         sempre pausa, e timestamp inválido também pausa (na dúvida, pausa).
- **`api/_lib/features.js` (novo):** leitura defensiva das chaves (`companies.features`). Coluna
  ausente ou erro = desligada. Cache de 30 s.
- **`api/_lib/whatsappParse.js` (novo):** o parser de mensagem, movido sem mudança.
- **`api/_lib/webhooks.js`:** `dispatchWebhook(…, { eventId })` opcional. Sem ele, um id novo,
  como sempre.
- **`api/_lib/conversations.js`:** `setConversationState` devolve `{ error }` quando o update
  falha. Quem já chamava ignora o retorno. Efeito colateral bom: nesse caso o
  `conversation.state_changed` não sai mais anunciando uma mudança que não aconteceu.
- **`api/whatsapp/[...path].js`:**
  - o webhook usa as funções acima; com a chave ligada, vai para a caixa de entrada;
  - **rota nova `POST /api/whatsapp/jobs`** (processador da A3): header `x-jobs-secret` =
    `JOBS_SECRET` (comparação em tempo constante; sem a variável → 503; segredo errado → 401;
    GET → 405). Reprocessa até 50 eventos, com prazo de 8 s. Limpa os concluídos com mais de 30
    dias, no máximo 1 vez por hora.
  - Continua com 7 funções.

## Como testei
- **Local:**
  - **35/35**, banco falso:
    - linhas por evento;
    - grava + `event_id` fixo;
    - reenvio sem duplicar;
    - mesmo `message_id` em outra empresa;
    - pausa pelo celular;
    - reprocessar pausa;
    - eco do FlowMate não pausa;
    - conversa em `human` sem evento;
    - conversa ilegível → nova tentativa;
    - insert com erro → sem evento;
    - leitura de "envio conhecido" com erro → nova tentativa;
    - R1 (índice global);
    - R3;
    - R5 antes/depois, conversa nova puxada pelo celular (pausa) e timestamp inválido (pausa);
    - 503 sem gravar;
    - `failed` + espera;
    - processador conclui;
    - `dead` na 8ª;
    - prazo esgotado devolve sem gastar tentativa;
    - `connection.update`;
    - limpeza.
  - **Testes anteriores:** E0 42/42 e E0b 24/24 continuam passando.
- **Revisor:** aprovado com ressalvas. As que afetam perda (R1, R3, R5, R6, contagem de
  tentativas) foram corrigidas antes do commit.
- **Produção:** ver "Produção" no fim deste relatório.

## Antes de ligar `inbound_inbox` em qualquer empresa
1. Rodar as partes 1, 2 e 3 do SQL. **A parte 3 (chave única por empresa) é pré-requisito**:
   sem ela, um reprocessamento duplicaria a linha da mensagem (R2).
2. Criar `JOBS_SECRET` na Vercel e rodar a parte 7 (agendador).
3. Confirmar o limite de duração das funções no plano da Vercel (R6).
4. Ligar primeiro só na empresa do Agadir:
   `update companies set features = features || '{"inbound_inbox": true}' where id = '…'`.
   Desligar: `features - 'inbound_inbox'`.

## Pendências conhecidas (registradas, não bloqueiam)
- **`message.received` não tem nova tentativa** se o n8n estiver fora (bloco 3 da Parte 2 = C3).
- **Corrida do eco do envio** (anterior a este trabalho): resolve na A6.
- **Entrada pelos dois caminhos:** se a leitura das chaves falhar por um instante com a chave ligada, um
  reenvio da Evolution pode entrar pelos dois caminhos (`message.received` repetido com outro
  `event_id`). Raro; somem quando o legado for removido (contração da CF-A).

## Produção (`b5827f4`, deploy confirmado pelo status do GitHub)
| Caso | Resultado |
| --- | --- |
| `GET /api/whatsapp/jobs` | 405 |
| `POST /api/whatsapp/jobs` (sem `JOBS_SECRET` na Vercel) | 503 `jobs_not_configured` |
| Webhook com instância inexistente (sem prefixo `flowmate-`) | 200, ignorado (caminho legado, nada gravado) |
| Smoke | idêntico, exceto 1.2/1.3, que mudaram por causa do **envio real da E7 de hoje** (nova mensagem e novo `state_since` da conversa "Teste 409"). Nova base do smoke |
