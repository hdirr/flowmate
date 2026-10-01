# Prompt para colar no Claude Code (primeira mensagem)

Copie o bloco abaixo e cole no Claude Code, aberto na pasta `C:\Users\lenovo\Agadir\FlowMate`.

---

```
Você vai executar o roadmap da API do FlowMate que está em docs/roadmap-api/.

Antes de qualquer coisa:
1. Leia docs/roadmap-api/README.md, 00-contexto-e-regras.md e 01-protocolo-com-o-tutor.md inteiros.
2. Leia HANDOFF.md na raiz (estado do projeto) e 10-parte1-plano.md.
3. Me responda, sem escrever código ainda:
   - um resumo de 5 linhas do que entendeu do projeto e das regras;
   - qualquer contradição que encontrar entre os arquivos do roadmap e o código atual;
   - o que você precisa de mim para a tarefa P1-00.

Regras que valem desde já: o push no main vai direto para produção; uma tarefa por vez; não
comece a próxima sem eu liberar; nada da Parte 2 sem minha ordem; nunca grave chave ou segredo
em arquivo. Ao terminar cada tarefa, grave o relatório em docs/roadmap-api/relatorios/<ID>.md
no formato do 01-protocolo-com-o-tutor.md — eu levo esse relatório para o tutor.
```

---

## Como fazer a ponte

- Quando o Claude Code disser "Tarefa X pronta", abra `docs/roadmap-api/relatorios/<ID>.md`,
  copie o conteúdo e mande para o tutor (a conversa do Claude onde este plano foi feito).
- A resposta do tutor você cola de volta no Claude Code, começando com
  "Resposta do tutor sobre <ID>:".
- Pedidos de SQL: o Claude Code vai parar e pedir para você rodar no Supabase. Rode, confira que
  deu "Success" e responda "rodei, sem erro" (ou cole o erro).
- Chave de teste da API: passe para o Claude Code só pelo chat, nunca peça para gravar em arquivo.
