import type { SystemLicenseState } from '../../types'

const STATUS_LABELS: Record<SystemLicenseState['status'], string> = {
  unactivated: 'Не активирована',
  trial: 'Пробный период',
  active: 'Активна',
  grace: 'Льготный период',
  trial_expired: 'Пробный период истек',
}

interface LicenseStatusCardProps {
  license: SystemLicenseState | null
  loading?: boolean
  error?: string | null
}

function formatLastCheck(value: string | null): string {
  if (!value) {
    return 'Проверка еще не выполнялась'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Дата проверки недоступна'
  }

  return date.toLocaleString('ru-RU')
}

export function LicenseStatusCard({ license, loading = false, error = null }: LicenseStatusCardProps) {
  if (loading) {
    return (
      <div className="rounded-[5px] border-2 border-border bg-surface-2 px-4 py-4 text-sm text-text-muted">
        Загружаем статус лицензии...
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

  if (!license) {
    return (
      <div className="rounded-[5px] border-2 border-border bg-surface-2 px-4 py-4 text-sm text-text-muted">
        Данные лицензии недоступны.
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-[5px] border-2 border-border bg-surface-2 px-4 py-4">
        <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted mb-1">Статус лицензии</p>
        <p className="font-heading text-lg font-semibold">{STATUS_LABELS[license.status]}</p>
        <p className="mt-2 text-sm text-text-muted">
          {license.status === 'trial'
            ? `Осталось ${license.trialDaysRemaining} дн.`
            : license.restrictedMode
              ? 'Инстанс работает в ограниченном режиме.'
              : 'Все коммерческие функции доступны.'}
        </p>
      </div>

      <div className="rounded-[5px] border-2 border-border bg-surface-2 px-4 py-4">
        <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted mb-1">Диагностика</p>
        <p className="text-sm text-text-primary">Последняя проверка: {formatLastCheck(license.lastCheckAt)}</p>
        <p className="mt-2 text-sm text-text-muted">
          {license.restrictedMode
            ? 'Новые генерации и редактирование должны быть заблокированы до активации.'
            : 'Этот инстанс готов к рабочему использованию командой.'}
        </p>
      </div>
    </div>
  )
}

export default LicenseStatusCard
