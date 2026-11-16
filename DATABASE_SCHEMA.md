# Esquema do banco

O Postgres é a fonte confirmada. O IndexedDB espelha o que o usuário pode ver e a fila ainda não confirmada. `password_hash` e hashes de token não saem do servidor.

## Conta

- `users`: `id`, `username` único, `email` único, `password_hash`, `display_name`, `profile_color`, `avatar_url`, `created_at`, `updated_at`.
- `sessions`: token só como SHA-256, expiração, revogação, agente e IP.
- `password_resets`: token só como SHA-256, expiração de 1 hora e `used_at`.
- `rate_limits`: chave, contagem e início da janela. O login usa 8 tentativas por usuário e IP em 15 minutos, e 30 por IP. `LOGIN_RATE_LIMIT` altera o limite por identidade.
- `media_objects`: dono, tipo, tamanho e texto cifrado. Não é usado quando o Blob está configurado.

## Rotina

- `activities`: dono, título, `normalized_title`, descrição, cor, versão e `deleted_at`. O índice único parcial impede dois títulos ativos equivalentes do mesmo dono.
- `routines`: nome, descrição, dono, `personal` ou `shared`, cor, fuso, `overlap_policy` (`allow` ou `conflict`), versão e exclusão lógica.
- `routine_members`: rotina, usuário, papel `owner` ou `editor`, entrada. Par único.
- `schedules`: rotina, atividade, início, fim, fuso, autores, versão e `deleted_at`. Vários horários da mesma atividade no mesmo dia são válidos.
- `invitations`: rotina, remetente, destinatário, `pending | accepted | rejected | cancelled`, criação e resposta.

## Sincronização e disputa

- `sync_operations`: identificador do cliente, ator, entidade, tipo, payload, versão-base, status e resultado. A chave primária torna a repetição idempotente.
- `change_log`: `seq` crescente, entidade, operação, registro, versão, ator e `audience_user_ids`.
- `conflicts`: rotina, tipo, agendamentos, participantes, estados base, proposto e do servidor, status `open | proposal_pending | resolved`.
- `conflict_proposals`: disputa, autor, alteração, status e resposta.
- `notifications`: destinatário, tipo, payload e leitura.
- `audit_log`: ator, ação, entidade e metadados. Não registra senha, token nem corpo de e-mail.

## Local

Cada usuário tem um Dexie versão 1 com atividades, rotinas, membros, agendamentos, convites, operações, conflitos, propostas, notificações, perfis e metadados (`syncCursor`). A fila local guarda a versão-base usada na edição.
