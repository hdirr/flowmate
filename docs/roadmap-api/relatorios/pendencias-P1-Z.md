# Pendências acumuladas para a P1-Z

Lista única do que os relatórios deixaram para a documentação final da Parte 1 (P1-Z).
Cada item cita o relatório de origem.

## Documentar no `INTEGRATIONS.md`
- **Chave:** `x-api-key` e `Authorization: Bearer` não devem ser enviados juntos. Vale o
  primeiro preenchido, na ordem `x-api-key` → `Bearer` → `?key=`. (P1-B2)
- **Bearer:** o Bearer da /v1 é a chave da integração, não o JWT do Supabase. (P1-B2)
- **Valor do lead:** `value` vem 0 até a Parte 2 (bloco 1). A coluna existe, mas o app ainda não
  mostra nem edita. (P1-L3)
- **Campos personalizados:** os valores de `fields` chegam como texto, inclusive em campo
  `number` (a tela grava string). (P1-00c)
- **Automações:** ações feitas pela API não disparam as automações da tela. Os webhooks disparam
  normalmente. (`14`)
- **Conversas:** `updated_at` de conversa = "última mudança de estado", não "última mensagem".
  O texto também vai para o `20-contrato-api-v1.md` no commit da P1-L6. (resposta do tutor à P1-00)
- **Eventos:** empresa com nenhum evento marcado recebe todos, inclusive os criados depois.
  (`15`)

## Corrigir no `HANDOFF.md`
- `supabase_whatsapp_cache.sql` **foi** rodada (`whatsapp_instances.updated_at` existe, com
  gatilho). (P1-00)
- Não existem colunas `asaas_*` em `companies`. (P1-00)
- `supabase_abacate.sql` rodada (colunas `abacate_*` existem). (P1-00)
- `ABACATEPAY_WEBHOOK_SECRET` está configurada na Vercel. (P1-S1)
- Trava de assinatura agora fecha com status desconhecido; Onboarding só orienta a assinar.
  (P1-S2)

## Segurança (fora da P1-Z, mas registrar no HANDOFF)
- **Chave da Evolution fraca, troca agendada com o Agadir.** P1-S3 e P1-W2 bloqueadas até a
  troca de `EVOLUTION_API_KEY` e a criação do `WEBHOOK_SECRET`. (P1-S5)
- **Fim da Parte 1:** o Agadir troca o `VERCEL_BYPASS_TOKEN` (Vercel → Deployment Protection →
  Protection Bypass for Automation) junto com as outras chaves. (P1-B3)
- **Fim da Parte 1:** o Agadir regenera a chave de teste da API e atualiza `FLOWMATE_TEST_KEY`;
  limpar de novo o allowlist (`.claude/settings.local.json`) se aparecer algum valor. (P1-S6)

## Lista de limpeza (dados de teste)
- Campo personalizado `Teste API` e os campos `Nome Faixada`, `ID`, `Nascimento`, `Opcão`.
  (P1-00b, P1-00c)
- Valores desses campos no contato "Teste 409". (P1-00b, P1-00c)
- Contato "Smoke Test FlowMate" (`external_id` `smoke-001`), com lead. (P1-00b)
- Contatos "Teste S4" e "Teste S4b". (P1-S4)
- Link do webhook.site em Configurações → Integrações (`5e03e930…`): **público e expira em 7
  dias**. Tirar ao fim dos testes. (P1-S4)
- Itens que já estavam no HANDOFF: contatos "Teste 409" e "Teste Idempotencia", cobranças de
  teste no AbacatePay, linhas de teste em `pending_signups`.
