# ET-2 + ET-4 — Gestão de etiquetas (atrás da chave `labels`)

**Status:** no ar (`a195c9f`), **chave `labels` desligada** em todas as empresas. Desligada:
rotas novas → `404 feature_off`; respostas, tela e fluxo de mensagens iguais aos de antes.
**SQL:** nenhum novo. Usa a CF-A PARTE 6 (tabelas, `rename_label`/`delete_label`, gatilhos,
backfill), já aplicada e conferida.
**Fora desta etapa:** ET-3 (a trava vira etiqueta: envio sem 409, `block_api_send_on_human`,
`message.received` sempre). Com a chave ligada, **o 409 continua** ("Atendimento humano" =
`state: human`).

## O que mudou
- **`api/_lib/labels.js` (novo):** regra única para a `/v1` e a tela.
  - **Contato:** só etiquetas de usuário. O array `tags` segue como fonte (Fase A): aplicar e
    remover escrevem no array, e o gatilho espelha em `contact_labels`. O contrato da E3 fica
    intacto.
  - **Conversa:** as de usuário vão em `conversation_labels`. As de sistema mudam o estado pelo
    caminho de sempre (`setConversationState`/`resumeAutomation`, com a gêmea), e o gatilho
    troca a etiqueta. Regras: só em conversa individual, exclusivas e sem remoção (troca-se pela
    outra).
  - **Renomear/excluir:** pelas funções do banco (os arrays de tags acompanham). Etiqueta de
    sistema: só a cor (`422 label_is_system` para nome e exclusão).
  - **Paleta:** 8 cores + cinza (`api/_lib/labelColors.js`, a mesma no front).
- **`/v1`:**
  - `GET/POST /labels`, `GET/PATCH/DELETE /labels/{id}`;
  - `POST /contacts/{id}/labels` e `POST /conversations/{id}/labels`;
  - `labels` em `GET /contacts` (lista) e nas conversas (lista, `GET` e `PATCH`);
  - `requires_feature` no `GET /webhook-events`.

  Ver o contrato (`20`, seção "Etiquetas").
- **Tela** (`api/conversations/state.js` → catch-all `api/conversations/[...path].js`):
  - continua com **7 funções**;
  - a rota `state` não mudou;
  - rotas novas `labels`, `label-map`, `contact-labels` e `conversation-labels`, todas com a
    permissão conferida no servidor (`api/_lib/permissions.js`, fonte única das permissões
    padrão; a tela importa de lá).
  - **Configurações → Etiquetas:**
    - lista com cor e quantos contatos/conversas usam cada uma;
    - criar, editar e excluir (a confirmação mostra quantos perdem a etiqueta);
    - as de sistema aparecem com cadeado e aviso.
  - **Quem gerencia:** quem tem Configurações. O gerente com "Configurações" marcado vê **só**
    esta aba; antes ele via "sem permissão".
  - **Painel do contato** (Contatos e Chats): seção Etiquetas, aplicada na hora (não depende do
    "Salvar").
  - **Contatos:** chips na lista.
  - **Chats:**
    - filtro por etiqueta (casa a conversa e o contato);
    - chips na lista (conversa + contato, até 4);
    - no cabeçalho, os chips da conversa entram no lugar do selo de estado. "Devolver p/
      automação" continua enquanto humano.
    - O mapa recarrega a cada 20 s, depois de enviar e ao devolver.
- **Eventos** (catálogo, `feature: 'labels'`; a tela de Integrações só os mostra com a chave):
  - `label.created`, `label.updated`, `label.deleted`;
  - `contact.labels_updated`: tela, rota nova, E3, `POST /v1/contacts` com tags;
  - `conversation.labels_updated`, com `source`:
    - `user`: tela (etiqueta, envio, devolver);
    - `api`;
    - `phone`: respondeu pelo celular;
    - `system`: conversa nova → "Atendimento IA".

  Emitidos em `try/catch` com limite de 3 s. Um evento por conversa (a principal não duplica;
  a gêmea solta o dela).

## Permissões (servidor)
| Ação | Quem |
| --- | --- |
| Criar, editar e excluir etiqueta | `settings.access` (admin; gerente se marcado) |
| Listar etiquetas / mapa | qualquer usuário da empresa (as tabelas já são legíveis pela RLS para a empresa toda) |
| Aplicar/remover no contato | quem vê o contato (`contacts.view_all`, ou `view_own` e é o criador) **ou** vê os chats |
| Aplicar/remover na conversa | quem vê os chats (`chats.view_all` ou `view_own`) |

O Chats de hoje não filtra conversa por dono, então "vê os chats" vale para qualquer conversa.
É a mesma regra da rota `state` (anotado pelo revisor; restringir por dono fica para quando o
Chats filtrar).

## Como testei
- **Local: 95/95**, banco falso com as regras da PARTE 6 (unique, gatilhos, funções):
  - **chave desligada:** 404 `feature_off`, respostas sem `labels`, nenhum evento novo;
  - **CRUD:** paleta, nome repetido ou de sistema → 409, sistema só a cor;
  - **renomear e excluir:** acompanham o array de tags e devolvem as contagens;
  - **contato:** id ou nome, 3 operações; sistema → 422; inexistente → 422 com `missing`;
  - **E3:** continua igual e solta os dois eventos;
  - **conversa:**
    - usuário, também em grupo;
    - sistema troca o estado e a gêmea, um evento por conversa;
    - 422 para remover, para as duas juntas e em grupo;
    - `ReplaceAll` vazio mantém a de sistema;
  - **origem dos eventos:** celular → `phone`; conversa nova → `system`; grupo novo → nenhum;
  - **tela:**
    - vendedor e gerente com e sem permissão;
    - sistema bloqueado na tela;
    - remover tira também da gêmea;
    - mapa só da empresa;
    - outra empresa → 404.
- **Regressões:**

  | Teste | Resultado |
  | --- | --- |
  | E0b | 24/24 |
  | E0 | 42/42 |
  | A1 | 35/35 |
  | A2 | 5/5 |
  | A4 | 24/24 |
  | A5 | 19/19 |
  | A6 | 32/32 |
  | `npm run build` | ok |
- **Não testado:** a tela num navegador com a chave ligada (é o roteiro abaixo) e o banco real com
  a chave ligada.

## Produção (`a195c9f`, deploy confirmado pelo status do GitHub; chave desligada)
| Caso | Resultado |
| --- | --- |
| Smoke | **idêntico** ao da A6 |
| `GET/POST /v1/labels`, `PATCH/DELETE /v1/labels/{id}`, `POST /v1/contacts/{id}/labels`, `POST /v1/conversations/{id}/labels` | 404 `feature_off` |
| `PUT /v1/labels` / sem chave | 405 / 401 |
| `GET /v1/conversations`, `GET /v1/contacts` (lista) | sem `labels` (igual a antes) |
| `GET /v1/webhook-events` | os 5 eventos novos no catálogo |
| `/api/conversations/state` e `/labels` sem login / rota inexistente | 401 / 401 / 404 |

## Para ligar (Agadir, só na empresa dele; o id fica fora do repo)
```sql
update companies set features = features || '{"labels": true}' where id = '<id-da-empresa>';
```
Desligar: `update companies set features = features - 'labels' where id = '<id-da-empresa>';`
Vale em até 30 s (cache da chave), sem deploy. Recarregue a tela.

## Roteiro de teste na tela (com a chave ligada)
1. **Configurações → Etiquetas:** aparecem "Atendimento humano" e "Atendimento IA" (com cadeado)
   e as tags que já existiam, em cinza.
2. **Criar** "Teste ET" (vermelho) → aparece com 0 contatos · 0 conversas. Criar de novo com o
   mesmo nome → erro "Já existe".
3. **Editar** "Teste ET" → "Teste ET 2", cor azul → salva.
4. **Sistema:** lápis em "Atendimento IA" → o nome fica travado com o aviso; trocar a cor salva.
   Não há lixeira nas de sistema.
5. **Contato:** Contatos → abrir um contato → Etiquetas → "+ Etiqueta" → "Teste ET 2". O chip
   aparece no painel e na lista. As de sistema não aparecem no seletor.
6. **Conversa:** Chats → abrir a conversa → no cabeçalho "+ Etiqueta" → "Teste ET 2". O chip
   aparece no cabeçalho e na lista.
7. **Sistema na conversa:** no cabeçalho, escolher "Atendimento humano" → aparece "Devolver p/
   automação". Devolver → volta "Atendimento IA". O chip de sistema não tem "x".
8. **Filtrar:** no Chats, filtro "Teste ET 2" → só a conversa marcada (e as de contatos com a
   etiqueta).
9. **Excluir:** Configurações → Etiquetas → lixeira em "Teste ET 2" → a confirmação diz "sai de 1
   contato e de 1 conversa" → some do contato, da conversa e do filtro.
10. **Integrações:** os 5 eventos de etiqueta aparecem na lista. Se o webhook estiver
    configurado, cada passo acima gera o seu evento (`source: "user"`).

**Limpeza depois:** nada a limpar se o passo 9 for feito; o estado da conversa volta no passo 7.

## Ajustes (2026-10-18/19, com a chave ligada na empresa do Agadir)
- **Painéis laterais (`584097e`):** a seção "Etiquetas" virou o componente único
  `ContactLabels`. Ele aparece no painel do contato (Contatos e Chats) e no painel do lead do
  Pipeline (etiquetas do contato do lead).
- **Criar na hora:** o seletor "+ Etiqueta" (painéis do contato e do lead, cabeçalho do Chats)
  ganhou busca.
  - Com um nome que ainda não existe, aparece **"Criar <slug>"**: cria em cinza e já aplica.
  - Se o slug já existe, aplica a existente (o 409 traz `label_id`).
  - Só quem gerencia etiquetas (`can_manage`) vê "Criar"; os demais só aplicam as existentes.
- **Nome padronizado (slug)** em toda criação e edição, na tela e na API (`api/_lib/labelName.js`,
  fonte única):
  - prévia "Nome final: …" enquanto digita, no seletor e em Configurações;
  - slug vazio ou com mais de 100 caracteres → 400 com mensagem clara;
  - sistema mantém o nome; `atendimento-ia` de usuário não conflita;
  - aplicar por nome acha o slug.
- **E3 com a chave ligada:** as tags gravam padronizadas (`"VIP"` → `"vip"`), também no
  `POST /v1/contacts`. Chave desligada: igual a antes. Ainda gravam como vier: `PATCH /v1/contacts`
  antigo, `POST /v1/leads`, automações e importação da tela (registrado no contrato).
- **Dados existentes:**
  - **Empresa do Agadir:** conferida pela `/v1`. Há 1 etiqueta de usuário (`teste-api`), já no
    padrão: 0 mudam, 0 colisões. Nada a migrar.
  - **Outras empresas:** `supabase_labels_slug.sql` faz a conferência (PARTE 0, só leitura:
    nomes de etiqueta e contagens), a migração (PARTE 1: junta colisões, renomeia e padroniza os
    arrays de tags) e a conferência depois, com rollback. **Não rodado.** Rodar antes de ligar
    `labels` em outra empresa.
- **Testes locais:**
  - 101/101: slug, acento, vazio, colisão → 409 com `label_id`, nome "Atendimento IA" vira
    `atendimento-ia` sem tocar o sistema, aplicar pelo nome digitado, E3 padronizada, sem
    repetir e removendo pelo nome digitado;
  - regressões E0b 24, E0 42, A1 35 e A6 32;
  - build ok.
