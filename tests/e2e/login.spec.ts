import { expect, test } from '@playwright/test'

test('a tela de login valida o formulário', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('Informe o usuário.')).toBeVisible()
})
