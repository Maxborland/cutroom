import { useState, type FormEvent } from 'react'
import { Loader2, LockKeyhole, LogIn } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'

export function LoginView() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const login = useAuthStore((state) => state.login)
  const loading = useAuthStore((state) => state.loading)
  const error = useAuthStore((state) => state.error)
  const clearError = useAuthStore((state) => state.clearError)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await login(email, password)
  }

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-bg px-6 py-10">
      <div className="w-full max-w-md rounded-[5px] border-2 border-border bg-panel p-6 shadow-brutal">
        <div className="mb-6 flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-[5px] border-2 border-border bg-amber text-black">
            <LockKeyhole size={28} />
          </div>
          <div>
            <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">CutRoom</h1>
            <p className="text-sm text-text-muted">Войдите, чтобы продолжить работу с проектами.</p>
          </div>
        </div>

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
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => {
                clearError()
                setEmail(event.target.value)
              }}
              placeholder="owner@example.com"
              className="mt-2 w-full brutal-input px-4 py-2.5 text-base normal-case"
              autoComplete="email"
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
              placeholder="Введите пароль"
              className="mt-2 w-full brutal-input px-4 py-2.5 text-base normal-case"
              autoComplete="current-password"
            />
          </label>

          <button
            type="submit"
            disabled={loading || !email.trim() || !password}
            className="flex w-full items-center justify-center gap-2 rounded-[5px] bg-amber px-5 py-3 text-sm font-bold uppercase text-black brutal-btn disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
            Войти
          </button>
        </form>
      </div>
    </div>
  )
}

export default LoginView
