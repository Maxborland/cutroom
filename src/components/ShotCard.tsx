import type { Shot, BriefAsset } from '../types'
import {
  Clock,
  ImageIcon,
  Film,
  FileImage,
  Sparkles,
  CheckCircle2,
  Loader2,
  Eye,
} from 'lucide-react'

interface ShotCardProps {
  shot: Shot
  isActive: boolean
  briefAssets: BriefAsset[]
  onClick: () => void
}

const STATUS_STYLES: Record<string, { border: string; badge: string; icon: React.ReactNode }> = {
  draft: {
    border: 'border-border hover:border-border-hover',
    badge: 'bg-surface-3 text-text-muted',
    icon: <FileImage size={12} />,
  },
  img_gen: {
    border: 'border-violet/20 hover:border-violet/40',
    badge: 'bg-violet-dim text-violet',
    icon: <Loader2 size={12} className="animate-spin" />,
  },
  img_review: {
    border: 'border-sky/20 hover:border-sky/40',
    badge: 'bg-sky-dim text-sky',
    icon: <Eye size={12} />,
  },
  vid_gen: {
    border: 'border-violet/20 hover:border-violet/40',
    badge: 'bg-violet-dim text-violet',
    icon: <Loader2 size={12} className="animate-spin" />,
  },
  vid_review: {
    border: 'border-amber/20 hover:border-amber/40',
    badge: 'bg-amber-dim text-amber',
    icon: <Eye size={12} />,
  },
  approved: {
    border: 'border-emerald/20 hover:border-emerald/40',
    badge: 'bg-emerald-dim text-emerald',
    icon: <CheckCircle2 size={12} />,
  },
}

export function ShotCard({ shot, isActive, briefAssets, onClick }: ShotCardProps) {
  const style = STATUS_STYLES[shot.status] || STATUS_STYLES.draft
  const linkedAssets = briefAssets.filter((a) => shot.assetRefs.includes(a.filename))

  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left bg-surface-2 border rounded-xl p-3.5 transition-all group cursor-pointer
        ${style.border}
        ${isActive ? 'ring-1 ring-amber/30 border-amber/20 glow-amber-sm' : ''}
      `}
    >
      {/* Shot number + duration */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] font-semibold text-amber bg-amber-dim px-1.5 py-0.5 rounded">
            #{String(shot.order).padStart(2, '0')}
          </span>
          <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono ${style.badge}`}>
            {style.icon}
          </div>
        </div>
        <div className="flex items-center gap-1 text-text-muted">
          <Clock size={10} />
          <span className="font-mono text-[10px]">{shot.duration}s</span>
        </div>
      </div>

      {/* Scene description */}
      <p className="text-xs text-text-secondary leading-relaxed line-clamp-3 mb-3">{shot.scene}</p>

      {/* Asset refs */}
      {linkedAssets.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {linkedAssets.map((asset) => (
            <span
              key={asset.id}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-dim text-amber font-mono text-[9px] max-w-full truncate"
            >
              <ImageIcon size={9} className="shrink-0" />
              {asset.filename}
            </span>
          ))}
        </div>
      )}

      {/* Bottom indicators */}
      <div className="flex items-center gap-3 pt-2 border-t border-border">
        {shot.generatedImages.length > 0 && (
          <div className="flex items-center gap-1 text-text-muted">
            <Sparkles size={10} />
            <span className="font-mono text-[10px]">{shot.generatedImages.length} img</span>
          </div>
        )}
        {shot.videoFile && (
          <div className="flex items-center gap-1 text-emerald">
            <Film size={10} />
            <span className="font-mono text-[10px]">video</span>
          </div>
        )}
        {!shot.generatedImages.length && !shot.videoFile && (
          <span className="font-mono text-[10px] text-text-muted">нет медиа</span>
        )}
      </div>
    </button>
  )
}
