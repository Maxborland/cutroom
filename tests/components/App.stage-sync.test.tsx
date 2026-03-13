import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../../src/App'
import { useProjectStore } from '../../src/stores/projectStore'
import { useAuthStore } from '../../src/stores/authStore'

vi.mock('../../src/stores/projectStore', () => {
  const store: any = vi.fn()
  store.getState = vi.fn()
  return { useProjectStore: store }
})

vi.mock('../../src/stores/authStore', () => {
  const store: any = vi.fn()
  return { useAuthStore: store }
})

vi.mock('../../src/components/Sidebar', () => ({
  Sidebar: ({ activeView, onViewChange }: any) => (
    <div>
      <span data-testid="active-view">{activeView}</span>
      <button onClick={() => onViewChange('review')}>Go Review</button>
      <button onClick={() => onViewChange('export')}>Go Export</button>
      <button onClick={() => onViewChange('settings')}>Go Settings</button>
    </div>
  ),
}))

vi.mock('../../src/components/PipelineHeader', () => ({ PipelineHeader: () => <div /> }))
vi.mock('../../src/components/BriefEditor', () => ({ BriefEditor: () => <div /> }))
vi.mock('../../src/components/ScriptView', () => ({ ScriptView: () => <div /> }))
vi.mock('../../src/components/ShotBoard', () => ({ ShotBoard: () => <div /> }))
vi.mock('../../src/components/ReviewView', () => ({ ReviewView: () => <div /> }))
vi.mock('../../src/components/ExportView', () => ({ ExportView: () => <div /> }))
vi.mock('../../src/components/SettingsView', () => ({ SettingsView: () => <div /> }))
vi.mock('../../src/components/DirectorView', () => ({ DirectorView: () => <div /> }))
vi.mock('../../src/components/Toaster', () => ({ Toaster: () => <div /> }))
vi.mock('../../src/components/Lightbox', () => ({ Lightbox: () => <div /> }))
vi.mock('../../src/components/ErrorBoundary', () => ({ ErrorBoundary: ({ children }: any) => <>{children}</> }))
vi.mock('../../src/components/auth/LoginView', () => ({ LoginView: () => <div>Login View</div> }))
vi.mock('../../src/components/auth/AcceptInviteView', () => ({ AcceptInviteView: () => <div>Accept Invite View</div> }))
vi.mock('../../src/components/auth/BootstrapAccessView', () => ({ BootstrapAccessView: () => <div>Bootstrap Access View</div> }))

const mockedUseProjectStore = useProjectStore as any
const mockedUseAuthStore = useAuthStore as any
let updateProjectStageMock: ReturnType<typeof vi.fn>

describe('App stage sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    const loadProjects = vi.fn().mockResolvedValue(undefined)
    const loadProject = vi.fn().mockResolvedValue(undefined)
    const createProject = vi.fn().mockResolvedValue(undefined)
    updateProjectStageMock = vi.fn()

    const project = {
      id: 'project-1',
      name: 'Test',
      created: '2026-02-19T00:00:00.000Z',
      updated: '2026-02-19T00:00:00.000Z',
      stage: 'shots',
      briefType: 'text',
      brief: { text: '', assets: [], targetDuration: 60 },
      script: '',
      shots: [],
      settings: {
        textModel: 'openai/gpt-4o',
        imageModel: 'openai/gpt-image-1',
        enhanceModel: 'openai/gpt-image-1',
        masterPromptScriptwriter: '',
        masterPromptShotSplitter: '',
        masterPromptEnhance: '',
      },
    }

    const state = {
      loadProjects,
      loadProject,
      createProject,
      projects: [project],
      activeProjectId: project.id,
      loading: false,
      error: null,
      clearError: vi.fn(),
      activeProject: () => project,
      updateProjectStage: updateProjectStageMock,
    }

    mockedUseProjectStore.mockImplementation((selector: any) => selector(state))
    mockedUseProjectStore.getState.mockReturnValue(state)

    const authState = {
      status: 'authenticated',
      user: { id: 'user-1', email: 'owner@example.com', name: 'Owner', role: 'owner' },
      loading: false,
      error: null,
      hydrate: vi.fn().mockResolvedValue(undefined),
      login: vi.fn(),
      logout: vi.fn(),
      acceptInvite: vi.fn(),
      clearError: vi.fn(),
    }

    mockedUseAuthStore.mockImplementation((selector: any) => selector(authState))
  })

  it('shows the login view when there is no active session', async () => {
    const authState = {
      status: 'unauthenticated',
      user: null,
      loading: false,
      error: null,
      hydrate: vi.fn().mockResolvedValue(undefined),
      login: vi.fn(),
      logout: vi.fn(),
      acceptInvite: vi.fn(),
      clearError: vi.fn(),
    }

    mockedUseAuthStore.mockImplementation((selector: any) => selector(authState))

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Login View')).toBeInTheDocument()
  })

  it('shows the bootstrap access view on the setup route when there is no active session', async () => {
    const authState = {
      status: 'unauthenticated',
      user: null,
      loading: false,
      error: null,
      hydrate: vi.fn().mockResolvedValue(undefined),
      login: vi.fn(),
      logout: vi.fn(),
      acceptInvite: vi.fn(),
      clearError: vi.fn(),
    }

    mockedUseAuthStore.mockImplementation((selector: any) => selector(authState))

    render(
      <MemoryRouter initialEntries={['/bootstrap']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Bootstrap Access View')).toBeInTheDocument()
  })

  it('updates project stage only for review/export navigation', async () => {
    render(
      <MemoryRouter initialEntries={['/projects/project-1/brief']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('active-view')).toHaveTextContent('brief')
    })

    fireEvent.click(screen.getByText('Go Review'))
    fireEvent.click(screen.getByText('Go Export'))
    fireEvent.click(screen.getByText('Go Settings'))

    expect(updateProjectStageMock).toHaveBeenCalledTimes(2)
    expect(updateProjectStageMock).toHaveBeenNthCalledWith(1, 'project-1', 'review')
    expect(updateProjectStageMock).toHaveBeenNthCalledWith(2, 'project-1', 'export')
  })

  it('restores active view from URL on reload', async () => {
    render(
      <MemoryRouter initialEntries={['/projects/project-1/director']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('active-view')).toHaveTextContent('director')
    })

    expect(updateProjectStageMock).not.toHaveBeenCalled()
  })

  it('redirects editors away from the settings route', async () => {
    const authState = {
      status: 'authenticated',
      user: { id: 'user-2', email: 'editor@example.com', name: 'Editor', role: 'editor' },
      loading: false,
      error: null,
      hydrate: vi.fn().mockResolvedValue(undefined),
      login: vi.fn(),
      logout: vi.fn(),
      acceptInvite: vi.fn(),
      clearError: vi.fn(),
    }

    mockedUseAuthStore.mockImplementation((selector: any) => selector(authState))

    render(
      <MemoryRouter initialEntries={['/projects/project-1/settings']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('active-view')).toHaveTextContent('shots')
    })
  })
})
