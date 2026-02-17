import { useState } from 'react'
import { useProjectStore } from '../stores/projectStore'
import { ShotCard } from './ShotCard'
import { ShotDetail } from './ShotDetail'
import { AnimatePresence, motion } from 'framer-motion'
import { XCircle, Sparkles, CheckCircle2, ArrowRight, ArrowLeft, Wand2, Film } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  type CollisionDetection,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Shot, ShotStatus } from '../types'

const COLUMN_PREFIX = 'column:'

const COLUMNS: { status: ShotStatus; label: string; color: string }[] = [
  { status: 'draft', label: 'Черновик', color: 'text-text-muted' },
  { status: 'img_gen', label: 'Изображение', color: 'text-violet' },
  { status: 'img_review', label: 'Ревью IMG', color: 'text-sky' },
  { status: 'vid_gen', label: 'Видео', color: 'text-violet' },
  { status: 'vid_review', label: 'Ревью VID', color: 'text-amber' },
  { status: 'approved', label: 'Готово', color: 'text-emerald' },
]

function parseColumnId(id: string): ShotStatus | null {
  if (id.startsWith(COLUMN_PREFIX)) {
    return id.slice(COLUMN_PREFIX.length) as ShotStatus
  }
  return null
}

function DroppableColumn({
  status,
  children,
  isOver,
}: {
  status: ShotStatus
  children: React.ReactNode
  isOver: boolean
}) {
  const { setNodeRef } = useDroppable({ id: `${COLUMN_PREFIX}${status}` })
  return (
    <div
      ref={setNodeRef}
      className={`flex-1 space-y-2 overflow-y-auto pr-1 rounded-lg transition-colors min-h-[60px] p-1 ${
        isOver ? 'bg-amber/5 ring-1 ring-amber/20' : ''
      }`}
    >
      {children}
    </div>
  )
}

function SortableShotCard({
  shot,
  isActive,
  briefAssets,
  onClick,
}: {
  shot: Shot
  isActive: boolean
  briefAssets: any[]
  onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: shot.id,
    data: { status: shot.status },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ShotCard shot={shot} isActive={isActive} briefAssets={briefAssets} onClick={onClick} />
    </div>
  )
}

// Custom collision: prefer pointerWithin, fallback to rectIntersection
const kanbanCollision: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args)
  if (pointerCollisions.length > 0) return pointerCollisions
  return rectIntersection(args)
}

export function ShotBoard() {
  const project = useProjectStore((s) => s.activeProject())
  const activeShotId = useProjectStore((s) => s.activeShotId)
  const setActiveShotId = useProjectStore((s) => s.setActiveShotId)
  const generateImage = useProjectStore((s) => s.generateImage)
  const generateVideoAction = useProjectStore((s) => s.generateVideo)
  const cancelAllGeneration = useProjectStore((s) => s.cancelAllGeneration)
  const enhanceAll = useProjectStore((s) => s.enhanceAll)
  const updateShotStatus = useProjectStore((s) => s.updateShotStatus)
  const generateAllVideosAction = useProjectStore((s) => s.generateAllVideos)
  const [enhancingAll, setEnhancingAll] = useState(false)
  const [generatingAllVideos, setGeneratingAllVideos] = useState(false)

  const [activeId, setActiveId] = useState<string | null>(null)
  const [overColumn, setOverColumn] = useState<ShotStatus | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  if (!project) return null

  const handleBulkGenerateImages = () => {
    const drafts = project.shots.filter((s) => s.status === 'draft')
    for (const shot of drafts) generateImage(shot.id)
  }

  const handleBulkGenerateVideos = () => {
    const imgReviewShots = project.shots.filter((s) => s.status === 'img_review' && s.generatedImages.length > 0)
    for (const shot of imgReviewShots) generateVideoAction(shot.id)
  }

  const handleEnhanceAll = async () => {
    setEnhancingAll(true)
    try {
      await enhanceAll()
    } finally {
      setEnhancingAll(false)
    }
  }

  const handleBulkApproveVideos = () => {
    const vidReviewShots = project.shots.filter((s) => s.status === 'vid_review')
    for (const shot of vidReviewShots) updateShotStatus(project.id, shot.id, 'approved')
  }

  const handleGenerateAllVideos = async () => {
    setGeneratingAllVideos(true)
    try {
      await generateAllVideosAction()
    } finally {
      setGeneratingAllVideos(false)
    }
  }

  const handleBulkMove = (from: ShotStatus, to: ShotStatus) => {
    const shots = project.shots.filter((s) => s.status === from)
    for (const shot of shots) updateShotStatus(project.id, shot.id, to)
  }

  const resolveStatus = (overId: string | number): ShotStatus | null => {
    // Check if it's a column
    const colStatus = parseColumnId(String(overId))
    if (colStatus) return colStatus
    // Check if it's a shot
    const overShot = project.shots.find((s) => s.id === overId)
    if (overShot) return overShot.status
    return null
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event
    if (!over) {
      setOverColumn(null)
      return
    }
    setOverColumn(resolveStatus(over.id))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)
    setOverColumn(null)

    if (!over) return

    const shotId = active.id as string
    const shot = project.shots.find((s) => s.id === shotId)
    if (!shot) return

    const targetStatus = resolveStatus(over.id)
    if (targetStatus && targetStatus !== shot.status) {
      updateShotStatus(project.id, shotId, targetStatus)
    }
  }

  const draggedShot = activeId ? project.shots.find((s) => s.id === activeId) : null

  return (
    <div className="flex-1 flex overflow-hidden">
      <DndContext
        sensors={sensors}
        collisionDetection={kanbanCollision}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {/* Kanban board */}
        <div
          className={`flex-1 overflow-x-auto p-6 transition-all ${activeShotId ? 'w-[55%]' : 'w-full'}`}
        >
          <div className="flex gap-4 h-full min-w-max">
            {COLUMNS.map((col) => {
              const shots = project.shots
                .filter((s) => s.status === col.status)
                .sort((a, b) => a.order - b.order)

              const isOverThis = overColumn === col.status && activeId !== null

              return (
                <div key={col.status} className="w-60 flex flex-col shrink-0">
                  {/* Column header */}
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        col.status === 'draft'
                          ? 'bg-text-muted'
                          : col.status === 'img_gen' || col.status === 'vid_gen'
                            ? 'bg-violet animate-pulse'
                            : col.status === 'img_review'
                              ? 'bg-sky'
                              : col.status === 'vid_review'
                                ? 'bg-amber'
                                : 'bg-emerald'
                      }`}
                    />
                    <span className={`font-mono text-xs uppercase tracking-wider ${col.color}`}>
                      {col.label}
                    </span>
                    <span className="font-mono text-[10px] text-text-muted ml-auto mr-1">
                      {shots.length}
                    </span>

                    {/* Bulk actions per column */}
                    {col.status === 'draft' && shots.length > 0 && (
                      <button
                        onClick={handleBulkGenerateImages}
                        title="Генерировать все изображения"
                        className="p-0.5 rounded hover:bg-violet/10 text-violet transition-colors"
                      >
                        <Sparkles size={12} />
                      </button>
                    )}
                    {col.status === 'img_gen' && shots.length > 0 && (
                      <button
                        onClick={cancelAllGeneration}
                        title="Отменить все"
                        className="p-0.5 rounded hover:bg-red-500/10 text-red-400 transition-colors"
                      >
                        <XCircle size={12} />
                      </button>
                    )}
                    {col.status === 'img_review' && shots.length > 0 && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleBulkMove('img_review', 'draft')}
                          title="Все в черновик"
                          className="p-0.5 rounded hover:bg-text-muted/10 text-text-muted transition-colors"
                        >
                          <ArrowLeft size={12} />
                        </button>
                        <button
                          onClick={handleEnhanceAll}
                          disabled={enhancingAll}
                          title="Enhance все"
                          className="p-0.5 rounded hover:bg-amber/10 text-amber transition-colors disabled:opacity-50"
                        >
                          {enhancingAll ? (
                            <div className="w-3 h-3 rounded-full border-2 border-amber border-t-transparent animate-spin" />
                          ) : (
                            <Wand2 size={12} />
                          )}
                        </button>
                        <button
                          onClick={handleBulkGenerateVideos}
                          title="Генерировать все видео"
                          className="p-0.5 rounded hover:bg-violet/10 text-violet transition-colors"
                        >
                          <Film size={12} />
                        </button>
                      </div>
                    )}
                    {col.status === 'vid_gen' && shots.length > 0 && (
                      <button
                        onClick={cancelAllGeneration}
                        title="Отменить все"
                        className="p-0.5 rounded hover:bg-red-500/10 text-red-400 transition-colors"
                      >
                        <XCircle size={12} />
                      </button>
                    )}
                    {col.status === 'vid_review' && shots.length > 0 && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleBulkMove('vid_review', 'img_review')}
                          title="Все на ревью изображений"
                          className="p-0.5 rounded hover:bg-sky/10 text-sky transition-colors"
                        >
                          <ArrowLeft size={12} />
                        </button>
                        <button
                          onClick={handleBulkApproveVideos}
                          title="Утвердить все"
                          className="p-0.5 rounded hover:bg-emerald/10 text-emerald transition-colors"
                        >
                          <CheckCircle2 size={12} />
                        </button>
                      </div>
                    )}
                    {col.status === 'approved' && shots.length > 0 && (
                      <button
                        onClick={() => handleBulkMove('approved', 'vid_review')}
                        title="Все на ревью видео"
                        className="p-0.5 rounded hover:bg-amber/10 text-amber transition-colors"
                      >
                        <ArrowLeft size={12} />
                      </button>
                    )}
                  </div>

                  {/* Cards — sortable + droppable area */}
                  <SortableContext
                    items={shots.map((s) => s.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <DroppableColumn status={col.status} isOver={isOverThis}>
                      {shots.map((shot) => (
                        <SortableShotCard
                          key={shot.id}
                          shot={shot}
                          isActive={activeShotId === shot.id}
                          briefAssets={project.brief.assets}
                          onClick={() =>
                            setActiveShotId(activeShotId === shot.id ? null : shot.id)
                          }
                        />
                      ))}

                      {shots.length === 0 && (
                        <div
                          className={`border border-dashed rounded-lg p-6 text-center ${
                            isOverThis ? 'border-amber/30' : 'border-border'
                          }`}
                        >
                          <p className="text-xs text-text-muted">
                            {isOverThis ? 'Перетащите сюда' : 'Пусто'}
                          </p>
                        </div>
                      )}
                    </DroppableColumn>
                  </SortableContext>
                </div>
              )
            })}
          </div>
        </div>

        {/* Drag overlay */}
        <DragOverlay>
          {draggedShot && (
            <div className="opacity-90 rotate-2 scale-105">
              <ShotCard
                shot={draggedShot}
                isActive={false}
                briefAssets={project.brief.assets}
                onClick={() => {}}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>

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
