import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { Key, Brain, Wand2, Save, Loader2, CheckCircle2 } from 'lucide-react'

export function SettingsView() {
  const [apiKey, setApiKey] = useState('')
  const [textModel, setTextModel] = useState('openai/gpt-4o')
  const [imageModel, setImageModel] = useState('openai/gpt-image-1')
  const [scriptPrompt, setScriptPrompt] = useState(
    'Ты опытный сценарист рекламных роликов. Пиши кинематографично, описывай движения камеры. При наличии изображений — ссылайся на них по имени файла.'
  )
  const [splitterPrompt, setSplitterPrompt] = useState(
    'Раздели сценарий на отдельные шоты. Каждый шот = один непрерывный кадр. Укажи файлы изображений через "Используем: filename".'
  )
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    api.settings
      .get()
      .then((settings) => {
        if (settings.openRouterApiKey) setApiKey(settings.openRouterApiKey)
        if (settings.defaultTextModel) setTextModel(settings.defaultTextModel)
        if (settings.defaultImageModel) setImageModel(settings.defaultImageModel)
        if (settings.masterPromptScriptwriter) setScriptPrompt(settings.masterPromptScriptwriter)
        if (settings.masterPromptShotSplitter) setSplitterPrompt(settings.masterPromptShotSplitter)
      })
      .catch((e) => {
        setError(e.message)
      })
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await api.settings.update({
        openRouterApiKey: apiKey,
        defaultTextModel: textModel,
        defaultImageModel: imageModel,
        masterPromptScriptwriter: scriptPrompt,
        masterPromptShotSplitter: splitterPrompt,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={24} className="text-amber animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-8">
        {/* Error */}
        {error && (
          <div className="bg-rose-dim border border-rose/20 rounded-lg px-4 py-2 text-sm text-rose">
            {error}
          </div>
        )}

        {/* API Key */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Key size={14} className="text-amber" />
            <h2 className="font-display font-semibold text-base">OpenRouter API</h2>
          </div>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-or-..."
            className="w-full bg-surface-2 border border-border rounded-lg px-4 py-2.5 text-sm font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-amber/30 focus:ring-1 focus:ring-amber/20 transition-all"
          />
        </section>

        {/* Models */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Brain size={14} className="text-amber" />
            <h2 className="font-display font-semibold text-base">Модели</h2>
          </div>
          <div className="space-y-4">
            <div>
              <label className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
                Текстовая модель (сценарий, описания)
              </label>
              <input
                type="text"
                value={textModel}
                onChange={(e) => setTextModel(e.target.value)}
                className="w-full bg-surface-2 border border-border rounded-lg px-4 py-2.5 text-sm font-mono text-text-primary focus:outline-none focus:border-amber/30 transition-all"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
                Модель генерации изображений
              </label>
              <input
                type="text"
                value={imageModel}
                onChange={(e) => setImageModel(e.target.value)}
                className="w-full bg-surface-2 border border-border rounded-lg px-4 py-2.5 text-sm font-mono text-text-primary focus:outline-none focus:border-amber/30 transition-all"
              />
            </div>
          </div>
        </section>

        {/* Master prompts */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Wand2 size={14} className="text-amber" />
            <h2 className="font-display font-semibold text-base">Мастер-промпты</h2>
          </div>
          <div className="space-y-4">
            <div>
              <label className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
                Промпт сценариста
              </label>
              <textarea
                value={scriptPrompt}
                onChange={(e) => setScriptPrompt(e.target.value)}
                rows={4}
                className="w-full bg-surface-2 border border-border rounded-lg px-4 py-3 text-sm text-text-primary resize-none focus:outline-none focus:border-amber/30 transition-all leading-relaxed"
              />
              <p className="text-[10px] text-text-muted mt-1">
                Используется при генерации сценария из брифа. Модель получает этот промпт + текст
                брифа + список файлов.
              </p>
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
                Промпт разбивки на шоты
              </label>
              <textarea
                value={splitterPrompt}
                onChange={(e) => setSplitterPrompt(e.target.value)}
                rows={4}
                className="w-full bg-surface-2 border border-border rounded-lg px-4 py-3 text-sm text-text-primary resize-none focus:outline-none focus:border-amber/30 transition-all leading-relaxed"
              />
              <p className="text-[10px] text-text-muted mt-1">
                Используется при разбивке сценария на отдельные шоты. Модель привязывает файлы к
                шотам по имени.
              </p>
            </div>
          </div>
        </section>

        {/* Save */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-amber text-bg text-sm font-semibold hover:bg-amber-light transition-colors glow-amber-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            {saving ? 'Сохранение...' : 'Сохранить настройки'}
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-emerald text-sm">
              <CheckCircle2 size={14} />
              Сохранено
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
