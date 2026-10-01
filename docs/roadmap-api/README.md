# Roadmap da API do FlowMate — pacote para o Claude Code

Este diretório é o plano de evolução da API (`/v1`) e dos webhooks do FlowMate, tomando a
API da Helena CRM como referência. Ele foi escrito por um **tutor** (outra sessão do Claude,
que leu o código, o banco e a documentação da Helena). Quem executa é você, **Claude Code**.
O **Agadir** (dono do projeto) faz a ponte entre os dois: leva seus relatórios ao tutor e
traz as respostas de volta.

## Ordem de leitura

| Arquivo | Para quê | Quando ler |
| --- | --- | --- |
| `00-contexto-e-regras.md` | O projeto, a arquitetura, as regras que não podem ser quebradas | **Antes de tudo** |
| `01-protocolo-com-o-tutor.md` | Como reportar, quando parar e perguntar | **Antes de tudo** |
| `10-parte1-plano.md` | Lista ordenada das tarefas da Parte 1, com IDs | Antes de começar a Parte 1 |
| `11-parte1-seguranca.md` | Tarefas P1-S* | Na tarefa |
| `12-parte1-base-api.md` | Tarefas P1-B* (roteador, autenticação, paginação, erros) | Na tarefa |
| `13-parte1-rotas-leitura.md` | Tarefas P1-L* | Na tarefa |
| `14-parte1-escritas.md` | Tarefas P1-E* | Na tarefa |
| `15-parte1-webhook-eventos.md` | Tarefas P1-W* | Na tarefa |
| `16-parte1-testes.md` | Roteiro de teste (curl) e smoke test | Em toda tarefa |
| `20-contrato-api-v1.md` | Contrato exato de cada rota nova (request/response) | Referência durante a Parte 1 |
| `esquema-atual.md` | Colunas reais do banco (você cria na P1-00) | Em toda tarefa com banco |
| `30-parte2-visao.md` | Parte 2: blocos, dependências, decisões em aberto | **Só leitura** até o Agadir liberar |
| `31-parte2-lead-completo.md` | Bloco 1 | **Só leitura** |
| `32-parte2-fundacao-servidor.md` | Blocos 4, 2, 16 e 3 (outbox, relógio, automações e webhooks no servidor) | **Só leitura** |
| `33-parte2-conversas.md` | Bloco 5 | **Só leitura** |
| `34-parte2-campanhas.md` | Bloco 15 | **Só leitura** |
| `35-parte2-demais-blocos.md` | Blocos 6 a 14 | **Só leitura** |
| `PROMPT-INICIAL.md` | O que o Agadir cola na primeira mensagem + como fazer a ponte | Agadir |
| `90-referencia-helena.md` | O que a Helena faz, para consulta | Quando precisar comparar |
| `relatorios/` | Onde você grava um relatório por tarefa | Ao terminar cada tarefa |

## Status

- **Parte 1** — aprovada para execução, uma tarefa por vez, na ordem de `10-parte1-plano.md`.
- **Parte 2** — desenho. **Não implemente nada da Parte 2** sem uma mensagem do Agadir dizendo
  qual bloco foi liberado.

Plano escrito em 01/10/2026, sobre o commit `d1c852f` do branch `main`.
