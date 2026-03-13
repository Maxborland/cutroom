import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CheckCheck, Loader2, UserPlus } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'

export function AcceptInviteView() {
  const navigate = useNavigate()
  const params = useParams<{ token?: string }>()
  const [searchParams] = useSearchParams()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const acceptInvite = useAuthStore((state) => state.acceptInvite)
  const loading = useAuthStore((state) => state.loading)
  const error = useAuthStore((state) => state.error)
  const clearError = useAuthStore((state) => state.clearError)

  const token = useMemo(
    () => params.token ?? searchParams.get('token') ?? '',
    [params.token, searchParams],
  )

  const passwordMismatch = passwordConfirm.length > 0 && password !== passwordConfirm

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token || passwordMismatch) return

    const accepted = await acceptInvite(token, name, password)
    if (accepted) {
      navigate('/', { replace: true })
    }
  }

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-bg px-6 py-10">
      <div className="w-full max-w-lg rounded-[5px] border-2 border-border bg-panel p-6 shadow-brutal">
        <div className="mb-6 flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-[5px] border-2 border-border bg-amber text-black">
            <UserPlus size={28} />
          </div>
          <div>
            <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Принять приглашение</h1>
            <p className="text-sm text-text-muted">Создайте пароль, чтобы активировать доступ в CutRoom.</p>
          </div>
        </div>

        {!token && (
          <div className="mb-4 rounded-[5px] border-2 border-border bg-rose-dim px-4 py-3 text-sm text-rose">
            Токен приглашения не найден. Откройте ссылку из приглашения заново.
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-[5px] border-2 border-border bg-rose-dim px-4 py-3 text-sm text-rose">
            {error}
            <button onClick={clearError} className="ml-2 text-xs underline">
              Закрыть
            </button>
          </div>
        )}

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm font-bold uppercase">
            Имя
            <input
              type="text"
              value={name}
              onChange={(event) => {
                clearError()
                setName(event.target.value)
              }}
              placeholder="Как к вам обращаться"
              className="mt-2 w-full brutal-input px-4 py-2.5 text-base normal-case"
              autoComplete="name"
            />
          </label>

          <label className="block text-sm font-bold uppercase">
            Пароль
            <input
              type="password"
              value={password}
              onChange={(event) => {
                clearError()
                setPassword(event.target.value)
              }}
              placeholder="Минимум 8 символов"
              className="mt-2 w-full brutal-input px-4 py-2.5 text-base normal-case"
              autoComplete="new-password"
            />
          </label>

          <label className="block text-sm font-bold uppercase">
            Повторите пароль
            <input
              type="password"
              value={passwordConfirm}
              onChange={(event) => {
                clearError()
                setPasswordConfirm(event.target.value)
              }}
              placeholder="Повторите пароль"
              className="mt-2 w-full brutal-input px-4 py-2.5 text-base normal-case"
              autoComplete="new-password"
            />
          </label>

          {passwordMismatch && (
            <div className="rounded-[5px] border-2 border-border bg-rose-dim px-4 py-3 text-sm text-rose">
              Пароли не совпадают.
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !token || !name.trim() || !password || passwordMismatch}
            className="flex w-full items-center justify-center gap-2 rounded-[5px] bg-amber px-5 py-3 text-sm font-bold uppercase text-black brutal-btn disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <CheckCheck size={16} />}
            Активировать доступ
          </button>
        </form>
      </div>
    </div>
  )
}

export default AcceptInviteView
