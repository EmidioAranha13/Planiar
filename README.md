# Planiar

Aplicativo instalável para rotinas pessoais e compartilhadas. O calendário, as atividades e as disputas funcionam primeiro no dispositivo. Quando há sessão e rede, as alterações vão para o PostgreSQL e os outros participantes recebem um aviso para sincronizar.

## Executar

```bash
npm install
npm run dev
```

A interface sobe em `http://localhost:5174` e a API em `http://localhost:8787`. O Vite encaminha `/api` para essa porta.

Sem `DATABASE_URL`, o processo local grava um PostgreSQL em memória persistida em `.data/pglite`. Esse modo é só para desenvolvimento e testes. Na Vercel, a API responde `503` até existir um Postgres gerenciado.

## Scripts

| Script | Função |
| --- | --- |
| `npm run dev` | Interface e API juntas |
| `npm run build` | Verificação de tipos e build de produção |
| `npm run typecheck` | TypeScript do cliente e do servidor |
| `npm run lint` | oxlint |
| `npm test` | Vitest: domínio, IndexedDB, interface e API com PGlite |
| `npm run test:e2e` | Playwright na tela de login |
| `npm run db:migrate` | Aplica o SQL em `DATABASE_URL` |

## O que ainda depende de credencial

Nada disso é simulado como se estivesse ligado:

- `DATABASE_URL` — obrigatório em produção.
- `APP_ENCRYPTION_KEY` — obrigatório em produção para fotos. Em desenvolvimento, uma chave local é criada em `.data/dev-encryption-key`.
- `RESEND_API_KEY` e `EMAIL_FROM` — sem os dois, a recuperação não envia e-mail. Fora de produção, a resposta informa isso e pode incluir o link local.
- `ABLY_API_KEY` — sem a chave, os clientes sincronizam ao reconectar, ao voltar para a aba e a cada 15 segundos.
- `BLOB_READ_WRITE_TOKEN` — sem o token, as imagens ficam criptografadas em `media_objects`.

O modelo está em `.env.example`. Não há segredo no frontend.

## Conta e dados locais

O cadastro pede usuário, e-mail, senha, cor e foto opcional. A senha é armazenada com Argon2id. A sessão usa o cookie `planiar_session`, HttpOnly e SameSite=Lax, Secure quando a origem é HTTPS.

O IndexedDB é separado por usuário (`planiar-<id>`). Ele não guarda senha nem token. Sair remove o ponteiro local do usuário e mantém o banco, para não descartar alteração pendente. “Sair e limpar este dispositivo” pede confirmação e avisa se ainda houver fila.

## Documentação

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)
- [SYNC_PROTOCOL.md](SYNC_PROTOCOL.md)
- [CONFLICT_RESOLUTION.md](CONFLICT_RESOLUTION.md)
- [DEPLOYMENT.md](DEPLOYMENT.md)
- [IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md)
