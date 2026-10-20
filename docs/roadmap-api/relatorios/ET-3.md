# ET-3 — A trava vira etiqueta (chave `labels`) + trava opcional `block_api_send_on_human`

**Status:** no ar. Vale em toda empresa com a chave `labels` ligada. Hoje é **só a empresa do
Agadir**, que ficou **sem trava** porque a `block_api_send_on_human` está ausente (desligada).
Nas demais empresas nada muda. **SQL:** nenhum (usa `companies.features` e as funções e gatilhos
da CF-A PARTE 6).

## Regra
| `labels` | `block_api_send_on_human` | Envio automático em "Atendimento humano" (na conversa ou na gêmea) |
| --- | --- | --- |
| desligada | — | 409 (como sempre) |
| ligada | desligada (padrão) | **envia** |
| ligada | ligada | 409 (como antes, inclusive a gêmea) |

- **Fonte única:** `automationBlockedByHuman` (`api/_lib/features.js`). Erro ao ler as chaves →
  `{}` → trava (o lado seguro).
- **Vale em todo envio automático:**
  - `sendMessage` (`POST /v1/messages` e automações da tela);
  - a checagem própria do `POST /v1/conversations/{id}/messages`;
  - o reenvio da fila (`retryOutbound`).
- **Envio pela tela (atendente):** nunca é bloqueado (já era assim).

## Marcação (com a chave `labels`)
- **Atendente envia pela tela** (`finishSent`) ou **o dono responde pelo celular** (caixa durável
  e caminho antigo): "Atendimento humano" na conversa **e na gêmea** (`markTwinHuman`).
  - Pelo celular: mesma regra R5 da A1 (não desfaz um "devolver" feito depois da mensagem).
  - Erro ao marcar a gêmea só vai para o log; nunca derruba o recebimento.
- **"Devolver p/ automação":** já retomava a gêmea (E0b).
- **Sem a chave:** igual a antes (a gêmea só conta no 409 e no "devolver").

## `message.received`
- **Com `labels`:** sai **sempre** (1:1, mensagem do cliente), também em "Atendimento humano",
  com `state` e `labels` no payload.
  - Caixa durável: se a leitura das etiquetas falhar, lança erro e o evento é tentado de novo.
  - Caminho antigo: sai com `labels: null`.
- **Sem `labels`:** o payload e a regra são os mesmos de antes.

## Compatibilidade
- **`state`** nas respostas de Conversa (com `labels`): **derivado da etiqueta de sistema**. Sem
  etiqueta de sistema (grupo), vale a coluna.
- **`PATCH /v1/conversations/{id}` com `state`:** continua.
- **Catálogo:** a descrição do `message.received` foi atualizada.

## Tela
Em **Configurações → Etiquetas**, o interruptor **"Bloquear envio da automação em conversas com
Atendimento humano"**:
- texto explicando o risco de desligar e confirmação ao desligar;
- **só o admin altera**; os demais veem desabilitado;
- rota da tela `label-settings` (GET lê; POST só admin, 403 para os demais), que grava
  `companies.features` mantendo as outras chaves;
- vale na hora na instância que gravou e em até 30 s nas outras (cache da chave).

## Limites conhecidos (revisor)
- **Interruptor:** grava o `features` inteiro (lê, junta e grava). Uma mudança em outra chave
  feita no mesmo instante, por exemplo por SQL, pode se perder. A janela é de milissegundos e a
  gravação é rara. A solução definitiva é uma função no banco (`features || …`), junto com o
  próximo SQL.
- **Caixa durável:** se a leitura das etiquetas falhar sempre, o `message.received` daquela
  mensagem se perde depois das tentativas. A mensagem fica gravada (o insert vem antes) e não sai
  duplicada (`event_id` fixo).
- **`state` da resposta × trava:** o `state` é o da própria conversa; a trava olha também a
  gêmea. Está registrado no contrato.

## Como testei
- **Local (ET-3): 32/32**, com banco falso:
  - **chave desligada:** humano → 409; gêmea humana → 409;
  - **`labels` ligada, sem trava:** humano ou gêmea → envia, e a etiqueta continua;
  - **trava ligada:** humano ou gêmea → 409;
  - **leitura das chaves falhou** → 409;
  - **atendente nunca é bloqueado.** Com `labels`, o envio dele marca a conversa e a gêmea; sem
    `labels`, não mexe na gêmea;
  - **celular:**
    - caixa durável e caminho antigo: conversa e gêmea humanas;
    - `labels_updated` com `source: phone`;
    - sem `labels`: só a própria conversa;
  - **`message.received`:**
    - em humano, com `labels` e `state`;
    - sem `labels`: não sai em humano e o payload é igual ao de antes;
  - **`POST /v1/conversations/{id}/messages`:** em humano → 200 sem trava, 409 com trava;
  - **`state`:** o `PATCH` mantém compatibilidade, e o `state` da resposta vem da etiqueta;
  - **interruptor:** vendedor lê mas não altera (403); admin altera e mantém as outras chaves; o
    envio passa a dar 409; valor inválido → 400; sem `labels` → 404.
- **Regressões:**

  | Teste | Resultado |
  | --- | --- |
  | Etiquetas | 101/101 |
  | E0b | 24/24 |
  | E0 | 42/42 |
  | A1 | 35/35 |
  | A2 | 5/5 |
  | A4 | 24/24 |
  | A5 | 19/19 |
  | A6 | 32/32 |
  | `npm run build` | ok |
- **Não testado:** o reenvio da fila com `labels` (a fila está desligada em todas as empresas;
  a regra é a mesma função) e o envio real pelo WhatsApp (o roteiro abaixo cobre).

## SQL (Agadir)
Deixar a trava **desligada** na empresa dele (estado inicial explícito):
```sql
update companies set features = features || '{"block_api_send_on_human": false}' where id = '<id-da-empresa>';
```
Ligar a trava (volta o 409; também pela tela):
```sql
update companies set features = features || '{"block_api_send_on_human": true}' where id = '<id-da-empresa>';
```

## Roteiro de teste (empresa do Agadir; envio real só para o número dele)
1. **Configurações → Etiquetas:** o interruptor aparece desligado. Ligar e desligar pede
   confirmação ao desligar.
2. **Responda pelo celular** na conversa de teste. No Chats, o cabeçalho mostra "Atendimento
   humano".
3. **Envio automático com a trava desligada:** `POST /v1/conversations/{id}/messages` (ou
   `/v1/messages`) → **200**, e a mensagem chega no celular.
4. **Mande uma mensagem do celular do cliente.** O webhook recebe `message.received` com
   `state: "human"` e `labels` contendo "Atendimento humano".
5. **Ligue a trava** e repita o passo 3 → **409 `conversation_paused`**. Desligue de novo.
6. **"Devolver p/ automação":** a etiqueta passa a "Atendimento IA" na conversa e na gêmea.

## Produção (`9d14901`, deploy confirmado pelo status do GitHub)
| Caso | Resultado |
| --- | --- |
| Smoke | **idêntico** (não envia mensagem) |
| `GET /v1/conversations/{id}` da conversa de teste (em humano) | `state: "human"` + etiqueta "Atendimento humano" |
| `/api/conversations/label-settings` e `/state` sem login | 401 / 401 |
| `GET /v1/webhook-events` | descrição nova do `message.received` |
| Envio real e `message.received` | envio real: ver "Teste com envio real" abaixo; `message.received`: pendente |

## Teste com envio real (2026-10-20, empresa do Agadir; só a conversa "Teste 409", autorizado)
Conversa em "Atendimento humano" nos três testes. Conferência pelo histórico
(`GET /v1/conversations/{id}/messages`).
| Teste | Como | Resultado |
| --- | --- | --- |
| **a)** trava desligada | 1 envio pela API (`POST /v1/conversations/{id}/messages`) | **200**, sem 409; mensagem no histórico com `sender: automation`; etiqueta continuou "Atendimento humano" |
| **b)** trava ligada (pelo interruptor da tela, pelo Agadir) | 1 envio pela API, 35 s depois de ligar (cache da chave) | **409 `conversation_paused`**; nada enviado (a mensagem não está no histórico); etiqueta igual |
| **c)** trava ligada | o Agadir enviou pela tela de Chats | **saiu normalmente** (`sender: human` no histórico): envio pela tela nunca é bloqueado |

Depois do teste c, o Agadir desligou a trava pela tela. Estado final: `labels` ligada e
`block_api_send_on_human` desligada.

**Pendente:** conferir o `message.received` com `state` e `labels` em "Atendimento humano". A URL
de webhook da empresa (webhook.site) expirou; conferir quando o Agadir trocar a URL em
Configurações → Integrações.

**Limpeza:** as mensagens "Teste FlowMate ET-3 (a)" e "(c)" na conversa "Teste 409".
