import { useProjectStore } from '../stores/projectStore'
import { ImageIcon } from 'lucide-react'

export function ScriptView() {
  const project = useProjectStore((s) => s.activeProject())
  if (!project) return null

  // Parse script to highlight asset references
  const renderScript = (text: string) => {
    const parts = text.split(/(Используем:\s*\S+)/g)
    return parts.map((part, i) => {
      const match = part.match(/Используем:\s*(\S+)/)
      if (match) {
        const filename = match[1]
        return (
          <span
            key={i}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[3px] bg-amber-dim text-amber font-mono text-xs mx-0.5 border border-border"
          >
            <ImageIcon size={10} />
            {filename}
          </span>
        )
      }
      return <span key={i}>{part}</span>
    })
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto">
        <div className="bg-surface-2 border-2 border-border rounded-[5px] p-6 shadow-brutal-sm">
          <div className="prose prose-invert prose-sm max-w-none">
            {project.script.split('\n\n').map((paragraph, i) => (
              <p key={i} className="text-sm text-text-secondary leading-relaxed mb-4 last:mb-0">
                <span className="font-mono text-[10px] text-text-muted mr-2 select-none">
                  {String(i + 1).padStart(2, '0')}
                </span>
                {renderScript(paragraph)}
              </p>
            ))}
          </div>
        </div>

        {/* Assets referenced */}
        <div className="mt-6 p-4 bg-surface-2 border-2 border-border rounded-[5px]">
          <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted mb-3">
            Файлы, упомянутые в сценарии
          </p>
          <div className="flex flex-wrap gap-2">
            {project.brief.assets
              .filter((a) => project.script.includes(a.filename))
              .map((asset) => (
                <div
                  key={asset.id}
                  className="flex items-center gap-2 bg-surface-2 border-2 border-border rounded-[5px] px-3 py-2"
                >
                  <div className="w-8 h-8 rounded-[3px] bg-surface-3 border border-border flex items-center justify-center">
                    <ImageIcon size={12} className="text-text-muted" />
                  </div>
                  <div>
                    <p className="font-mono text-[10px] text-amber">{asset.filename}</p>
                    {asset.label && <p className="text-[10px] text-text-muted">{asset.label}</p>}
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}
