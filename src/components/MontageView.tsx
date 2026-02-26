import { useState, useEffect, useCallback, useRef } from 'react'
import { useProjectStore } from '../stores/projectStore'
import { api } from '../lib/api'
import type { MontagePlan, RenderJob, Project } from '../types'
import {
  Mic,
  Music,
  Film,
  Play,
  Download,
  RefreshCw,
  Check,
  X,
  Loader2,
  Wand2,
  Upload,
  Edit3,
  Volume2,
  Clapperboard,
  ChevronDown,
  ChevronUp,
  Send,
  AlertCircle,
} from 'lucide-react'

type MontageStep = 'voiceover' | 'music' | 'plan' | 'render'

export function MontageView() {
  const project = useProjectStore((s) => s.activeProject())
  const refreshProject = useProjectStore((s) => s.loadProject)
  const [activeStep, setActiveStep] = useState<MontageStep>('voiceover')

  if (!project) return null

  const approved = project.shots.filter((s) => s.status === 'approved')

  if (approved.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="bg-surface-2 border-2 border-amber rounded-[5px] p-8 max-w-md text-center shadow-brutal">
          <AlertCircle size={48} className="text-amber mx-auto mb-4" />
          <h2 className="font-heading font-bold text-lg mb-2">Нет утверждённых шотов</h2>
          <p className="text-text-muted text-sm">
            Утвердите хотя бы один шот в ревью, чтобы начать монтаж.
          </p>
        </div>
      </div>
    )
  }

  const steps: { id: MontageStep; label: string; icon: React.ReactNode; done: boolean }[] = [
    {
      id: 'voiceover',
      label: 'Озвучка',
      icon: <Mic size={16} />,
      done: !!project.voiceoverFile,
    },
    {
      id: 'music',
      label: 'Музыка',
      icon: <Music size={16} />,
      done: !!project.musicFile,
    },
    {
      id: 'plan',
      label: 'План монтажа',
      icon: <Film size={16} />,
      done: !!project.montagePlan,
    },
    {
      id: 'render',
      label: 'Рендер',
      icon: <Clapperboard size={16} />,
      done: project.renders?.some((r) => r.status === 'done') ?? false,
    },
  ]

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Step navigation */}
        <div className="flex gap-2">
          {steps.map((step) => (
            <button
              key={step.id}
              onClick={() => setActiveStep(step.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-[5px] border-2 font-mono text-xs uppercase tracking-wider transition-colors ${
                activeStep === step.id
                  ? 'bg-amber text-surface-1 border-amber shadow-brutal-sm'
                  : step.done
                    ? 'bg-surface-2 border-emerald text-emerald'
                    : 'bg-surface-2 border-border text-text-muted hover:border-text-secondary'
              }`}
            >
              {step.done && activeStep !== step.id ? <Check size={14} /> : step.icon}
              {step.label}
            </button>
          ))}
        </div>

        {/* Step content */}
        {activeStep === 'voiceover' && (
          <VoiceoverStep project={project} onRefresh={() => refreshProject(project.id)} />
        )}
        {activeStep === 'music' && (
          <MusicStep project={project} onRefresh={() => refreshProject(project.id)} />
        )}
        {activeStep === 'plan' && (
          <PlanStep project={project} onRefresh={() => refreshProject(project.id)} />
        )}
        {activeStep === 'render' && (
          <RenderStep project={project} onRefresh={() => refreshProject(project.id)} />
        )}
      </div>
    </div>
  )
}

// ── Voiceover Step ──────────────────────────────────────────────────

function VoiceoverStep({ project, onRefresh }: { project: Project; onRefresh: () => void }) {
  const [loading, setLoading] = useState(false)
  const [script, setScript] = useState(project.voiceoverScript || '')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    setScript(project.voiceoverScript || '')
  }, [project.voiceoverScript])

  const generateScript = async () => {
    setLoading(true)
    try {
      const result = await api.montage.generateVoScript(project.id)
      setScript(result.voiceoverScript)
      onRefresh()
    } finally {
      setLoading(false)
    }
  }

  const saveScript = async () => {
    setLoading(true)
    try {
      await api.montage.updateVoScript(project.id, script)
      setEditing(false)
      onRefresh()
    } finally {
      setLoading(false)
    }
  }

  const approveScript = async () => {
    setLoading(true)
    try {
      await api.montage.approveVoScript(project.id)
      onRefresh()
    } finally {
      setLoading(false)
    }
  }

  const generateAudio = async () => {
    setLoading(true)
    try {
      await api.montage.generateVoiceover(project.id)
      onRefresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-surface-2 border-2 border-border rounded-[5px] p-6 shadow-brutal-sm">
        <h3 className="font-heading font-semibold text-base mb-4 flex items-center gap-2">
          <Mic size={18} />
          Скрипт озвучки
        </h3>

        {!script && !loading && (
          <button
            onClick={generateScript}
            className="flex items-center gap-2 px-4 py-2 bg-amber text-surface-1 rounded-[5px] border-2 border-amber font-mono text-xs uppercase tracking-wider shadow-brutal-sm hover:translate-y-[1px] hover:shadow-none transition-all"
          >
            <Wand2 size={14} />
            Сгенерировать скрипт
          </button>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-text-muted">
            <Loader2 size={16} className="animate-spin" />
            <span className="font-mono text-xs">Обработка...</span>
          </div>
        )}

        {script && (
          <div className="space-y-3">
            {editing ? (
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                className="w-full h-40 bg-surface-1 border-2 border-border rounded-[5px] p-3 font-mono text-sm text-text-primary resize-y focus:border-amber outline-none"
              />
            ) : (
              <div className="bg-surface-1 border-2 border-border rounded-[5px] p-4">
                <p className="text-sm text-text-secondary whitespace-pre-wrap">{script}</p>
              </div>
            )}

            <div className="flex gap-2">
              {editing ? (
                <>
                  <button onClick={saveScript} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-amber text-surface-1 rounded-[5px] border-2 border-amber font-mono text-xs uppercase tracking-wider shadow-brutal-sm hover:translate-y-[1px] hover:shadow-none transition-all disabled:opacity-50">
                    <Check size={14} /> Сохранить
                  </button>
                  <button onClick={() => { setEditing(false); setScript(project.voiceoverScript || '') }} className="flex items-center gap-2 px-4 py-2 bg-surface-1 text-text-secondary rounded-[5px] border-2 border-border font-mono text-xs uppercase tracking-wider hover:border-text-secondary transition-colors disabled:opacity-50">
                    <X size={14} /> Отмена
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => setEditing(true)} className="flex items-center gap-2 px-4 py-2 bg-surface-1 text-text-secondary rounded-[5px] border-2 border-border font-mono text-xs uppercase tracking-wider hover:border-text-secondary transition-colors disabled:opacity-50">
                    <Edit3 size={14} /> Редактировать
                  </button>
                  {!project.voiceoverScriptApproved && (
                    <button onClick={approveScript} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-amber text-surface-1 rounded-[5px] border-2 border-amber font-mono text-xs uppercase tracking-wider shadow-brutal-sm hover:translate-y-[1px] hover:shadow-none transition-all disabled:opacity-50">
                      <Check size={14} /> Утвердить
                    </button>
                  )}
                  <button onClick={generateScript} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-surface-1 text-text-secondary rounded-[5px] border-2 border-border font-mono text-xs uppercase tracking-wider hover:border-text-secondary transition-colors disabled:opacity-50">
                    <RefreshCw size={14} /> Перегенерировать
                  </button>
                </>
              )}
            </div>

            {project.voiceoverScriptApproved && (
              <div className="pt-2 border-t border-border">
                <div className="flex items-center gap-2 mb-3">
                  <Check size={14} className="text-emerald" />
                  <span className="font-mono text-xs text-emerald uppercase">Скрипт утверждён</span>
                </div>

                {project.voiceoverFile ? (
                  <div className="flex items-center gap-3">
                    <audio controls src={api.montage.voiceoverUrl(project.id)} className="flex-1" />
                    <button onClick={generateAudio} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-surface-1 text-text-secondary rounded-[5px] border-2 border-border font-mono text-xs uppercase tracking-wider hover:border-text-secondary transition-colors disabled:opacity-50">
                      <RefreshCw size={14} />
                    </button>
                  </div>
                ) : (
                  <button onClick={generateAudio} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-amber text-surface-1 rounded-[5px] border-2 border-amber font-mono text-xs uppercase tracking-wider shadow-brutal-sm hover:translate-y-[1px] hover:shadow-none transition-all disabled:opacity-50">
                    <Volume2 size={14} /> Сгенерировать аудио
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Music Step ──────────────────────────────────────────────────────

function MusicStep({ project, onRefresh }: { project: Project; onRefresh: () => void }) {
  const [loading, setLoading] = useState(false)
  const [prompt, setPrompt] = useState(project.musicPrompt || '')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setPrompt(project.musicPrompt || '')
  }, [project.musicPrompt])

  const generatePrompt = async () => {
    setLoading(true)
    try {
      const result = await api.montage.generateMusicPrompt(project.id)
      setPrompt(result.musicPrompt)
      onRefresh()
    } finally {
      setLoading(false)
    }
  }

  const savePrompt = async () => {
    setLoading(true)
    try {
      await api.montage.updateMusicPrompt(project.id, prompt)
      onRefresh()
    } finally {
      setLoading(false)
    }
  }

  const uploadMusic = async (file: File) => {
    setLoading(true)
    try {
      await api.montage.uploadMusic(project.id, file)
      onRefresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-surface-2 border-2 border-border rounded-[5px] p-6 shadow-brutal-sm">
        <h3 className="font-heading font-semibold text-base mb-4 flex items-center gap-2">
          <Music size={18} />
          Музыка
        </h3>

        {/* Prompt section */}
        <div className="space-y-3 mb-4">
          <label className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
            Промпт для Suno
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Опишите желаемую музыку..."
            className="w-full h-24 bg-surface-1 border-2 border-border rounded-[5px] p-3 font-mono text-sm text-text-primary resize-y focus:border-amber outline-none"
          />
          <div className="flex gap-2">
            <button onClick={generatePrompt} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-surface-1 text-text-secondary rounded-[5px] border-2 border-border font-mono text-xs uppercase tracking-wider hover:border-text-secondary transition-colors disabled:opacity-50">
              <Wand2 size={14} /> AI промпт
            </button>
            {prompt !== project.musicPrompt && (
              <button onClick={savePrompt} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-amber text-surface-1 rounded-[5px] border-2 border-amber font-mono text-xs uppercase tracking-wider shadow-brutal-sm hover:translate-y-[1px] hover:shadow-none transition-all disabled:opacity-50">
                <Check size={14} /> Сохранить
              </button>
            )}
          </div>
          {prompt && (
            <p className="text-xs text-text-muted">
              Скопируйте промпт в <a href="https://suno.ai" target="_blank" rel="noreferrer" className="text-amber underline">Suno</a>, сгенерируйте трек и загрузите ниже.
            </p>
          )}
        </div>

        {/* Upload section */}
        <div className="pt-4 border-t border-border">
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && uploadMusic(e.target.files[0])}
          />

          {project.musicFile ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Check size={14} className="text-emerald" />
                <span className="font-mono text-xs text-emerald uppercase">Музыка загружена</span>
              </div>
              <div className="flex items-center gap-3">
                <audio controls src={api.montage.musicUrl(project.id)} className="flex-1" />
                <button onClick={() => fileRef.current?.click()} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-surface-1 text-text-secondary rounded-[5px] border-2 border-border font-mono text-xs uppercase tracking-wider hover:border-text-secondary transition-colors disabled:opacity-50">
                  <Upload size={14} /> Заменить
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-amber text-surface-1 rounded-[5px] border-2 border-amber font-mono text-xs uppercase tracking-wider shadow-brutal-sm hover:translate-y-[1px] hover:shadow-none transition-all disabled:opacity-50"
            >
              <Upload size={14} /> Загрузить музыку
            </button>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-text-muted mt-2">
              <Loader2 size={16} className="animate-spin" />
              <span className="font-mono text-xs">Загрузка...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Plan Step ───────────────────────────────────────────────────────

function PlanStep({ project, onRefresh }: { project: Project; onRefresh: () => void }) {
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [showJson, setShowJson] = useState(false)

  const generatePlan = async () => {
    setLoading(true)
    try {
      await api.montage.generatePlan(project.id)
      onRefresh()
    } finally {
      setLoading(false)
    }
  }

  const refinePlan = async () => {
    if (!feedback.trim()) return
    setLoading(true)
    try {
      await api.montage.refinePlan(project.id, feedback)
      setFeedback('')
      onRefresh()
    } finally {
      setLoading(false)
    }
  }

  const plan = project.montagePlan

  return (
    <div className="space-y-4">
      <div className="bg-surface-2 border-2 border-border rounded-[5px] p-6 shadow-brutal-sm">
        <h3 className="font-heading font-semibold text-base mb-4 flex items-center gap-2">
          <Film size={18} />
          План монтажа
        </h3>

        {!plan && (
          <button onClick={generatePlan} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-amber text-surface-1 rounded-[5px] border-2 border-amber font-mono text-xs uppercase tracking-wider shadow-brutal-sm hover:translate-y-[1px] hover:shadow-none transition-all disabled:opacity-50">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            Сгенерировать план
          </button>
        )}

        {plan && (
          <div className="space-y-4">
            {/* Plan summary */}
            <div className="grid grid-cols-4 gap-3">
              <Stat label="Клипов" value={plan.timeline.length} />
              <Stat label="Переходов" value={plan.transitions.length} />
              <Stat
                label="Длительность"
                value={`${Math.round(
                  (plan.motionGraphics.intro?.durationSec ?? 3) +
                  plan.timeline.reduce((s, e) => s + e.durationSec, 0) +
                  (plan.motionGraphics.outro?.durationSec ?? 4)
                )}с`}
              />
              <Stat label="Титры" value={plan.motionGraphics.lowerThirds.length} />
            </div>

            {/* Timeline visual */}
            <div className="bg-surface-1 border-2 border-border rounded-[5px] p-4">
              <div className="flex gap-1 h-8">
                {/* Intro */}
                <div
                  className="bg-amber/30 border border-amber rounded-sm flex items-center justify-center"
                  style={{ flex: plan.motionGraphics.intro?.durationSec ?? 3 }}
                >
                  <span className="font-mono text-[8px] text-amber">INTRO</span>
                </div>
                {/* Clips */}
                {plan.timeline.map((entry, i) => (
                  <div
                    key={entry.shotId}
                    className="bg-sky/20 border border-sky rounded-sm flex items-center justify-center overflow-hidden"
                    style={{ flex: entry.durationSec }}
                    title={`${entry.shotId}: ${entry.durationSec.toFixed(1)}s`}
                  >
                    <span className="font-mono text-[8px] text-sky truncate px-1">
                      {i + 1}
                    </span>
                  </div>
                ))}
                {/* Outro */}
                <div
                  className="bg-amber/30 border border-amber rounded-sm flex items-center justify-center"
                  style={{ flex: plan.motionGraphics.outro?.durationSec ?? 4 }}
                >
                  <span className="font-mono text-[8px] text-amber">OUTRO</span>
                </div>
              </div>
            </div>

            {/* Refinement */}
            <div className="flex gap-2">
              <input
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Обратная связь: 'сделай переходы быстрее', 'убери титры'..."
                className="flex-1 bg-surface-1 border-2 border-border rounded-[5px] px-3 py-2 font-mono text-sm focus:border-amber outline-none"
                onKeyDown={(e) => e.key === 'Enter' && refinePlan()}
              />
              <button onClick={refinePlan} disabled={loading || !feedback.trim()} className="flex items-center gap-2 px-4 py-2 bg-amber text-surface-1 rounded-[5px] border-2 border-amber font-mono text-xs uppercase tracking-wider shadow-brutal-sm hover:translate-y-[1px] hover:shadow-none transition-all disabled:opacity-50">
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button onClick={generatePlan} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-surface-1 text-text-secondary rounded-[5px] border-2 border-border font-mono text-xs uppercase tracking-wider hover:border-text-secondary transition-colors disabled:opacity-50">
                <RefreshCw size={14} /> Перегенерировать
              </button>
              <button onClick={() => setShowJson(!showJson)} className="flex items-center gap-2 px-4 py-2 bg-surface-1 text-text-secondary rounded-[5px] border-2 border-border font-mono text-xs uppercase tracking-wider hover:border-text-secondary transition-colors disabled:opacity-50">
                {showJson ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                JSON
              </button>
            </div>

            {showJson && (
              <pre className="bg-surface-1 border-2 border-border rounded-[5px] p-4 overflow-auto max-h-96 font-mono text-xs text-text-muted">
                {JSON.stringify(plan, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Render Step ─────────────────────────────────────────────────────

function RenderStep({ project, onRefresh }: { project: Project; onRefresh: () => void }) {
  const [loading, setLoading] = useState(false)
  const [polling, setPolling] = useState<string | null>(null)
  const [currentJob, setCurrentJob] = useState<RenderJob | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Poll render status
  useEffect(() => {
    if (!polling) return
    const poll = async () => {
      try {
        const job = await api.montage.getRenderStatus(project.id, polling)
        setCurrentJob(job)
        if (job.status === 'done' || job.status === 'failed') {
          setPolling(null)
          onRefresh()
        }
      } catch {
        setPolling(null)
      }
    }
    intervalRef.current = setInterval(poll, 3000)
    poll()
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [polling, project.id])

  const startRender = async (quality: 'preview' | 'final') => {
    setLoading(true)
    try {
      const result = await api.montage.render(project.id, quality)
      setPolling(result.jobId)
      setCurrentJob({ ...result, createdAt: new Date().toISOString(), resolution: quality === 'final' ? '3840x2160' : '1280x720', progress: 0 } as RenderJob)
    } finally {
      setLoading(false)
    }
  }

  const renders = project.renders || []
  const doneRenders = renders.filter((r) => r.status === 'done')

  return (
    <div className="space-y-4">
      <div className="bg-surface-2 border-2 border-border rounded-[5px] p-6 shadow-brutal-sm">
        <h3 className="font-heading font-semibold text-base mb-4 flex items-center gap-2">
          <Clapperboard size={18} />
          Рендер
        </h3>

        {!project.montagePlan && (
          <div className="flex items-center gap-2 text-amber">
            <AlertCircle size={16} />
            <span className="text-sm">Сначала сгенерируйте план монтажа</span>
          </div>
        )}

        {project.montagePlan && (
          <div className="space-y-4">
            {/* Start render buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => startRender('preview')}
                disabled={loading || !!polling}
                className="flex items-center gap-2 px-4 py-2 bg-surface-1 text-text-secondary rounded-[5px] border-2 border-border font-mono text-xs uppercase tracking-wider hover:border-text-secondary transition-colors disabled:opacity-50"
              >
                <Play size={14} /> Превью (720p)
              </button>
              <button
                onClick={() => startRender('final')}
                disabled={loading || !!polling}
                className="flex items-center gap-2 px-4 py-2 bg-amber text-surface-1 rounded-[5px] border-2 border-amber font-mono text-xs uppercase tracking-wider shadow-brutal-sm hover:translate-y-[1px] hover:shadow-none transition-all disabled:opacity-50"
              >
                <Film size={14} /> Финальный (4K)
              </button>
            </div>

            {/* Current render progress */}
            {currentJob && (currentJob.status === 'queued' || currentJob.status === 'rendering') && (
              <div className="bg-surface-1 border-2 border-sky rounded-[5px] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Loader2 size={14} className="animate-spin text-sky" />
                  <span className="font-mono text-xs uppercase text-sky">
                    {currentJob.status === 'queued' ? 'В очереди...' : `Рендер ${currentJob.progress ?? 0}%`}
                  </span>
                </div>
                <div className="w-full bg-surface-2 rounded-full h-2">
                  <div
                    className="bg-sky h-2 rounded-full transition-all duration-500"
                    style={{ width: `${currentJob.progress ?? 0}%` }}
                  />
                </div>
              </div>
            )}

            {currentJob?.status === 'failed' && (
              <div className="bg-surface-1 border-2 border-red-500 rounded-[5px] p-4">
                <div className="flex items-center gap-2 text-red-400">
                  <X size={14} />
                  <span className="font-mono text-xs">Ошибка: {currentJob.errorMessage || 'Unknown'}</span>
                </div>
              </div>
            )}

            {/* Completed renders */}
            {doneRenders.length > 0 && (
              <div className="pt-4 border-t border-border">
                <h4 className="font-mono text-[10px] uppercase tracking-wider text-text-muted mb-3">
                  Готовые рендеры
                </h4>
                <div className="space-y-2">
                  {doneRenders.map((render) => (
                    <div
                      key={render.id}
                      className="flex items-center justify-between bg-surface-1 border-2 border-emerald rounded-[5px] p-3"
                    >
                      <div className="flex items-center gap-3">
                        <Check size={14} className="text-emerald" />
                        <span className="font-mono text-xs text-text-secondary">
                          {render.quality === 'final' ? '4K' : '720p'} — {render.resolution}
                        </span>
                        <span className="font-mono text-[10px] text-text-muted">
                          {new Date(render.createdAt).toLocaleString('ru')}
                        </span>
                      </div>
                      <a
                        href={api.montage.getRenderDownloadUrl(project.id, render.id)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-amber text-surface-1 rounded-[5px] border-2 border-amber font-mono text-xs uppercase tracking-wider shadow-brutal-sm hover:translate-y-[1px] hover:shadow-none transition-all"
                        download
                      >
                        <Download size={14} /> Скачать
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-surface-1 border-2 border-border rounded-[5px] p-3 text-center">
      <p className="font-mono text-lg font-bold text-text-primary">{value}</p>
      <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted mt-1">{label}</p>
    </div>
  )
}
