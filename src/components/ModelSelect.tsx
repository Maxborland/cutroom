import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Search, Loader2 } from 'lucide-react'

interface Model {
  id: string
  name: string
}

interface ModelSelectProps {
  label: string
  value: string
  onChange: (value: string) => void
  models: Model[]
  loading: boolean
  placeholder?: string
}

export function ModelSelect({ label, value, onChange, models, loading, placeholder }: ModelSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus()
    }
  }, [open])

  const filtered = models.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.id.toLowerCase().includes(search.toLowerCase())
  )

  const selectedModel = models.find((m) => m.id === value)
  const displayValue = selectedModel ? selectedModel.name : value

  if (!loading && models.length === 0) {
    return (
      <div>
        <label className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
          {label}
        </label>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-surface-2 border border-border rounded-lg px-4 py-2.5 text-sm font-mono text-text-primary focus:outline-none focus:border-amber/30 transition-all"
        />
        <p className="text-[10px] text-text-muted mt-1">
          Введите API ключ в настройках, чтобы загрузить список моделей
        </p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <label className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
        {label}
      </label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full bg-surface-2 border border-border rounded-lg px-4 py-2.5 text-sm font-mono text-text-primary text-left flex items-center justify-between hover:border-amber/30 focus:outline-none focus:border-amber/30 transition-all"
      >
        <span className="truncate">
          {loading ? (
            <span className="flex items-center gap-2 text-text-muted">
              <Loader2 size={14} className="animate-spin" />
              Загрузка моделей...
            </span>
          ) : (
            displayValue || placeholder
          )}
        </span>
        <ChevronDown
          size={14}
          className={`text-text-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && !loading && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface-2 border border-border rounded-lg shadow-xl max-h-72 overflow-hidden flex flex-col">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск модели..."
                className="w-full bg-bg border border-border rounded-md pl-7 pr-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-amber/30"
              />
            </div>
          </div>

          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-xs text-text-muted text-center">
                Ничего не найдено
              </div>
            ) : (
              filtered.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => {
                    onChange(model.id)
                    setOpen(false)
                    setSearch('')
                  }}
                  className={`w-full text-left px-3 py-2 hover:bg-surface-3 transition-colors ${
                    model.id === value ? 'bg-amber/10 border-l-2 border-amber' : ''
                  }`}
                >
                  <div className="text-sm text-text-primary truncate">{model.name}</div>
                  <div className="text-[10px] font-mono text-text-muted truncate">{model.id}</div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
