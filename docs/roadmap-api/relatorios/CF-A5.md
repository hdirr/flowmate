# CF-A · A5 — Saúde, alertas e tela de saúde (atrás de chaves)

**Status:** código no ar, **tudo desligado**:
- chave `health` (tela) e `health_alerts` (alertas de linha) por empresa, nenhuma ligada;
- variável `OPS_ALERTS=on` (alertas de infraestrutura) não existe.

O que roda sem chave é só o `probe`, só leitura. **SQL:** já aplicado (`ops_alerts`,
`line_sync_state`, `inbound_events`, da CF-A).

## O que mudou
- **`api/_lib/health.js` (novo):**
  - **`lineHealth`** (saúde da linha de uma empresa):
    - status da linha e desde quando; telefone **só com o final**;
    - última mensagem **recebida**;
    - caixa de entrada: aguardando, com falha, esgotaram as tentativas;
    - reconciliação: última execução, recuperadas, erro;
    - alertas abertos;
    - Evolution respondendo, com tempo de resposta.
  - **`probe`:** banco e Evolution respondendo. Sem nenhum dado da empresa.
  - **`evaluateAlerts`:** abre e fecha alertas em `ops_alerts`, no máximo **um aberto** por
    empresa + tipo + assunto (sem spam). Fecha sozinho quando normaliza. Tipos:
    - `line_disconnected`: linha desconectada há mais de 5 min (por empresa com
      `health_alerts`);
    - `dead_events`: evento de entrada na fila de mortos;
    - `write_failing`: evento com falha em 3+ tentativas (gravação falhando);
    - `evolution_down`: Evolution sem resposta em 5 s ou com erro (infra, com `OPS_ALERTS=on`).
  - **Aviso por e-mail** (Resend) dos alertas recém-abertos, se existirem `RESEND_API_KEY` e
    `OPS_ALERT_EMAIL` (e `OPS_ALERT_FROM` opcional). Sem elas, o alerta fica gravado
    (`notified_at` nulo) e o aviso é tentado de novo na próxima rodada.
- **`/api/whatsapp/health` (rota nova no catch-all; continua com 7 funções):**
  - **`GET ?probe=1`** (sem login, para o monitor externo): 200 `{ ok: true }` ou 503
    `{ ok: false, failing: [...] }`. Cache de 30 s, para ninguém martelar a Evolution por aqui.
  - **`GET`** (admin logado): saúde da linha da própria empresa. Chave `health` desligada →
    404 `feature_off`; não-admin → 403.
- **`/api/whatsapp/jobs`:** roda os alertas depois da reconciliação.
- **Tela:**
  - **Configurações → aba "Saúde"** (`src/components/HealthPanel.jsx`): **só aparece se a
    rota responder 200** (admin + chave `health`). Bolinha vermelha quando há alerta aberto;
  - mostra: alertas, linha, última recebida, servidor do WhatsApp, recuperadas e caixa de
    entrada;
  - só leitura.

## Fora (registrado)
- **Disco da Evolution > 70 %:** a Evolution não expõe o disco. Duas saídas, a decidir:
  1. um token da API do Railway, para ler o uso do volume (a confirmar se a API expõe);
  2. uma consulta ao Postgres da Evolution, que pede uma conexão extra.

  Até lá, conferir no painel do Railway.
- **Evolution fora com o Supabase/Vercel também fora:** o agendador cai junto. O aviso externo
  é o monitor (UptimeRobot/BetterStack) batendo no `probe`. Configurar está na A8.

- **Alerta aberto com a chave desligada depois:** se a empresa desligar `health_alerts` com um
  alerta aberto (ou o nome da instância mudar), ele não fecha sozinho e continua na tela até ser
  resolvido à mão (`update ops_alerts set resolved_at = now() where …`). Resolver na CF-B, com a
  linha como entidade.

## Como testei
- **Local:**
  - 19/19, banco, Evolution e e-mail falsos:
    - Evolution ok / 502 / sem resposta (timeout de 5 s);
    - `probe` ok e com banco + Evolution fora;
    - saúde: telefone só com o final, última **recebida** (ignora enviada e outra empresa),
      contagens só da empresa, falha de leitura → 503;
    - alertas: abre os 4 tipos, empresa sem a chave não alerta, 4 e-mails, rodar de novo não
      repete, normalizou → fecha, desconectada há 1 min ainda não alerta, `OPS_ALERTS`
      desligado, e-mail não configurado (fica pendente), `sendAlertEmail` sem variáveis.
  - `npm run build` ok.
- **Produção:** ver o fim deste relatório.

## Para ligar (Agadir)
1. **PARTE 7 do SQL** (agendador): sem ela, os alertas não rodam.
2. **Tela:** `update companies set features = features || '{"health": true}' where id = '…';`
3. **Alertas da linha:** `… '{"health_alerts": true}'`.
4. **Alertas de infraestrutura:** `OPS_ALERTS=on` na Vercel.
5. **E-mail:** `RESEND_API_KEY` e `OPS_ALERT_EMAIL` na Vercel (A8). Redeploy depois das
   variáveis.
6. **Monitor externo:** apontar para
   `https://flowmate-ashy.vercel.app/api/whatsapp/health?probe=1` (esperado 200).
