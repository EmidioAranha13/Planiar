import { AppError } from '../http/errors';

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendPasswordReset(to: string, link: string): Promise<void> {
  if (!emailConfigured()) {
    throw new AppError(503, 'email_not_configured', 'O serviço de e-mail não está configurado.');
  }
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const result = await resend.emails.send({
    from: process.env.EMAIL_FROM ?? '',
    to,
    subject: '[Planiar]: Recuperação de senha',
    text: [
      'Recebemos um pedido para redefinir a senha da sua conta Planiar.',
      '',
      'Abra o link abaixo em até 1 hora. Ele só pode ser usado uma vez e não contém a sua senha:',
      link,
      '',
      'Se você não pediu esta alteração, ignore esta mensagem. A senha atual continua válida.',
    ].join('\n'),
  });
  if (result.error) {
    throw new AppError(502, 'email_failed', 'Não foi possível enviar o e-mail de recuperação.');
  }
}
