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

## Produção (`366dbd3`, deploy confirmado pelo status do GitHub)
| Caso | Resultado |
| --- | --- |
| `GET /api/whatsapp/health?probe=1` | **200** `{ ok: true, failing: [] }` (banco e Evolution respondendo) |
| `GET /api/whatsapp/health` sem login | 401 |
| `POST /api/whatsapp/health` | 405 |
| `POST /api/whatsapp/jobs` (sem `JOBS_SECRET`) | 503 |
| Smoke | idêntico |

## Alerta `line_silent` — linha conectada que parou de receber (2026-11-04)
**Por quê:** em 04/11 a linha ficou `open`/`connected`, mas a Evolution não guardou nenhuma mensagem
recebida depois das 07:08 BRT. O `line_disconnected` não pega esse caso. A causa do travamento
ainda está em investigação; este alerta só detecta.

**Critério** (`evaluateSilence`, em `api/_lib/health.js`; empresas com a chave `health_alerts`):
- linha com status `connected` e silêncio de mensagens **recebidas** (`whatsapp_messages`,
  `from_me = false`, só da empresa);
- o silêncio só conta na janela **08:00–20:00 BRT, segunda a sábado**;
- só vale para linha com mensagem recebida na janela em **3+ dos 7 dias completos anteriores à
  última recebida** (os dias mortos não entram na conta);
- limite = maior entre **60 min** e **4 × o intervalo médio** entre recebidas na janela desses
  dias, com **teto de 4 h**;
- alerta novo só abre dentro da janela.

**Comportamento:**
- abre um alerta por linha e **só fecha quando chega mensagem com hora posterior à abertura** ou quando a linha fica
  desconectada por mais de 5 min (aí vale o `line_disconnected`). Queda breve não mexe nele;
- passada a noite ou o domingo, o alerta continua aberto;
- **diagnóstico no `detail`, só na abertura:** procura a recebida mais nova nas 20 últimas mensagens da Evolution
  (`chat/findMessages`, limite de 5 s). Mais nova que a do FlowMate (com folga de 60 s) =
  "provável webhook/entrega"; se não = "provável sessão do WhatsApp travada". Evolution sem
  responder, ou sem recebidas para comparar, = "causa não verificada", e o alerta abre mesmo assim. A v2.3.7 ignora o filtro
  `fromMe:false`, por isso o filtro é feito no código;
- erro ao ler `whatsapp_messages`: o alerta fica como está e os demais seguem;
- aparece na aba Saúde e no e-mail, como os outros. **Sem SQL** (`kind` é texto livre).

**Custo:** o caminho comum é 2 leituras por rodada. As 6 contagens só rodam dentro da janela, depois
de 60 min de silêncio e sem alerta aberto. A Evolution só é consultada na abertura, com prazo no
`/jobs` (depois dele, "causa não verificada", para sobrar tempo ao e-mail).

**Limites conhecidos** (calibrar com uma semana real antes de ligar em cliente):
- **sábado e feriado:** empresa que não abre nesses dias e tem movimento pode gerar alerta, porque a
  base é única para a semana;
- **abertura da manhã:** o silêncio soma o fim do dia anterior, então linha movimentada pode alertar
  desde as 08:00 se nada chegou desde a noite anterior, mesmo que o expediente comece depois;
- **rajadas:** a média usa as 12 h inteiras; linha concentrada de manhã pode estourar à tarde;
- **sem cobertura:** linha com menos de 3 dias ativos não alerta, e a detecção pode levar até 4 h de
  janela;
- **mensagem atrasada não fecha:** a comparação usa a hora da mensagem. Recuperada (fila da sessão
  que voltou, reconciliação) com hora anterior à abertura deixa o alerta aberto até chegar uma mais
  nova, o que em linha lenta pode levar horas. Sem alerta aberto, a reconciliação pode impedir a
  abertura e esconder um webhook quebrado;
- **diagnóstico congelado:** a causa é a vista na abertura. Se a Evolution não respondeu naquela hora,
  fica "causa não verificada" até o alerta fechar;
- **prazo do job:** o `deadline` protege só o diagnóstico. O limite da função na Vercel segue a
  confirmar; confirmar antes de estender `health_alerts` a outras empresas, para o e-mail ter tempo;
- linha que volta depois de dias desconectada pode alertar logo ao reconectar, porque o silêncio
  conta desde a última recebida;
- mensagem recebida em grupo conta como recebida (o que importa é a sessão estar viva);
- o diagnóstico olha só as 20 últimas mensagens da Evolution: se os envios esconderem todas as
  recebidas, sai "causa não verificada";
- **não reinicia nada sozinho.** Fica para quando o alerta tiver se mostrado confiável.

**Para funcionar:** chave `health_alerts` na empresa + agendador rodando (`JOBS_SECRET` e PARTE 7 do
`supabase_cf_a.sql`). Em 04/11, `POST /api/whatsapp/jobs` ainda respondia 503 (sem `JOBS_SECRET`).

**Testes locais: 46/46**, com banco e Evolution falsos:
- janela e limite;
- caso real: última recebida 07:08 em dia útil, às 08:59 não alerta e às 09:00 alerta;
- alerta único, fechamento só com mensagem (segue aberto dias depois, sem novas leituras);
- os três diagnósticos e a Evolution com erro, lançando exceção ou pendurada;
- madrugada, domingo, pouco movimento e sem a chave não alertam;
- outra empresa e mensagem enviada não contam;
- falha de leitura;
- os alertas antigos (`line_disconnected`, `dead_events`, `write_failing`) e o e-mail sem repetir.

Build ok. As suítes A1–A6 antigas não existem mais na pasta temporária; o diff só toca o
`health.js`, o rótulo da tela e 1 linha do `/jobs` (o `deadline`). **Não testado:** em produção com a chave ligada.
