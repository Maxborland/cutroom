import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BootstrapAccessView } from '../../src/components/auth/BootstrapAccessView'
import { api } from '../../src/lib/api'

vi.mock('../../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      users: {
        ...actual.api.users,
        bootstrapInvite: vi.fn(),
      },
    },
  }
})

describe('BootstrapAccessView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates the first invite and redirects to the accept-invite route', async () => {
    vi.mocked(api.users.bootstrapInvite).mockResolvedValue({
      invite: {
        token: 'bootstrap-token',
        email: 'owner@example.com',
        role: 'owner',
        createdAt: '2026-03-13T00:00:00.000Z',
        inviteUrl: '/accept-invite/bootstrap-token',
      },
    })

    render(
      <MemoryRouter initialEntries={['/bootstrap']}>
        <Routes>
          <Route path="/bootstrap" element={<BootstrapAccessView />} />
          <Route path="/accept-invite/:token" element={<div>Accept Invite Route</div>} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('Email владельца'), {
      target: { value: 'owner@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Код первичной настройки'), {
      target: { value: 'setup-secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Создать доступ' }))

    await waitFor(() => {
      expect(api.users.bootstrapInvite).toHaveBeenCalledWith('owner@example.com', 'setup-secret')
    })

    expect(await screen.findByText('Accept Invite Route')).toBeInTheDocument()
  })
})
