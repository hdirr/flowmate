# 01 — Protocolo com o tutor

Você não fala com o tutor diretamente. O Agadir copia o seu relatório para o tutor e traz a
resposta. Por isso o relatório precisa ser **autossuficiente**: quem lê não vê o seu terminal.

## Ciclo de cada tarefa

1. Leia a tarefa inteira e o trecho do contrato (`20-contrato-api-v1.md`) que ela cita.
2. Se a tarefa precisa de SQL: escreva o arquivo `.sql`, **pare** e peça ao Agadir para rodar.
   Só continue quando ele confirmar que rodou sem erro.
3. Implemente. Rode `npm run build` (pega erro de sintaxe; não pega variável órfã).
4. Teste localmente o que der e, depois do push, rode o roteiro de `16-parte1-testes.md` da
   tarefa contra produção, **com a chave de teste do Agadir** (peça a ele; nunca grave em arquivo).
5. Rode o **smoke test** (seção 1 de `16-parte1-testes.md`): o que já existia continua igual.
6. Grave o relatório em `docs/roadmap-api/relatorios/<ID>.md` (modelo abaixo) e faça commit
   junto com o código ou logo depois.
7. Avise o Agadir: "Tarefa <ID> pronta, relatório em `relatorios/<ID>.md`". **Não comece a
   próxima** até ele responder.

## Quando parar e perguntar (em vez de decidir sozinho)

- O esquema real do banco é diferente do que a tarefa supõe.
- Cumprir a tarefa exigiria mudar uma rota existente, `sendMessage.js` ou o fluxo de mensagens
  do `handleWebhook` além do que a tarefa autoriza.
- Você precisaria de um arquivo novo em `api/` (fora de `_lib`) ou de uma dependência nova.
- Um teste do smoke test falhou depois do seu deploy. Nesse caso: **reverta primeiro**
  (`git revert` do seu commit + push), depois relate.
- A tarefa está ambígua ou contradiz outro arquivo deste pacote.

Pergunta vai no relatório, na seção "Perguntas para o tutor", numerada.

## Modelo de relatório (`relatorios/<ID>.md`)

```markdown
# <ID> — <título da tarefa>

**Status:** pronto | parcial | bloqueado
**Commit(s):** <hash curto> — <mensagem>
**SQL rodado pelo Agadir:** <arquivo> (sim/não/não se aplica)

## O que foi feito
- <arquivo>: <o que mudou, em uma linha>

## Desvios do plano
- <o que ficou diferente do especificado e por quê> (ou "nenhum")

## Testes
| Teste | Resultado |
| --- | --- |
| <curl / ação> | <status HTTP + trecho da resposta> |
| Smoke test | ok / falhou em <item> |

## Riscos ou pendências
- <...> (ou "nenhum")

## Perguntas para o tutor
1. <...> (ou "nenhuma")
```

Respostas e trechos de resposta da API nos relatórios: **apague chaves, segredos e telefones
reais** (troque por `***`).
