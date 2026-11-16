import { z } from 'zod';

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Informe uma cor hexadecimal, como #0F766E.');

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'O nome de usuário precisa ter pelo menos 3 caracteres.')
  .max(30, 'O nome de usuário pode ter no máximo 30 caracteres.')
  .regex(/^[a-zA-Z0-9._]+$/, 'Use apenas letras, números, ponto e sublinhado.')
  .transform((value) => value.toLowerCase());

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Informe um e-mail válido.'));

export const passwordSchema = z
  .string()
  .min(10, 'A senha precisa ter pelo menos 10 caracteres.')
  .max(128, 'A senha pode ter no máximo 128 caracteres.')
  .refine((value) => /[A-Za-zÀ-ÿ]/.test(value) && /\d/.test(value), {
    message: 'A senha precisa combinar letras e números.',
  });

export const registerSchema = z
  .object({
    username: usernameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    displayName: z.string().trim().min(1, 'Informe como você quer ser chamado.').max(80),
    profileColor: hexColorSchema,
    avatarDataUrl: z.string().max(3_200_000).nullable().optional(),
    timezone: z.string().trim().min(1).max(80),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'A confirmação da senha não confere.',
  });

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Informe o usuário.').max(30).transform((value) => value.toLowerCase()),
  password: z.string().min(1, 'Informe a senha.').max(128),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(20, 'O link de recuperação é inválido.'),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'A confirmação da senha não confere.',
  });

export const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  profileColor: hexColorSchema,
  avatarDataUrl: z.string().max(3_200_000).nullable().optional(),
});

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, 'Informe a senha atual.'),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'A confirmação da senha não confere.',
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
