# CF-A · A4 — Reconciliação por linha (código atrás da chave)

**Status:** código no ar, **chave `reconcile` desligada** (nenhuma empresa).
Depende do SQL (`supabase_cf_a.sql`: parte 3, chave única por empresa; parte 4,
`line_sync_state`; parte 7, agendador). **Plano:** `PLANO-CONFIABILIDADE.md`, A4.

## O que mudou
- **`api/_lib/reconcile.js` (novo):**
  - **Quando roda:** a cada execução do processador (`/api/whatsapp/jobs`), para cada empresa
    com a chave `reconcile` e instância conectada.
  - **Janela:**
    - pede à Evolution as mensagens de uma janela de **30 min**, começando **10 min antes**
      do marcador (sobreposição);
    - nunca mais perto de agora que **2 min** (o webhook normal tem a vez) e nunca antes de
      7 dias;
    - na primeira vez, começa 24 h atrás.
  - **Gravação:**
    - grava só as que faltam, com a conversa vinculada;
    - upsert em `(company_id, message_id)`: idempotente.
  - **Marcador:** `line_sync_state.reconciled_until` só avança quando a janela inteira foi
    conferida. Em erro ou sem tempo, não avança e o erro fica registrado. **Nunca pula
    buraco.**
  - **Só grava:**
    - não muda o estado da conversa;
    - **não** dispara `message.received`: uma mensagem recuperada horas depois não deve gerar
      resposta automática atrasada;
    - conta as recuperadas (`last_recovered`, `recovered_total`) para a tela de saúde (A5).
  - **Pede as páginas por `offset`** (a Evolution 2.3.7 ignora `limit`; ver o diagnóstico).
  - **Freio:** se a Evolution ignorar o filtro de data, para quando a página trouxer mensagem
    anterior ao início da janela (a prova de que o filtro foi ignorado), **só se a página
    estiver em ordem decrescente**. Em ordem crescente ou misturada, segue paginando: mais
    caro, mas não pula buraco.
  - **Chave única global de `message_id` (de hoje):** se ela barrar o lote (mensagem de outra
    empresa, ex.: mesmo grupo), grava linha a linha e conta as "ocupadas" (log), sem travar a
    janela.
  - **Marcador ilegível:** se a leitura do marcador falhar, pula a linha nesta rodada (não
    recomeça do zero nem zera o total). Erro ao gravar o marcador fica registrado.
  - **Conversa nova:** quando a mensagem recuperada é de um número sem conversa, a conversa é
    criada em `automation`, como o webhook faria. Nada é disparado.
  - Ignora `@broadcast`/`@newsletter` e mensagens sem conteúdo (reações etc.), como o sync.
- **`/api/whatsapp/jobs`:** chama a reconciliação depois da caixa de entrada. Prazo total de
  8 s: a caixa de entrada passou a ter **5 s** (antes 8 s), o que reduz a vazão quando houver
  fila. O JSON de resposta ganhou o campo `reconcile`.

## Como testei
- **Local:** 24/24, banco e Evolution falsos:
  - janelas (primeira vez, sobreposição, perto de agora, em dia, teto de 7 dias);
  - linha a partir do registro;
  - grava só o que falta e vincula a conversa;
  - página por `offset`;
  - idempotente;
  - 250 mensagens em 3 páginas;
  - filtro ignorado não grava fora da janela;
  - freio com 1000 mensagens para na 2ª página;
  - sem tempo não avança;
  - erro da Evolution;
  - só empresas com a chave;
  - marcador e total acumulado;
  - linha desconectada pula;
  - erro não avança o marcador;
  - chave global barra o lote → linha a linha (grava a que pode, conta a ocupada);
  - ordem crescente com filtro ignorado não freia;
  - marcador ilegível pula a linha sem zerar o total.
- **Produção** (`0886bb9`): `GET /jobs` 405; `POST /jobs` 503 `jobs_not_configured` (sem
  `JOBS_SECRET`, nada roda até o agendador existir); **smoke idêntico** à base nova da CF-A1.

## A confirmar antes de ligar
- **Formato do filtro de data** aceito pela Evolution 2.3.7 em `where.messageTimestamp` (o
  código manda data ISO; a fonte converte data → segundos). **Risco de buraco silencioso:** se a
  Evolution entender errado e devolver lista vazia, a janela passa como conferida.
- **Primeiro teste** (empresa do Agadir): numa janela que sabidamente tem mensagens, a Evolution
  precisa devolver registros, e a contagem precisa bater com a de `whatsapp_messages` da mesma
  janela. Não basta ver `last_error` vazio.
- **Ordem decrescente** do `findMessages` na 2.3.7 (`orderBy messageTimestamp desc`, pela fonte).

## Fora desta etapa (registrado)
- O "Importar conversas" e a rolagem do histórico ainda mandam `limit`. Trocar para `offset`
  muda o número de mensagens que a tela recebe, então fica para uma etapa própria, com teste
  na tela.
