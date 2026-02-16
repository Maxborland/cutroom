import { useProjectStore } from '../stores/projectStore'
import { ShotCard } from './ShotCard'
import { ShotDetail } from './ShotDetail'
import { AnimatePresence, motion } from 'framer-motion'
import type { ShotStatus } from '../types'

const COLUMNS: { status: ShotStatus; label: string; color: string }[] = [
  { status: 'draft', label: 'Черновик', color: 'text-text-muted' },
  { status: 'generating', label: 'Генерация', color: 'text-violet' },
  { status: 'review', label: 'Ревью', color: 'text-sky' },
  { status: 'approved', label: 'Готово', color: 'text-emerald' },
]

export function ShotBoard() {
  const project = useProjectStore((s) => s.activeProject())
  const activeShotId = useProjectStore((s) => s.activeShotId)
  const setActiveShotId = useProjectStore((s) => s.setActiveShotId)

  if (!project) return null

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Kanban board */}
      <div
        className={`flex-1 overflow-x-auto p-6 transition-all ${activeShotId ? 'w-[55%]' : 'w-full'}`}
      >
        <div className="flex gap-4 h-full min-w-max">
          {COLUMNS.map((col) => {
            const shots = project.shots
              .filter((s) => s.status === col.status)
              .sort((a, b) => a.order - b.order)

            return (
              <div key={col.status} className="w-72 flex flex-col shrink-0">
                {/* Column header */}
                <div className="flex items-center gap-2 mb-3 px-1">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      col.status === 'draft'
                        ? 'bg-text-muted'
                        : col.status === 'generating'
                          ? 'bg-violet animate-pulse'
                          : col.status === 'review'
                            ? 'bg-sky'
                            : 'bg-emerald'
                    }`}
                  />
                  <span className={`font-mono text-xs uppercase tracking-wider ${col.color}`}>
                    {col.label}
                  </span>
                  <span className="font-mono text-[10px] text-text-muted ml-auto">
                    {shots.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 space-y-2 overflow-y-auto pr-1">
                  <AnimatePresence>
                    {shots.map((shot) => (
                      <motion.div
                        key={shot.id}
                        layout
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                      >
                        <ShotCard
                          shot={shot}
                          isActive={activeShotId === shot.id}
                          briefAssets={project.brief.assets}
                          onClick={() =>
                            setActiveShotId(activeShotId === shot.id ? null : shot.id)
                          }
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>

                  {shots.length === 0 && (
                    <div className="border border-dashed border-border rounded-lg p-6 text-center">
                      <p className="text-xs text-text-muted">Пусто</p>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Shot detail panel */}
      <AnimatePresence>
        {activeShotId && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: '45%', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="border-l border-border overflow-hidden"
          >
            <ShotDetail onClose={() => setActiveShotId(null)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
