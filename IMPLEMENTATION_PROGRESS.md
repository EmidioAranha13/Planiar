# Andamento

Verificado em 16 de novembro de 2026: `npm test` passou 22 testes, `npm run test:e2e` passou o formulário de login, `npm run typecheck` e `npm run lint` passaram, e `npm run build` gerou o PWA. O oxlint deixou avisos de refresh e de efeito no formulário do agendamento, sem erro. O calendário, o arraste e a instalação no celular não foram percorridos num aparelho.

## Fases

1. Fundação: Vite, React 19, TypeScript, Tailwind, rotas, Dexie, API Node, Vitest e manifesto PWA com ícones 192, 512 e maskable.
2. Autenticação: cadastro, login com mensagem genérica, limite de tentativas, recuperação com token de uso único e perfil. O e-mail real só sai quando Resend está configurado.
3. Atividades: criação, cor em roda, hexadecimal e RGB, duplicata no cliente e no servidor, tags com contraste.
4. Calendário: semana e mês, snap de 5 minutos, arraste, redimensionamento, área de exclusão com confirmação e escopos de exclusão.
5. Rotinas: criação, fuso, política de sobreposição, convite, aceite, recusa e papéis.
6. Sincronização: fila, push idempotente, pull por cursor e aviso em tempo real quando há Ably.
7. Conflitos: detecção, disputa, proposta, recusa, contraproposta e aceitação transacional.
8. Histórico: classificação semanal, exportação JSON e validação de backup. A exclusão remota permanece desligada. A importação não foi habilitada.
9. Qualidade: testes de domínio, IndexedDB, login e API com PGlite. O Playwright abriu a tela de login e confirmou a validação do formulário. Nesse teste a API não estava no ar, então `/api/auth/me` falhou na rede, como esperado para essa checagem isolada.

## Fora desta verificação

- Instalação em Android e iOS.
- Arraste real no calendário.
- Envio Resend, publicação Ably e upload Blob com credenciais de verdade.
- `npm audit` ainda reporta avisos herdados das dependências. Não foi aplicado correção forçada.
