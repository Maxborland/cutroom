import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../../server/app.js'
import { createInMemoryAuthRepository } from '../../server/lib/auth/repository.js'

function createAuthApp() {
  const authRepository = createInMemoryAuthRepository()
  const app = createApp({
    allowMissingApiKey: true,
    apiAccessKey: '',
    authRepository,
  })

  return { app, authRepository }
}

describe('Authentication API', () => {
  it('requires authentication for project APIs', async () => {
    const { app } = createAuthApp()

    await request(app).get('/api/projects').expect(401)
  })

  it('accepts invite and creates first session', async () => {
    const { app, authRepository } = createAuthApp()
    const invite = await authRepository.createInvite({
      email: 'owner@example.com',
      invitedByUserId: null,
    })

    const acceptResponse = await request(app)
      .post('/api/auth/accept-invite')
      .send({
        token: invite.token,
        name: 'Owner',
        password: 'super-secret-pass',
      })
      .expect(200)

    expect(acceptResponse.body.user).toMatchObject({
      email: 'owner@example.com',
      name: 'Owner',
    })
    expect(acceptResponse.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('cutroom_session=')]),
    )

    const sessionCookie = acceptResponse.headers['set-cookie']
      ?.find((value: string) => value.startsWith('cutroom_session='))

    expect(sessionCookie).toBeTruthy()
    if (!sessionCookie) return

    const meResponse = await request(app)
      .get('/api/auth/me')
      .set('Cookie', sessionCookie)
      .expect(200)

    expect(meResponse.body.user).toMatchObject({
      email: 'owner@example.com',
      name: 'Owner',
    })

    await request(app)
      .get('/api/projects')
      .set('Cookie', sessionCookie)
      .expect(200)
  })
})
