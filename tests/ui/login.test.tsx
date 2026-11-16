/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { LoginPage } from '../../src/features/auth/AuthPages'

describe('tela de login', () => {
  it('mostra erro de validação antes de consultar o servidor', async () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('Informe o usuário.')).toBeInTheDocument()
  })
})
