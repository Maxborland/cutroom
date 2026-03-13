import type { AuthUser } from '../../lib/api'

const ROLE_LABELS: Record<AuthUser['role'], string> = {
  owner: 'Владелец',
  admin: 'Администратор',
  editor: 'Редактор',
  viewer: 'Наблюдатель',
}

interface UserManagementViewProps {
  users: AuthUser[]
  loading?: boolean
  error?: string | null
}

function formatCreatedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Дата недоступна'
  }

  return date.toLocaleDateString('ru-RU')
}

export function UserManagementView({ users, loading = false, error = null }: UserManagementViewProps) {
  if (loading) {
    return (
      <div className="rounded-[5px] border-2 border-border bg-surface-2 px-4 py-4 text-sm text-text-muted">
        Загружаем участников команды...
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-[5px] border-2 border-border bg-rose-dim px-4 py-4 text-sm text-rose">
        {error}
      </div>
    )
  }

  if (users.length === 0) {
    return (
      <div className="rounded-[5px] border-2 border-border bg-surface-2 px-4 py-4 text-sm text-text-muted">
        Пока нет активных пользователей.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {users.map((user) => (
        <div
          key={user.id}
          className="flex flex-col gap-2 rounded-[5px] border-2 border-border bg-surface-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="text-sm font-semibold text-text-primary">{user.name}</p>
            <p className="text-sm text-text-muted">{user.email}</p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="rounded-[3px] border border-border px-2 py-1 font-mono uppercase text-text-secondary">
              {ROLE_LABELS[user.role]}
            </span>
            <span className="text-text-muted">С {formatCreatedAt(user.createdAt)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

export default UserManagementView
