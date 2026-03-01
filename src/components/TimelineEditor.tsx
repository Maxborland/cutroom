/**
 * TimelineEditor — интерактивный монтажный стол.
 *
 * Drag-and-drop reorder (HTML5 DnD, без библиотек),
 * inline-edit длительности, переключение переходов,
 * motion-эффект, intro/outro duration.
 */
import { useState, useRef, useCallback } from 'react'
import { api } from '../lib/api'
import type { MontagePlan, TimelineEntry, TransitionEntry } from '../types'
import {
  GripVertical,
  ChevronDown,
  ChevronUp,
  Clock,
  Scissors,
  Sparkles,
  Loader2,
} from 'lucide-react'

const TRANSITION_TYPES = ['cut', 'fade', 'crossfade', 'wipe'] as const
const TRANSITION_LABELS: Record<string, string> = {
  cut: 'Резка',
  fade: 'Затухание',
  crossfade: 'Наплыв',
  slide_left: 'Сдвиг ←',
  slide_right: 'Сдвиг →',
  zoom_blur: 'Зум-блюр',
  wipe: 'Шторка',
}

const MOTION_EFFECTS = [
  { id: '', label: 'Нет' },
  { id: 'ken_burns', label: 'Ken Burns' },
  { id: 'zoom_in', label: 'Приближение' },
  { id: 'zoom_out', label: 'Отдаление' },
  { id: 'pan_left', label: 'Панорама ←' },
  { id: 'pan_right', label: 'Панорама →' },
]

interface Props {
  projectId: string
  plan: MontagePlan
  onPlanUpdated: (plan: MontagePlan) => void
}

export function TimelineEditor({ projectId, plan, onPlanUpdated }: Props) {
  const [expandedShot, setExpandedShot] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const dragItemRef = useRef<number | null>(null)

  // ── Drag handlers ────────────────────────────────────

  const handleDragStart = useCallback((index: number) => {
    dragItemRef.current = index
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    setDragOverIndex(null)
    const dragIndex = dragItemRef.current
    if (dragIndex === null || dragIndex === dropIndex) return

    // Reorder locally
    const newTimeline = [...plan.timeline]
    const [moved] = newTimeline.splice(dragIndex, 1)
    newTimeline.splice(dropIndex, 0, moved)

    // Save to server
    setSaving(true)
    try {
      const result = await api.montage.reorderTimeline(
        projectId,
        newTimeline.map(e => ({ shotId: e.shotId, durationSec: e.durationSec }))
      )
      onPlanUpdated(result.montagePlan)
    } catch (err) {
      console.error('Reorder failed:', err)
    } finally {
      setSaving(false)
      dragItemRef.current = null
    }
  }, [plan.timeline, projectId, onPlanUpdated])

  // ── Clip update ──────────────────────────────────────

  const updateClip = useCallback(async (shotId: string, data: { durationSec?: number; trimEndSec?: number; motionEffect?: string | null }) => {
    setSaving(true)
    try {
      const result = await api.montage.updateTimelineEntry(projectId, shotId, data)
      onPlanUpdated(result.montagePlan)
    } catch (err) {
      console.error('Update clip failed:', err)
    } finally {
      setSaving(false)
    }
  }, [projectId, onPlanUpdated])

  // ── Transition cycle ─────────────────────────────────

  const cycleTransition = useCallback(async (index: number) => {
    const current = plan.transitions[index]
    if (!current) return
    const currentIdx = TRANSITION_TYPES.indexOf(current.type as typeof TRANSITION_TYPES[number])
    const nextType = TRANSITION_TYPES[(currentIdx + 1) % TRANSITION_TYPES.length]

    setSaving(true)
    try {
      const result = await api.montage.updateTransition(projectId, index, { type: nextType })
      onPlanUpdated(result.montagePlan)
    } catch (err) {
      console.error('Update transition failed:', err)
    } finally {
      setSaving(false)
    }
  }, [plan.transitions, projectId, onPlanUpdated])

  // ── Total duration ───────────────────────────────────

  const introDur = plan.motionGraphics.intro?.durationSec ?? 0
  const outroDur = plan.motionGraphics.outro?.durationSec ?? 0
  const clipsDur = plan.timeline.reduce((s, e) => s + e.durationSec, 0)
  const totalDur = introDur + clipsDur + outroDur

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
            Таймлайн
          </span>
          {saving && <Loader2 size={12} className="animate-spin text-amber" />}
        </div>
        <span className="font-mono text-xs text-text-muted">
          {Math.round(totalDur)}с • {plan.timeline.length} клипов
        </span>
      </div>

      {/* Intro */}
      {plan.motionGraphics.intro && (
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-amber/15 border border-amber/40 rounded px-3 py-1.5 flex items-center justify-between">
            <span className="font-mono text-[10px] text-amber uppercase">
              Интро: {plan.motionGraphics.intro.title}
            </span>
            <span className="font-mono text-[10px] text-amber/70">
              {plan.motionGraphics.intro.durationSec}с
            </span>
          </div>
        </div>
      )}

      {/* Transition: intro → first clip */}
      {plan.transitions.length > 0 && plan.transitions[0]?.fromShotId === 'intro' && (
        <TransitionPill
          transition={plan.transitions[0]}
          index={0}
          onClick={cycleTransition}
          disabled={saving}
        />
      )}

      {/* Timeline clips */}
      {plan.timeline.map((entry, i) => {
        // Find transition BETWEEN clips (not intro/outro)
        const transitionAfter = plan.transitions.find(
          t => t.fromShotId === entry.shotId && t.toShotId !== 'outro'
        )
        const transitionAfterIndex = transitionAfter
          ? plan.transitions.indexOf(transitionAfter)
          : -1

        return (
          <div key={entry.shotId}>
            {/* Clip card */}
            <div
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, i)}
              className={`bg-surface-1 border-2 rounded-[5px] transition-all cursor-grab active:cursor-grabbing ${
                dragOverIndex === i
                  ? 'border-amber shadow-brutal-sm'
                  : expandedShot === entry.shotId
                    ? 'border-sky'
                    : 'border-border hover:border-text-secondary'
              }`}
            >
              {/* Clip header — always visible */}
              <button
                type="button"
                className="w-full flex items-center gap-2 px-3 py-2 text-left"
                onClick={() => setExpandedShot(expandedShot === entry.shotId ? null : entry.shotId)}
              >
                <GripVertical size={14} className="text-text-muted shrink-0" />
                <span className="font-mono text-xs text-sky font-semibold">
                  {i + 1}
                </span>
                <span className="font-mono text-[10px] text-text-muted truncate flex-1" title={entry.shotId}>
                  {entry.shotId}
                </span>
                <span className="font-mono text-xs text-text-secondary tabular-nums">
                  {entry.durationSec.toFixed(1)}с
                </span>
                {entry.motionEffect && (
                  <Sparkles size={12} className="text-amber shrink-0" title={entry.motionEffect} />
                )}
                {expandedShot === entry.shotId
                  ? <ChevronUp size={14} className="text-text-muted shrink-0" />
                  : <ChevronDown size={14} className="text-text-muted shrink-0" />
                }
              </button>

              {/* Expanded: edit duration, trim, motion */}
              {expandedShot === entry.shotId && (
                <ClipEditor
                  entry={entry}
                  onUpdate={(data) => updateClip(entry.shotId, data)}
                  disabled={saving}
                />
              )}
            </div>

            {/* Transition pill between this and next clip */}
            {transitionAfter && transitionAfterIndex >= 0 && (
              <TransitionPill
                transition={transitionAfter}
                index={transitionAfterIndex}
                onClick={cycleTransition}
                disabled={saving}
              />
            )}
          </div>
        )
      })}

      {/* Transition: last clip → outro */}
      {plan.transitions.length > 0 && plan.transitions[plan.transitions.length - 1]?.toShotId === 'outro' && (
        <TransitionPill
          transition={plan.transitions[plan.transitions.length - 1]}
          index={plan.transitions.length - 1}
          onClick={cycleTransition}
          disabled={saving}
        />
      )}

      {/* Outro */}
      {plan.motionGraphics.outro && (
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-amber/15 border border-amber/40 rounded px-3 py-1.5 flex items-center justify-between">
            <span className="font-mono text-[10px] text-amber uppercase">
              Аутро: {plan.motionGraphics.outro.title}
            </span>
            <span className="font-mono text-[10px] text-amber/70">
              {plan.motionGraphics.outro.durationSec}с
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────

function TransitionPill({
  transition,
  index,
  onClick,
  disabled,
}: {
  transition: TransitionEntry
  index: number
  onClick: (index: number) => void
  disabled: boolean
}) {
  const label = TRANSITION_LABELS[transition.type] || transition.type
  return (
    <div className="flex justify-center py-0.5">
      <button
        type="button"
        onClick={() => onClick(index)}
        disabled={disabled}
        className="px-3 py-0.5 rounded-full bg-surface-2 border border-border font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-amber hover:text-amber transition-colors disabled:opacity-50"
        title="Нажмите, чтобы сменить тип перехода"
      >
        {label} • {transition.durationSec}с
      </button>
    </div>
  )
}

function ClipEditor({
  entry,
  onUpdate,
  disabled,
}: {
  entry: TimelineEntry
  onUpdate: (data: { durationSec?: number; trimEndSec?: number; motionEffect?: string | null }) => void
  disabled: boolean
}) {
  const [dur, setDur] = useState(entry.durationSec)
  const [trim, setTrim] = useState(entry.trimEndSec ?? 0)
  const [motion, setMotion] = useState(entry.motionEffect || '')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const debouncedUpdate = useCallback((data: Record<string, unknown>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onUpdate(data as any)
    }, 500)
  }, [onUpdate])

  return (
    <div className="px-3 pb-3 pt-1 border-t border-border space-y-3">
      {/* Duration slider */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Clock size={12} className="text-text-muted" />
          <label className="font-mono text-[9px] uppercase tracking-wider text-text-muted flex-1">
            Длительность
          </label>
          <span className="font-mono text-xs text-text-secondary tabular-nums w-12 text-right">
            {dur.toFixed(1)}с
          </span>
        </div>
        <input
          type="range"
          min={0.5}
          max={30}
          step={0.5}
          value={dur}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            setDur(v)
            debouncedUpdate({ durationSec: v })
          }}
          disabled={disabled}
          className="w-full h-1.5 bg-surface-2 rounded-full appearance-none cursor-pointer accent-sky"
        />
      </div>

      {/* Trim end */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Scissors size={12} className="text-text-muted" />
          <label className="font-mono text-[9px] uppercase tracking-wider text-text-muted flex-1">
            Обрезка с конца
          </label>
          <span className="font-mono text-xs text-text-secondary tabular-nums w-12 text-right">
            {trim.toFixed(1)}с
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={10}
          step={0.1}
          value={trim}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            setTrim(v)
            debouncedUpdate({ trimEndSec: v })
          }}
          disabled={disabled}
          className="w-full h-1.5 bg-surface-2 rounded-full appearance-none cursor-pointer accent-sky"
        />
      </div>

      {/* Motion effect */}
      <div className="flex items-center gap-2">
        <Sparkles size={12} className="text-text-muted" />
        <label className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
          Эффект
        </label>
        <select
          value={motion}
          onChange={(e) => {
            const v = e.target.value
            setMotion(v)
            onUpdate({ motionEffect: v || null })
          }}
          disabled={disabled}
          className="flex-1 bg-surface-2 border border-border rounded px-2 py-1 font-mono text-[10px] focus:border-amber outline-none"
        >
          {MOTION_EFFECTS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
