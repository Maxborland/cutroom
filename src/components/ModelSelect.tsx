import { useState, useRef, useEffect, useId } from 'react'
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
  const fieldId = useId()
  const labelId = `${fieldId}-label`
  const comboboxId = `${fieldId}-combobox`
  const listboxId = `${fieldId}-listbox`

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
      m.id.toLowerCase().includes(search.toLowerCase()),
  )

  const selectedModel = models.find((m) => m.id === value)
  const displayValue = selectedModel ? selectedModel.name : value

  if (!loading && models.length === 0) {
    return (
      <div>
        <label
          id={labelId}
          htmlFor={comboboxId}
          className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5"
        >
          {label}
        </label>
        <input
          id={comboboxId}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-labelledby={labelId}
          className="w-full brutal-input px-4 py-2.5 text-sm font-mono"
        />
        <p className="text-[10px] text-text-muted mt-1">
          Список моделей не загружен. Можно ввести id модели вручную.
        </p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <label id={labelId} className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
        {label}
      </label>
      <button
        id={comboboxId}
        type="button"
        role="combobox"
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
          if (e.key === 'Escape' && open) {
            e.preventDefault()
            setOpen(false)
            setSearch('')
          }
        }}
        className="w-full brutal-input px-4 py-2.5 text-sm font-mono text-left flex items-center justify-between hover:border-amber"
      >
        <span className="truncate">
          {loading ? (
            <span className="flex items-center gap-2 text-text-muted">
              <Loader2 size={14} className="animate-spin" />
              Загружаем модели...
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
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface-2 border-2 border-border rounded-[5px] shadow-brutal max-h-72 overflow-hidden flex flex-col">
          <div className="p-2 border-b-2 border-border">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Поиск модели"
                placeholder="Поиск модели..."
                className="w-full brutal-input pl-7 pr-3 py-1.5 text-xs"
              />
            </div>
          </div>

          <div id={listboxId} role="listbox" aria-labelledby={labelId} className="overflow-y-auto flex-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-xs text-text-muted text-center">
                Ничего не найдено
              </div>
            ) : (
              filtered.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  role="option"
                  aria-selected={model.id === value}
                  onClick={() => {
                    onChange(model.id)
                    setOpen(false)
                    setSearch('')
                  }}
                  className={`w-full text-left px-3 py-2 hover:bg-surface-3 transition-colors ${
                    model.id === value ? 'bg-amber-dim border-l-2 border-amber font-bold' : ''
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
