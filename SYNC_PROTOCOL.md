# Protocolo de sincronização

O cliente gera os UUIDs das entidades e das operações. O relógio do aparelho não decide qual alteração vence.

## Envio

`POST /api/sync/push` recebe até 50 operações. Cada uma tem `id`, `clientId`, `entityType`, `entityId`, `operationType`, `payload`, `baseVersion`, `baseSnapshot` opcional e `createdAt`.

O servidor procura o `id`. Se já existir, devolve o resultado guardado. Se não existir, executa a operação e grava o resultado antes de responder. Os status são `applied`, `conflict` ou `rejected`.

Mutações exigem cookie de sessão, cabeçalho `X-Planiar-Request: 1` e `Origin` permitido.

## Recebimento

`POST /api/sync/pull` recebe `{ cursor }`. A resposta traz mudanças com `seq` maior que o cursor, limitadas a 200, apenas quando o usuário está em `audience_user_ids`. `hasMore` pede outro pull.

O cliente aplica o registro remoto se a entidade não tiver operação local `pending` ou `error`. Em conflito, o calendário volta ao registro do servidor e a proposta local permanece na disputa.

## Tempo real

`GET /api/realtime/config` responde `ably` ou `polling` conforme a presença de `ABLY_API_KEY`. O token do Ably só permite assinar o canal do próprio usuário. A mensagem não carrega o registro: ela dispara um pull. Reconectar ou voltar do segundo plano também dispara o pull. A Background Sync API não é a única via.

## O que não acontece

Uma tentativa repetida não duplica o agendamento. Uma rejeição não apaga a cópia local sem registrar o motivo. Uma versão antiga não sobrescreve a versão confirmada.
