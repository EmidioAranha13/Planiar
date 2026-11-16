# Publicação

O build gera `dist/` e a Vercel publica a interface. `api/[...path].ts` é a função Node. `vercel.json` devolve `index.html` para as rotas do aplicativo, sem capturar `/api`.

## Variáveis

Copie `.env.example`. Em produção defina pelo menos:

- `DATABASE_URL` com SSL, Neon ou Supabase Postgres.
- `APP_ORIGIN` com a URL HTTPS do projeto.
- `APP_ENCRYPTION_KEY`, 32 bytes em base64, se houver foto de perfil.

Opcionais, e desligados de forma explícita quando ausentes:

- `RESEND_API_KEY` e `EMAIL_FROM`
- `ABLY_API_KEY`
- `BLOB_READ_WRITE_TOKEN`

Não crie variável `VITE_` com segredo. O cookie fica Secure em `VERCEL_ENV=production` ou quando `APP_ORIGIN` usa HTTPS.

## Banco

Antes do primeiro uso:

```bash
npm run db:migrate
```

O comando exige `DATABASE_URL` e aplica o SQL da versão 1. Ele pode ser executado de novo.

## Conferência

`GET /api/health` informa o modo do banco, se o e-mail e o Ably estão configurados, se a mídia usa Blob ou Postgres, se a cifra de mídia existe e que a exclusão de histórico remoto está desativada. A resposta olha a configuração. Ela não finge que um serviço respondeu.

## O que não está pronto para apagar histórico

A classificação da semana atual existe, mas nenhuma rotina remove agendamentos antigos do servidor. Isso continua de propósito: um aparelho offline por muito tempo ainda precisa conseguir sincronizar, e não há restauração automática a partir do JSON exportado.
