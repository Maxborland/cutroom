import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, MailPlus } from 'lucide-react'
import { ApiRequestError, api, getApiErrorMessage } from '../../lib/api'

export function BootstrapAccessView() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [bootstrapToken, setBootstrapToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) return

    setLoading(true)
    setError(null)

    try {
      const response = await api.users.invite(normalizedEmail, bootstrapToken)
      navigate(`/accept-invite/${response.invite.token}`, { replace: true })
    } catch (submitError) {
      if (submitError instanceof ApiRequestError && submitError.status === 401) {
        setError('Первичная настройка уже завершена. Войдите под существующим аккаунтом или используйте ссылку-приглашение.')
        return
      }

      setError(getApiErrorMessage(submitError, 'Не удалось создать первое приглашение'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-bg px-6 py-10">
      <div className="w-full max-w-lg rounded-[5px] border-2 border-border bg-panel p-6 shadow-brutal">
        <div className="mb-6 flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-[5px] border-2 border-border bg-amber text-black">
            <MailPlus size={28} />
          </div>
          <div>
            <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Первичная настройка</h1>
            <p className="text-sm text-text-muted">
              Укажите email владельца, чтобы создать первое приглашение и завершить запуск CutRoom.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-[5px] border-2 border-border bg-rose-dim px-4 py-3 text-sm text-rose">
            {error}
          </div>
        )}

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm font-bold uppercase" htmlFor="bootstrap-email">
            Email владельца
            <input
              id="bootstrap-email"
              type="email"
              value={email}
              onChange={(event) => {
                setError(null)
                setEmail(event.target.value)
              }}
              placeholder="owner@example.com"
              className="mt-2 w-full brutal-input px-4 py-2.5 text-base normal-case"
              autoComplete="email"
            />
          </label>

          <label className="block text-sm font-bold uppercase" htmlFor="bootstrap-token">
            Код первичной настройки
            <input
              id="bootstrap-token"
              type="password"
              value={bootstrapToken}
              onChange={(event) => {
                setError(null)
                setBootstrapToken(event.target.value)
              }}
              placeholder="Если настроен при установке"
              className="mt-2 w-full brutal-input px-4 py-2.5 text-base normal-case"
              autoComplete="one-time-code"
            />
          </label>

          <button
            type="submit"
            disabled={loading || !email.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-[5px] bg-amber px-5 py-3 text-sm font-bold uppercase text-black brutal-btn disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <MailPlus size={16} />}
            Создать доступ
          </button>
        </form>

        <div className="mt-4 text-sm text-text-muted">
          Настройка уже завершена?{' '}
          <Link to="/" className="font-bold text-text underline">
            Вернуться ко входу
          </Link>
        </div>
      </div>
    </div>
  )
}

export default BootstrapAccessView
