import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export function resolveDevProxyTarget(env: Record<string, string | undefined>): string {
  const parsedPort = Number.parseInt(env.PORT ?? '', 10)
  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3001
  return `http://localhost:${port}`
}

export function resolveDevProxyTargetFromMode(mode: string): string {
  const env = loadEnv(mode, process.cwd(), '')
  return resolveDevProxyTarget(env)
}

export default defineConfig(({ mode }) => {
  const proxyTarget = resolveDevProxyTargetFromMode(mode)

  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api': proxyTarget,
        '/openreel': proxyTarget,
      },
    },
  }
})
