export type OpenReelSyncState = 'synced' | 'saving' | 'error'

const STATUS_META: Record<OpenReelSyncState, { label: string; classes: string }> = {
  synced: {
    label: 'Сохранено',
    classes: 'bg-emerald/15 border-emerald text-emerald',
  },
  saving: {
    label: 'Сохраняем...',
    classes: 'bg-amber/15 border-amber text-amber',
  },
  error: {
    label: 'Ошибка сохранения',
    classes: 'bg-rose-dim border-rose text-rose',
  },
}

interface OpenReelSyncStatusProps {
  status: OpenReelSyncState
}

export function OpenReelSyncStatus({ status }: OpenReelSyncStatusProps) {
  const meta = STATUS_META[status]

  return (
    <span
      className={`inline-flex items-center rounded-[5px] border-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${meta.classes}`}
      role="status"
      aria-live="polite"
    >
      {meta.label}
    </span>
  )
}
