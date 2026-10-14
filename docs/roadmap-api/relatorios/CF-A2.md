# CF-A · A2 — Idempotência por empresa: (company_id, message_id) em todo caminho

**Status:** código pronto para o deploy (sem chave: vale para todos). Enquanto o índice global
existir, o efeito é o mesmo de hoje: as mensagens ocupadas por outra empresa continuam sendo
puladas. O sync, se a chave global barrar um lote, grava linha a linha. **SQL de contração:** `supabase_cf_a2_drop_global.sql`,
para o Agadir rodar **depois** do deploy.
**Prioridade:** resolver antes de o tester externo conectar o número dele.

## Situação confirmada no banco (PARTE 0, 13/10)
- `whatsapp_messages_message_id_idx`: **único global** em `message_id`
  (`WHERE message_id IS NOT NULL`). É a "chave global" do diagnóstico.
- `whatsapp_messages_company_message_uniq` em `(company_id, message_id)`: criado na PARTE 3.
- Hoje: **0** `message_id` repetidos dentro da empresa e **0** em mais de uma empresa.

**Efeito da chave global:** quando duas empresas veem a mesma mensagem (uma escreve para a
outra, ou estão no mesmo grupo), **a segunda perde a mensagem**. Além disso, o
`isKnownOutgoing` global fazia a resposta pelo celular da segunda empresa **não pausar**.

## O que mudou (código)
| Caminho | Antes | Agora |
| --- | --- | --- |
| Webhook legado: deduplicação | `message_id` em qualquer empresa | **empresa + `message_id`** |
| Webhook legado: "envio conhecido" (`isKnownOutgoing`) | global | **por empresa** (e o cliente do banco é o mesmo do webhook) |
| Caixa de entrada (A1) | já por empresa; 23505 só conta como "gravada" se a linha for da empresa | sem mudança |
| Reconciliação (A4) | `onConflict company_id,message_id`, com recurso linha a linha se a chave global barrar | sem mudança |
| Sync ("Importar conversas") | `upsert onConflict 'message_id'` (dependia da chave global) e erro ignorado | **`onConflict 'company_id,message_id'`**; se a chave global barrar o lote (23505), grava linha a linha e pula só as ocupadas; outros erros vão para o log |
| Envio (`sendMessage`) | `insert` com o id que a Evolution devolve | sem mudança (o id é novo; a fila de envio da A6 trata o resto) |
| Mídia (`/api/whatsapp/media`) | já filtrava por empresa | sem mudança |

**Enquanto o índice global existir**, a perda da segunda empresa continua: o banco recusa. O
código já está pronto para quando o SQL tirar o índice.

## Como testei
- **Local:**
  - **5/5, cenário de duas empresas:**
    - legado sem índice global: B grava a mensagem que A já tem;
    - B respondeu pelo celular com id que A conhece → **B pausa** (antes não pausava);
    - com o índice global, B ainda perde (só resolve com o SQL);
    - reenvio na mesma empresa continua deduplicado;
    - caixa de entrada grava para B.
  - **Regressões:** caixa de entrada 35/35, reconciliação 24/24, E0b 24/24.
  - **Não testado em unidade:** o recurso linha a linha do sync (código dentro da rota; o
    mesmo recurso da reconciliação tem teste). Some quando o SQL tirar o índice global: por isso
    o SQL logo depois do deploy.
- **Produção:** smoke e "Importar conversas" (ver o fim deste relatório).

## Ordem para o Agadir
1. Este commit no ar (eu confirmo pelo deploy + smoke).
2. Rodar `supabase_cf_a2_drop_global.sql`: conferências C1–C3, a remoção, depois a C4.
3. Clicar em "Importar conversas" uma vez e conferir que as conversas continuam lá.
4. **Rollback:** está no arquivo. Só funciona enquanto nenhuma mensagem se repetir entre
   empresas. Depois do SQL, **não** reverter o código para antes deste commit sem recriar o
   índice.

## Produção (`1b82530`, deploy confirmado pelo status do GitHub)
| Caso | Resultado |
| --- | --- |
| Webhook com instância inexistente | 200, ignorado (nada gravado) |
| `POST /api/whatsapp/jobs` / `POST /api/whatsapp/sync` sem login | 503 / 401 (como antes) |
| Smoke | idêntico, exceto 1.3, que agora mostra a mensagem que o Agadir mandou **pela tela de Chats** (`sender: human`) na conversa "Teste 409": confirma que o envio pela tela grava na mesma conversa. Nova base |
| "Importar conversas" | precisa de login na tela: fica no roteiro do Agadir, depois do SQL |

## Concluída (Agadir, 14/10)
SQL `supabase_cf_a2_drop_global.sql` rodado em produção:
- **Antes:** chave por empresa válida e única (1), chave global existia (1), repetidos na
  empresa 0.
- **`drop index whatsapp_messages_message_id_idx`:** sem erro.
- **Depois (C4):** só `whatsapp_messages_company_message_uniq` existe.
- **"Importar conversas"** na tela: importou normalmente e as conversas continuam lá.

**Chave global removida; isolamento de mensagens por empresa ativo.** Os recursos "linha a
linha" (sync, reconciliação) e a conferência do 23505 da caixa de entrada continuam no código,
inofensivos; podem sair numa limpeza futura.
