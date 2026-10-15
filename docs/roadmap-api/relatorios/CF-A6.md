# CF-A · A6 — Fila de envio (atrás da chave `send_queue`)

**Status:** código pronto, **chave `send_queue` desligada** em todas as empresas. Desligada, o
envio é exatamente o de hoje: o bloco pós-envio só virou a função `finishSent`, sem mudança.
**SQL:** `outbound_messages` já existe (CF-A, parte 5).

## O que mudou
- **`api/_lib/outbound.js` (novo):**
  - **`deliver`:** chama a Evolution com tempo limite (15 s; 5 s no reenvio) e **classifica**
    o resultado:
    - aceito → `sent` com o `message_id`;
    - **certeza de que não chegou** → `retry`: erro de rede **antes de conectar** (lista
      fechada: `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `UND_ERR_CONNECT_TIMEOUT`), ou 404
      "Application not found" da borda do Railway;
    - **ambíguo** → `failed` com o prefixo `[ambíguo]`, **sem reenvio**: tempo esgotado, 5xx,
      conexão caída no meio (pode ter saído);
    - recusado (4xx) → `failed`, com a mensagem da Evolution.
  - **`processOutbound`** (reenvio pelo `/jobs`):
    - reenvia os `pending` vencidos (15 s, 30 s, 60 s, 120 s; até 5 tentativas);
    - **confere a pausa de novo** antes de reenviar automação: pausada → `failed`, nada sai;
    - mensagem com **mais de 10 min → `dead`**, nada sai (resposta automática atrasada é pior
      que nenhuma);
    - linha **presa em `sending`** (função interrompida) → `failed`, sem reenvio.
  - **`matchEcho`:** o eco `fromMe` que chega pelo webhook é reconhecido como envio do
    FlowMate se tiver o mesmo `message_id`, ou o mesmo número + texto nos 2 min desde o início
    da última tentativa (a **corrida do eco**: o eco chegou antes de o envio ser gravado). A
    linha vira `sent`. **Acaba a pausa falsa.**
    - Por texto, **só casa o que pode ter saído**: `sending` ou `failed` ambíguo.
    - `pending` (certeza de que não saiu) e `failed` recusado **nunca** casam. Senão, se o dono
      reenviasse pelo celular o mesmo texto de uma mensagem que deu "Não enviada", a conversa
      não pausaria.
- **`sendMessage`** (com a chave ligada):
  - grava em `outbound_messages` **antes** de chamar a Evolution; se não conseguir gravar →
    503, nada enviado;
  - **`Idempotency-Key`:** a mesma chave devolve o resultado do primeiro envio e não envia de
    novo (conferida antes da pausa). **Validada só com a fila ligada**: desligada, o header é
    ignorado, como sempre foi (nada muda para quem já integra);
  - respostas `200`/`202`/`502`/`503`, com `outbound_id` e `delivery`. Ver o contrato.
- **Webhook (legado e caixa de entrada):** "envio do FlowMate" passa a considerar também a fila
  (`matchEcho`). Com a chave desligada, a fila está vazia: nada muda, só 1–2 leituras a mais por
  mensagem `fromMe` desconhecida.
- **`/v1`:**
  - header `Idempotency-Key` em `POST /v1/messages` e `POST /v1/conversations/{id}/messages`;
  - campos `outbound_id`/`delivery` e status 202, **só com a fila ligada**;
  - **rota nova `GET /v1/outbound-messages/{id}`**, só da própria empresa.
- **`/jobs`:** reenvio da fila (caixa de entrada 4 s, fila até 6 s, reconciliação e alertas até
  8 s).
- **Tela (Chats):** envios pendentes ou com falha da conversa aberta (últimas 24 h) aparecem
  acima do campo de mensagem ("Enviando…", "Tentando de novo…", "Não enviada · motivo"). Lê
  pela RLS (só a própria empresa). Sem a fila, nada aparece.
- **Contrato e kit do tester:** seção da fila de envio (vale quando ligada).

## Como testei
- **Local: 32/32**, banco e Evolution falsos (inclui as correções da revisão: conexão caída no
  meio → ambíguo, DNS → reenvia; eco não casa com `pending` nem com recusado, casa com
  ambíguo; janela pela última tentativa; prefixo `[ambíguo]`):
  - **classificação:**
    - 200;
    - rede → reenvia;
    - tempo esgotado → **não** reenvia;
    - Railway fora → reenvia;
    - 500 → não reenvia;
    - 400 com a mensagem.
  - **fila:**
    - enviada;
    - **mesma `Idempotency-Key` → não envia de novo**;
    - Evolution fora → 202 `pending`;
    - ambíguo → 502 `failed`, sem log de mensagem;
    - não registrou → 503, **nada enviado**.
  - **processador:**
    - reenvia o vencido;
    - **+10 min → `dead`**;
    - **pausada → não envia**;
    - envio humano não olha a pausa;
    - ainda não venceu;
    - preso em `sending` → `failed`.
  - **eco:**
    - mesmo `message_id`;
    - **corrida do eco (casa por número + texto e marca `sent`)**;
    - mais de 2 min não casa (é o dono no celular);
    - outra empresa não conta;
    - erro de leitura → desconhecido.
- **Não testado em unidade:** a validação da `Idempotency-Key` só com a fila ligada (depende
  da leitura da chave; código simples em `sendMessage`).
- **Regressões:** caixa de entrada 35/35, A2 5/5, reconciliação 24/24, saúde 19/19, E0b 24/24,
  E0 42/42. `npm run build` ok.
- **Produção:** ver o fim deste relatório.

## Para ligar (Agadir, depois da PARTE 7)
`update companies set features = features || '{"send_queue": true}' where id = '…';`
Primeiro teste: um envio pela tela para o número dele → `outbound_messages` com `sent` e
`message_id`; a conversa **não** pausa pelo eco.

## Limites conhecidos
- **Eco de mídia sem legenda:** não casa por texto (o webhook grava `[imagem]`, a fila grava
  vazio). Casa pelo `message_id` no caso normal.
- **Envio ambíguo (tempo esgotado):** fica `failed`. Se tiver saído, o eco o marca `sent`; se
  não, alguém decide reenviar.
- **Envio humano em `pending`:** não pausa a conversa nem cancela o reenvio. Se o dono reenviar
  o mesmo texto pelo celular enquanto ele está pendente, o cliente pode receber duas vezes
  (pouco provável; o envio automático não sofre isso porque cai na pausa).
- **"Executar agora" e automações da tela** continuam ignorando o resultado do envio (Parte 2,
  bloco 16).
