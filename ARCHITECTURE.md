# Arquitetura

O Planiar separa interface, estado visual, regras, repositório local, API, sincronização, conflitos e persistência.

## Fluxo

1. A interface valida a ação.
2. O repositório grava no IndexedDB.
3. A tela atualiza pela consulta reativa do Dexie.
4. A mesma alteração entra na fila `operations`.
5. Com rede e sessão, `syncNow` envia o lote e puxa o cursor remoto.
6. O servidor confere permissão, versão e ocupação.
7. O que for aceito entra no Postgres e no `change_log`.
8. Se o Ably estiver configurado, o canal `user:<id>` avisa os outros dispositivos. O cliente então puxa as mudanças. Sem Ably, o mesmo pull ocorre no intervalo, no evento `online` e ao voltar a aba para o primeiro plano.

A operação local não espera a rede.

## Por que estas peças

- **FullCalendar 7** desenha a semana e o mês, encaixa eventos lado a lado, respeita o fuso IANA e aceita snap de 5 minutos e arraste externo. O dnd-kit só reordena a biblioteca pelo cabo, sem competir com o arraste do calendário.
- **Uma função `api/[...path].ts`** concentra as rotas. A Vercel não mantém WebSocket dentro da função. O tempo real, quando existe, é o REST do Ably.
- **PGlite** só é importado por `server/dev.ts` e pelos testes. O handler da Vercel não o inclui. Sem `DATABASE_URL` em produção, a resposta é `database_unconfigured`.
- **Drizzle** descreve o schema. A migração aplicada é o SQL idempotente em `server/database/sql.ts`.
- **Argon2id** é o padrão da biblioteca `@node-rs/argon2` quando o algoritmo não é informado. Os parâmetros de teste são mais leves apenas com `VITEST`.
- **Mídia** usa Vercel Blob quando `BLOB_READ_WRITE_TOKEN` existe. Caso contrário, o arquivo validado (PNG, JPEG ou WebP, até 2 MB) é cifrado com AES-256-GCM e guardado no Postgres. A leitura exige sessão e participação numa rotina em comum, ou ser o dono.

Não há criptografia de ponta a ponta. O servidor precisa ler horários, títulos e permissões para autorizar e detectar conflito. A chave de mídia fica só no servidor.

## Sessão e dispositivo

O cookie autentica a API. O `localStorage` guarda apenas o perfil público em `planiar.device-user`, para reabrir o calendário se a rede falhar no carregamento. Um `401` limpa esse ponteiro e não apaga o IndexedDB. Quem usa o aparelho compartilhado precisa sair da conta.

## Retenção

A semana começa na segunda-feira, no fuso da rotina. `planRetention` separa a semana atual, o que poderia ser arquivado e o que está bloqueado por fila ou disputa. `retentionDeletionPolicy` sempre recusa exclusão remota. A exportação JSON existe. A importação só valida o arquivo.

## Atualização do PWA

O service worker guarda o shell e usa `NetworkOnly` para `/api`. O Dexie está na versão 1, por usuário. Atualizar o aplicativo não apaga esses bancos.
