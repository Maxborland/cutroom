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

  it('bootstraps the first invite on an empty system without authentication', async () => {
    const { app } = createAuthApp()

    const inviteResponse = await request(app)
      .post('/api/users/invite')
      .send({ email: 'owner@example.com' })
      .expect(201)

    expect(inviteResponse.body.invite).toMatchObject({
      email: 'owner@example.com',
    })
    expect(typeof inviteResponse.body.invite.token).toBe('string')
    expect(inviteResponse.body.invite.inviteUrl).toContain(inviteResponse.body.invite.token)
  })

  it('accepts invite and creates first session', async () => {
    const { app } = createAuthApp()
    const inviteResponse = await request(app)
      .post('/api/users/invite')
      .send({ email: 'owner@example.com' })
      .expect(201)

    const inviteToken = inviteResponse.body.invite.token

    const acceptResponse = await request(app)
      .post('/api/auth/accept-invite')
      .send({
        token: inviteToken,
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

  it('requires authentication to create additional invites after the first user exists', async () => {
    const { app } = createAuthApp()

    const bootstrapInvite = await request(app)
      .post('/api/users/invite')
      .send({ email: 'owner@example.com' })
      .expect(201)

    const bootstrapSession = await request(app)
      .post('/api/auth/accept-invite')
      .send({
        token: bootstrapInvite.body.invite.token,
        name: 'Owner',
        password: 'super-secret-pass',
      })
      .expect(200)

    await request(app)
      .post('/api/users/invite')
      .send({ email: 'editor@example.com' })
      .expect(401)

    const sessionCookie = bootstrapSession.headers['set-cookie']
      ?.find((value: string) => value.startsWith('cutroom_session='))

    expect(sessionCookie).toBeTruthy()
    if (!sessionCookie) return

    const secondInvite = await request(app)
      .post('/api/users/invite')
      .set('Cookie', sessionCookie)
      .send({ email: 'editor@example.com' })
      .expect(201)

    expect(secondInvite.body.invite).toMatchObject({
      email: 'editor@example.com',
    })
  })
})
