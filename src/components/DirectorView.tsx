import { useState, useMemo } from 'react'
import { useProjectStore } from '../stores/projectStore'
import { useLightboxStore } from '../stores/lightboxStore'
import { api } from '../lib/api'
import type { DirectorReview, DirectorNote, DirectorVerdict, Shot } from '../types'
import {
  Crown,
  FileText,
  LayoutGrid,
  Image as ImageIcon,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Copy,
  Sparkles,
  RotateCcw,
  Clock,
  AlertCircle,
} from 'lucide-react'

// Sub-components

type TabId = 'script' | 'shots' | 'images'

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'script', label: '\u0420\u0435\u0432\u044c\u044e \u0441\u0446\u0435\u043d\u0430\u0440\u0438\u044f', icon: <FileText size={14} /> },
  { id: 'shots', label: '\u0420\u0435\u0432\u044c\u044e \u0448\u043e\u0442\u043e\u0432', icon: <LayoutGrid size={14} /> },
  { id: 'images', label: '\u0420\u0435\u0432\u044c\u044e \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0439', icon: <ImageIcon size={14} /> },
]

function looksMojibake(text: string): boolean {
  if (!text) return false

  // Common UTF-8/CP1251 mojibake markers seen in stored reviews.
  if (/[\u00D0\u00D1\u00C3\u00E2]/.test(text)) return true

  const noisyPairs = (text.match(/(?:\u0420|\u0421)[^\s]/g) || []).length
  return noisyPairs / Math.max(text.length, 1) > 0.2
}

function safeReviewText(text: string, fallback: string): string {
  return looksMojibake(text) ? fallback : text
}

function DirectorTabBar({ active, onChange }: { active: TabId; onChange: (id: TabId) => void }) {
  return (
    <div className="flex border-b-2 border-border shrink-0">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex items-center gap-2 px-5 py-2.5 text-sm transition-colors ${
            active === tab.id
              ? 'border-b-2 border-amber font-bold text-text-primary -mb-[2px]'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function DirectorVerdictBadge({ verdict, size = 'md' }: { verdict: DirectorVerdict; size?: 'sm' | 'md' }) {
  const classes = {
    approve: 'bg-emerald-dim text-emerald border-emerald',
    revise: 'bg-amber-dim text-amber border-amber',
    reject: 'bg-rose-dim text-rose border-rose',
  }
  const icons = {
    approve: <CheckCircle2 size={size === 'sm' ? 10 : 12} />,
    revise: <AlertTriangle size={size === 'sm' ? 10 : 12} />,
    reject: <XCircle size={size === 'sm' ? 10 : 12} />,
  }
  const labels = {
    approve: '\u041e\u0434\u043e\u0431\u0440\u0435\u043d\u043e',
    revise: '\u0414\u043e\u0440\u0430\u0431\u043e\u0442\u043a\u0430',
    reject: '\u041e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u043e',
  }
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] border text-xs font-bold ${classes[verdict]} ${
        size === 'sm' ? 'text-[10px] px-1.5' : ''
      }`}
    >
      {icons[verdict]}
      {labels[verdict]}
    </span>
  )
}

function DirectorNoteCard({ note }: { note: DirectorNote }) {
  const borderColor = {
    approve: 'border-l-emerald',
    revise: 'border-l-amber',
    reject: 'border-l-rose',
  }
  return (
    <div className={`bg-surface-2 border-2 border-border ${borderColor[note.verdict]} border-l-4 rounded-[5px] p-3`}>
      <div className="flex items-center gap-2 mb-1.5">
        <DirectorVerdictBadge verdict={note.verdict} size="sm" />
        {note.target !== 'script' && note.target !== 'structure' && (
          <span className="font-mono text-[10px] text-text-muted">
            #{note.target.replace('shot-', '')}
          </span>
        )}
        {note.target === 'structure' && (
          <span className="font-mono text-[10px] text-text-muted">{'\u0441\u0442\u0440\u0443\u043a\u0442\u0443\u0440\u0430'}</span>
        )}
      </div>
      <p className="text-sm text-text-secondary leading-relaxed">
        {safeReviewText(note.comment, '\u0422\u0435\u043a\u0441\u0442 \u043a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u044f \u043f\u043e\u0432\u0440\u0435\u0436\u0434\u0435\u043d \u043a\u043e\u0434\u0438\u0440\u043e\u0432\u043a\u043e\u0439. \u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u0435 \u0440\u0435\u0432\u044c\u044e \u0437\u0430\u043d\u043e\u0432\u043e.')}
      </p>
      {note.suggestion && (
        <p className="text-sm text-amber mt-1.5 leading-relaxed">
          <Sparkles size={10} className="inline mr-1" />
          {safeReviewText(note.suggestion, '\u0422\u0435\u043a\u0441\u0442 \u0440\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0430\u0446\u0438\u0438 \u043f\u043e\u0432\u0440\u0435\u0436\u0434\u0435\u043d \u043a\u043e\u0434\u0438\u0440\u043e\u0432\u043a\u043e\u0439. \u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u0435 \u0440\u0435\u0432\u044c\u044e \u0437\u0430\u043d\u043e\u0432\u043e.')}
        </p>
      )}
    </div>
  )
}

function StaleWarning({ review, projectUpdated }: { review: DirectorReview; projectUpdated: string }) {
  if (!review || !projectUpdated) return null
  if (new Date(review.createdAt) >= new Date(projectUpdated)) return null
  return (
    <div className="flex items-center gap-2 bg-amber-dim border-2 border-amber rounded-[5px] px-4 py-2 text-sm text-amber">
      <AlertCircle size={14} className="shrink-0" />
      {'\u0414\u0430\u043d\u043d\u044b\u0435 \u043f\u0440\u043e\u0435\u043a\u0442\u0430 \u0438\u0437\u043c\u0435\u043d\u0438\u043b\u0438\u0441\u044c \u0441 \u043c\u043e\u043c\u0435\u043d\u0442\u0430 \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0435\u0433\u043e \u0440\u0435\u0432\u044c\u044e. \u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u0435 \u0440\u0435\u0432\u044c\u044e \u043f\u043e\u0432\u0442\u043e\u0440\u043d\u043e.'}
    </div>
  )
}

function getBestImage(shot: Shot): string | null {
  if (shot.enhancedImages?.length > 0) return shot.enhancedImages[shot.enhancedImages.length - 1]
  if (shot.generatedImages?.length > 0) return shot.generatedImages[shot.generatedImages.length - 1]
  return null
}

// Main Component

export function DirectorView() {
  const project = useProjectStore((s) => s.activeProject())
  const directorLoading = useProjectStore((s) => s.directorLoading)
  const directorReviewStage = useProjectStore((s) => s.directorReviewStage)
  const directorReviewScript = useProjectStore((s) => s.directorReviewScript)
  const directorReviewShots = useProjectStore((s) => s.directorReviewShots)
  const directorReviewImages = useProjectStore((s) => s.directorReviewImages)
  const directorApplyFeedback = useProjectStore((s) => s.directorApplyFeedback)
  const batchUpdateShotStatus = useProjectStore((s) => s.batchUpdateShotStatus)

  const [activeTab, setActiveTab] = useState<TabId>('script')

  const directorState = project?.directorState
  const reviews = directorState?.reviews || []
  const latestByStage = directorState?.latestByStage || {}

  const latestScriptReview = useMemo(
    () => reviews.find((r) => r.id === latestByStage['script']) || null,
    [reviews, latestByStage],
  )
  const latestShotsReview = useMemo(
    () => reviews.find((r) => r.id === latestByStage['shots']) || null,
    [reviews, latestByStage],
  )
  const latestImagesReview = useMemo(
    () => reviews.find((r) => r.id === latestByStage['images']) || null,
    [reviews, latestByStage],
  )

  const currentReview = activeTab === 'script' ? latestScriptReview
    : activeTab === 'shots' ? latestShotsReview
    : latestImagesReview

  const isLoading = directorLoading && (
    directorReviewStage === activeTab || directorReviewStage === 'all'
  )

  if (!project) return null

  const copyNotes = (review: DirectorReview | null) => {
    if (!review) return
    const notes = review.notes.filter((n) => !n.resolvedAt)
    const text = notes.length === 0
      ? '\u0410\u043a\u0442\u0438\u0432\u043d\u044b\u0445 \u0437\u0430\u043c\u0435\u0447\u0430\u043d\u0438\u0439 \u043d\u0435\u0442'
      : notes
        .map((n) => `[${n.verdict.toUpperCase()}] ${n.target}: ${n.comment}${n.suggestion ? `\n  -> ${n.suggestion}` : ''}`)
        .join('\n\n')
    navigator.clipboard.writeText(text)
  }

  // Script tab

  const renderScriptTab = () => {
    const paragraphs = project.script ? project.script.split('\n\n').filter(Boolean) : []

    return (
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left: Script */}
        <div className="flex-[3] overflow-y-auto p-4 border-r-2 border-border">
          {paragraphs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              {'\u0421\u0446\u0435\u043d\u0430\u0440\u0438\u0439 \u043f\u043e\u043a\u0430 \u043d\u0435 \u0437\u0430\u043f\u043e\u043b\u043d\u0435\u043d. \u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u0435 \u0433\u0435\u043d\u0435\u0440\u0430\u0446\u0438\u044e \u0438\u043b\u0438 \u0432\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u0435\u043a\u0441\u0442 \u0432\u0440\u0443\u0447\u043d\u0443\u044e \u043d\u0430 \u044d\u0442\u0430\u043f\u0435 \u00ab\u0421\u0446\u0435\u043d\u0430\u0440\u0438\u0439\u00bb.'}
            </div>
          ) : (
            <div className="max-w-2xl space-y-3">
              {paragraphs.map((p, i) => (
                <p key={i} className="text-sm text-text-secondary leading-relaxed">
                  <span className="font-mono text-[10px] text-text-muted mr-2 select-none">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  {p}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Right: Review */}
        <div className="flex-[2] overflow-y-auto p-4 flex flex-col gap-3">
          {latestScriptReview && (
            <StaleWarning review={latestScriptReview} projectUpdated={project.updated} />
          )}

          {latestScriptReview ? (
            <>
              <div className="flex items-center gap-3">
                <DirectorVerdictBadge verdict={latestScriptReview.overallVerdict} />
                <span className="text-[10px] text-text-muted font-mono">
                  {new Date(latestScriptReview.createdAt).toLocaleString('ru')}
                </span>
              </div>
              <p className="text-sm text-text-secondary leading-relaxed">
                {safeReviewText(latestScriptReview.summary, '\u0422\u0435\u043a\u0441\u0442 \u0438\u0442\u043e\u0433\u0430 \u043f\u043e\u0432\u0440\u0435\u0436\u0434\u0435\u043d \u043a\u043e\u0434\u0438\u0440\u043e\u0432\u043a\u043e\u0439. \u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u0435 \u0440\u0435\u0432\u044c\u044e \u0437\u0430\u043d\u043e\u0432\u043e.')}
              </p>
              <div className="space-y-2">
                {latestScriptReview.notes.map((note) => (
                  <DirectorNoteCard key={note.id} note={note} />
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                {latestScriptReview.overallVerdict !== 'approve' && (
                  <button
                    onClick={() => directorApplyFeedback(latestScriptReview.id, 'regenerate-script')}
                    disabled={directorLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] bg-amber text-black text-xs font-bold brutal-btn disabled:opacity-50"
                  >
                    {directorLoading ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                    {'\u041f\u0435\u0440\u0435\u0433\u0435\u043d\u0435\u0440\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0441\u0446\u0435\u043d\u0430\u0440\u0438\u0439'}
                  </button>
                )}
                <button
                  onClick={() => copyNotes(latestScriptReview)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] border-2 border-border text-xs text-text-secondary hover:text-text-primary"
                >
                  <Copy size={12} />
                  {'\u0421\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c'}
                </button>
              </div>
            </>
          ) : (
            <EmptyReviewState stage={'\u0441\u0446\u0435\u043d\u0430\u0440\u0438\u044f'} />
          )}
        </div>
      </div>
    )
  }

  // Shots tab

  const renderShotsTab = () => {
    const shots = project.shots || []

    return (
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left: Shots table */}
        <div className="flex-[3] overflow-y-auto p-4 border-r-2 border-border">
          {shots.length === 0 ? (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              {'\u0428\u043e\u0442\u044b \u0435\u0449\u0435 \u043d\u0435 \u0441\u043e\u0437\u0434\u0430\u043d\u044b. \u0420\u0430\u0437\u0431\u0435\u0439\u0442\u0435 \u0441\u0446\u0435\u043d\u0430\u0440\u0438\u0439 \u043d\u0430 \u0448\u043e\u0442\u044b \u043d\u0430 \u044d\u0442\u0430\u043f\u0435 \u00ab\u0428\u043e\u0442\u044b\u00bb.'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-border text-[10px] font-mono uppercase tracking-wider text-text-muted">
                  <th className="text-left py-2 px-2">#</th>
                  <th className="text-left py-2 px-2">{'\u0421\u0446\u0435\u043d\u0430'}</th>
                  <th className="text-center py-2 px-2">{'\u0414\u043b\u0438\u0442.'}</th>
                  <th className="text-center py-2 px-2">{'\u0410\u0441\u0441\u0435\u0442\u044b'}</th>
                  <th className="text-center py-2 px-2">{'\u0421\u0442\u0430\u0442\u0443\u0441'}</th>
                </tr>
              </thead>
              <tbody>
                {shots.map((shot, i) => (
                  <tr key={shot.id} className="border-b border-border hover:bg-surface-2">
                    <td className="py-2 px-2 font-mono text-amber font-bold">
                      {String(i + 1).padStart(2, '0')}
                    </td>
                    <td className="py-2 px-2 text-text-secondary max-w-[300px] truncate">
                      {shot.scene}
                    </td>
                    <td className="py-2 px-2 text-center font-mono text-text-muted">
                      {shot.duration}s
                    </td>
                    <td className="py-2 px-2 text-center font-mono text-text-muted">
                      {shot.assetRefs.length}
                    </td>
                    <td className="py-2 px-2 text-center">
                      <span className={`inline-block w-2.5 h-2.5 rounded-[2px] border border-border ${
                        shot.status === 'approved' ? 'bg-emerald' :
                        shot.status === 'draft' ? 'bg-text-muted' :
                        shot.status === 'img_gen' || shot.status === 'vid_gen' ? 'bg-violet animate-pulse' :
                        'bg-sky'
                      }`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Right: Review */}
        <div className="flex-[2] overflow-y-auto p-4 flex flex-col gap-3">
          {latestShotsReview && (
            <StaleWarning review={latestShotsReview} projectUpdated={project.updated} />
          )}

          {latestShotsReview ? (
            <>
              <div className="flex items-center gap-3">
                <DirectorVerdictBadge verdict={latestShotsReview.overallVerdict} />
                <span className="text-[10px] text-text-muted font-mono">
                  {new Date(latestShotsReview.createdAt).toLocaleString('ru')}
                </span>
              </div>
              <p className="text-sm text-text-secondary leading-relaxed">
                {safeReviewText(latestShotsReview.summary, '\u0422\u0435\u043a\u0441\u0442 \u0438\u0442\u043e\u0433\u0430 \u043f\u043e\u0432\u0440\u0435\u0436\u0434\u0435\u043d \u043a\u043e\u0434\u0438\u0440\u043e\u0432\u043a\u043e\u0439. \u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u0435 \u0440\u0435\u0432\u044c\u044e \u0437\u0430\u043d\u043e\u0432\u043e.')}
              </p>
              <div className="space-y-2">
                {latestShotsReview.notes.map((note) => (
                  <DirectorNoteCard key={note.id} note={note} />
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                {latestShotsReview.overallVerdict !== 'approve' && (
                  <button
                    onClick={() => directorApplyFeedback(latestShotsReview.id, 'regenerate-shots')}
                    disabled={directorLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] bg-amber text-black text-xs font-bold brutal-btn disabled:opacity-50"
                  >
                    {directorLoading ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                    {'\u041f\u0435\u0440\u0435\u0433\u0435\u043d\u0435\u0440\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0448\u043e\u0442\u044b'}
                  </button>
                )}
                <button
                  onClick={() => copyNotes(latestShotsReview)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] border-2 border-border text-xs text-text-secondary hover:text-text-primary"
                >
                  <Copy size={12} />
                  {'\u0421\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c'}
                </button>
              </div>
            </>
          ) : (
            <EmptyReviewState stage={'\u0448\u043e\u0442\u043e\u0432'} />
          )}
        </div>
      </div>
    )
  }

  // Images tab

  const renderImagesTab = () => {
    const shots = project.shots || []
    const shotsWithImages = shots.filter((s) => getBestImage(s) !== null)
    const shotVerdicts = latestImagesReview?.shotVerdicts || {}
    const openImageNotes = latestImagesReview
      ? latestImagesReview.notes.filter((note) => !note.resolvedAt)
      : []

    return (
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left: Image grid */}
        <div className="flex-[3] overflow-y-auto p-4 border-r-2 border-border">
          {shotsWithImages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              {'\u0418\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0439 \u0435\u0449\u0435 \u043d\u0435\u0442. \u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u0435 \u0433\u0435\u043d\u0435\u0440\u0430\u0446\u0438\u044e \u043d\u0430 \u044d\u0442\u0430\u043f\u0435 \u00ab\u0420\u0435\u0432\u044c\u044e\u00bb.'}
            </div>
          ) : (
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
              {shotsWithImages.map((shot) => {
                const bestImg = getBestImage(shot)!
                const imageUrl = api.shots.generatedImageUrl(project.id, shot.id, bestImg)
                const verdict = shotVerdicts[shot.id]

                return (
                  <div key={shot.id} className="relative group">
                    <img
                      src={imageUrl}
                      alt={shot.scene}
                      className="w-full aspect-video object-cover rounded-[5px] border-2 border-border cursor-pointer hover:border-amber transition-colors"
                      onClick={() => {
                        const allUrls = shotsWithImages
                          .map((s) => {
                            const img = getBestImage(s)
                            return img ? api.shots.generatedImageUrl(project.id, s.id, img) : null
                          })
                          .filter(Boolean) as string[]
                        const idx = shotsWithImages.indexOf(shot)
                        useLightboxStore.getState().show(allUrls, idx)
                      }}
                    />
                    {/* Shot number badge */}
                    <span className="absolute top-2 left-2 bg-bg/80 border border-border rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] font-bold text-text-primary">
                      #{String(shot.order + 1).padStart(2, '0')}
                    </span>
                    {/* Verdict overlay */}
                    {verdict && (
                      <span className={`absolute top-2 right-2 flex items-center justify-center w-6 h-6 rounded-full border-2 ${
                        verdict === 'approve' ? 'bg-emerald-dim border-emerald text-emerald' :
                        verdict === 'revise' ? 'bg-amber-dim border-amber text-amber' :
                        'bg-rose-dim border-rose text-rose'
                      }`}>
                        {verdict === 'approve' && <CheckCircle2 size={12} />}
                        {verdict === 'revise' && <AlertTriangle size={12} />}
                        {verdict === 'reject' && <XCircle size={12} />}
                      </span>
                    )}
                    {latestImagesReview && (verdict === 'revise' || verdict === 'reject') && (
                      <button
                        onClick={() => directorApplyFeedback(latestImagesReview.id, 'regenerate-image', shot.id)}
                        disabled={directorLoading}
                        className="mt-1.5 w-full flex items-center justify-center gap-1.5 px-2 py-1 rounded-[5px] bg-amber text-black text-[11px] font-bold brutal-btn disabled:opacity-50"
                      >
                        {directorLoading ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                        {'\u041f\u0435\u0440\u0435\u0433\u0435\u043d\u0435\u0440\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u043f\u043e \u043f\u0440\u0430\u0432\u043a\u0435'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Right: Review */}
        <div className="flex-[2] overflow-y-auto p-4 flex flex-col gap-3">
          {latestImagesReview && (
            <StaleWarning review={latestImagesReview} projectUpdated={project.updated} />
          )}

          {latestImagesReview ? (
            <>
              <div className="flex items-center gap-3">
                <DirectorVerdictBadge verdict={latestImagesReview.overallVerdict} />
                <span className="text-[10px] text-text-muted font-mono">
                  {new Date(latestImagesReview.createdAt).toLocaleString('ru')}
                </span>
              </div>
              <p className="text-sm text-text-secondary leading-relaxed">
                {safeReviewText(latestImagesReview.summary, '\u0422\u0435\u043a\u0441\u0442 \u0438\u0442\u043e\u0433\u0430 \u043f\u043e\u0432\u0440\u0435\u0436\u0434\u0435\u043d \u043a\u043e\u0434\u0438\u0440\u043e\u0432\u043a\u043e\u0439. \u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u0435 \u0440\u0435\u0432\u044c\u044e \u0437\u0430\u043d\u043e\u0432\u043e.')}
              </p>
              <div className="space-y-2">
                {openImageNotes.map((note) => (
                  <DirectorNoteCard key={note.id} note={note} />
                ))}
                {openImageNotes.length === 0 && (
                  <p className="text-xs text-text-muted">
                    {'\u0412\u0441\u0435 \u0437\u0430\u043c\u0435\u0447\u0430\u043d\u0438\u044f \u043f\u043e \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f\u043c \u043e\u0431\u0440\u0430\u0431\u043e\u0442\u0430\u043d\u044b. \u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u0435 \u043f\u043e\u0432\u0442\u043e\u0440\u043d\u043e\u0435 \u0440\u0435\u0432\u044c\u044e \u0434\u043b\u044f \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438 \u043d\u043e\u0432\u044b\u0445 \u043a\u0430\u0434\u0440\u043e\u0432.'}
                  </p>
                )}
              </div>

              {/* Batch actions */}
              <div className="flex flex-wrap gap-2 mt-2">
                {(() => {
                  const approveIds = Object.entries(shotVerdicts)
                    .filter(([, v]) => v === 'approve')
                    .map(([id]) => id)
                  const rejectIds = Object.entries(shotVerdicts)
                    .filter(([, v]) => v === 'reject')
                    .map(([id]) => id)
                  const fixableIds = Object.entries(shotVerdicts)
                    .filter(([, v]) => v === 'revise' || v === 'reject')
                    .map(([id]) => id)

                  return (
                    <>
                      {approveIds.length > 0 && (
                        <button
                          onClick={() => batchUpdateShotStatus(project.id, approveIds, 'approved')}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] bg-emerald text-black text-xs font-bold brutal-btn"
                        >
                          <CheckCircle2 size={12} />
                          {'\u041e\u0442\u043c\u0435\u0442\u0438\u0442\u044c \u043a\u0430\u043a \u043e\u0434\u043e\u0431\u0440\u0435\u043d\u043d\u044b\u0435'} ({approveIds.length})
                        </button>
                      )}
                      {fixableIds.length > 0 && (
                        <button
                          onClick={() => directorApplyFeedback(latestImagesReview.id, 'regenerate-images', undefined, fixableIds)}
                          disabled={directorLoading}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] bg-amber text-black text-xs font-bold brutal-btn disabled:opacity-50"
                        >
                          {directorLoading ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                          {'\u041f\u0435\u0440\u0435\u0433\u0435\u043d\u0435\u0440\u0438\u0440\u043e\u0432\u0430\u0442\u044c'} ({fixableIds.length})
                        </button>
                      )}
                      {rejectIds.length > 0 && (
                        <button
                          onClick={() => {
                            for (const id of rejectIds) {
                              directorApplyFeedback(latestImagesReview.id, 'reject-image', id)
                            }
                          }}
                          disabled={directorLoading}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] bg-rose-dim text-rose border-2 border-rose text-xs font-bold disabled:opacity-50"
                        >
                          <XCircle size={12} />
                          {'\u041e\u0442\u043c\u0435\u0442\u0438\u0442\u044c \u043a\u0430\u043a \u043e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u043d\u044b\u0435'} ({rejectIds.length})
                        </button>
                      )}
                    </>
                  )
                })()}
                <button
                  onClick={() => copyNotes(latestImagesReview)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] border-2 border-border text-xs text-text-secondary hover:text-text-primary"
                >
                  <Copy size={12} />
                  {'\u0421\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c'}
                </button>
              </div>
            </>
          ) : (
            <EmptyReviewState stage={'\u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0439'} />
          )}
        </div>
      </div>
    )
  }

  // Review action buttons

  const handleRunReview = () => {
    if (activeTab === 'script') directorReviewScript()
    else if (activeTab === 'shots') directorReviewShots()
    else directorReviewImages()
  }

  const stageLabels: Record<TabId, string> = {
    script: '\u0440\u0435\u0432\u044c\u044e \u0441\u0446\u0435\u043d\u0430\u0440\u0438\u044f',
    shots: '\u0440\u0435\u0432\u044c\u044e \u0448\u043e\u0442\u043e\u0432',
    images: '\u0440\u0435\u0432\u044c\u044e \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0439',
  }

  // Render

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <DirectorTabBar active={activeTab} onChange={setActiveTab} />

      {activeTab === 'script' && renderScriptTab()}
      {activeTab === 'shots' && renderShotsTab()}
      {activeTab === 'images' && renderImagesTab()}

      {/* Bottom action bar */}
      <div className="shrink-0 border-t-2 border-border bg-surface-1 px-6 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-text-muted text-xs">
          {directorLoading && directorReviewStage === 'all' && (
            <>
              <Loader2 size={12} className="animate-spin text-amber" />
              <span>{'\u0412\u044b\u043f\u043e\u043b\u043d\u044f\u0435\u0442\u0441\u044f \u043f\u043e\u043b\u043d\u043e\u0435 \u0440\u0435\u0432\u044c\u044e...'}</span>
            </>
          )}
          {currentReview && !directorLoading && (
            <>
              <Clock size={12} />
              <span>{'\u041c\u043e\u0434\u0435\u043b\u044c:'} {currentReview.model}</span>
            </>
          )}
        </div>
        <button
          onClick={handleRunReview}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-1.5 rounded-[5px] bg-amber text-black text-sm font-bold uppercase brutal-btn disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Crown size={14} />
          )}
          {isLoading ? '\u0410\u043d\u0430\u043b\u0438\u0437...' : `\u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c ${stageLabels[activeTab]}`}
        </button>
      </div>
    </div>
  )
}

// Empty state helper

function EmptyReviewState({ stage }: { stage: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center py-8">
      <div className="w-12 h-12 rounded-[5px] bg-surface-2 border-2 border-border flex items-center justify-center">
        <Crown size={20} className="text-text-muted" />
      </div>
      <p className="text-sm text-text-muted max-w-[200px]">
        {`\u041d\u0435\u0442 \u0440\u0435\u0432\u044c\u044e \u0434\u043b\u044f \u044d\u0442\u0430\u043f\u0430 ${stage}`}
      </p>
    </div>
  )
}
