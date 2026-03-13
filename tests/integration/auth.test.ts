import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../../server/app.js'
import { createInMemoryAuthRepository } from '../../server/lib/auth/repository.js'

function createAuthApp(options: {
  bootstrapSetupToken?: string
  userInviteRateLimitMax?: number
  userInviteRateLimitWindowMs?: number
} = {}) {
  const authRepository = createInMemoryAuthRepository()
  const app = createApp({
    allowMissingApiKey: true,
    apiAccessKey: '',
    authRepository,
    bootstrapSetupToken: options.bootstrapSetupToken,
    userInviteRateLimitMax: options.userInviteRateLimitMax,
    userInviteRateLimitWindowMs: options.userInviteRateLimitWindowMs,
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
      .post('/api/users/bootstrap-owner-invite')
      .send({ email: 'owner@example.com' })
      .expect(201)

    expect(inviteResponse.body.invite).toMatchObject({
      email: 'owner@example.com',
    })
    expect(typeof inviteResponse.body.invite.token).toBe('string')
    expect(inviteResponse.body.invite.inviteUrl).toContain(inviteResponse.body.invite.token)
  })

  it('requires a bootstrap setup token when the instance is configured with one', async () => {
    const { app } = createAuthApp({ bootstrapSetupToken: 'setup-secret' })

    await request(app)
      .post('/api/users/bootstrap-owner-invite')
      .send({ email: 'owner@example.com' })
      .expect(403)

    const inviteResponse = await request(app)
      .post('/api/users/bootstrap-owner-invite')
      .send({ email: 'owner@example.com', bootstrapToken: 'setup-secret' })
      .expect(201)

    expect(inviteResponse.body.invite).toMatchObject({
      email: 'owner@example.com',
    })
  })

  it('accepts invite and creates first session', async () => {
    const { app } = createAuthApp()
    const inviteResponse = await request(app)
      .post('/api/users/bootstrap-owner-invite')
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
      role: 'owner',
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
      role: 'owner',
    })

    await request(app)
      .get('/api/projects')
      .set('Cookie', sessionCookie)
      .expect(200)
  })

  it('requires authentication to create additional invites after the first user exists', async () => {
    const { app } = createAuthApp()

    const bootstrapInvite = await request(app)
      .post('/api/users/bootstrap-owner-invite')
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
      .send({ email: 'editor@example.com', role: 'editor' })
      .expect(201)

    expect(secondInvite.body.invite).toMatchObject({
      email: 'editor@example.com',
      role: 'editor',
    })
  })

  it('rejects stale bootstrap invites after the first user is created', async () => {
    const { app } = createAuthApp()

    const firstBootstrapInvite = await request(app)
      .post('/api/users/bootstrap-owner-invite')
      .send({ email: 'owner-one@example.com' })
      .expect(201)

    const secondBootstrapInvite = await request(app)
      .post('/api/users/bootstrap-owner-invite')
      .send({ email: 'owner-two@example.com' })
      .expect(201)

    await request(app)
      .post('/api/auth/accept-invite')
      .send({
        token: secondBootstrapInvite.body.invite.token,
        name: 'Owner Two',
        password: 'super-secret-pass',
      })
      .expect(200)

    const staleAcceptResponse = await request(app)
      .post('/api/auth/accept-invite')
      .send({
        token: firstBootstrapInvite.body.invite.token,
        name: 'Owner One',
        password: 'super-secret-pass',
      })
      .expect(404)

    expect(staleAcceptResponse.body).toMatchObject({
      code: 'INVITE_NOT_FOUND',
    })
  })

  it('prevents editors from inviting more users or reading system settings', async () => {
    const { app } = createAuthApp()

    const bootstrapInvite = await request(app)
      .post('/api/users/bootstrap-owner-invite')
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

    const ownerSessionCookie = bootstrapSession.headers['set-cookie']
      ?.find((value: string) => value.startsWith('cutroom_session='))

    expect(ownerSessionCookie).toBeTruthy()
    if (!ownerSessionCookie) return

    const editorInvite = await request(app)
      .post('/api/users/invite')
      .set('Cookie', ownerSessionCookie)
      .send({ email: 'editor@example.com', role: 'editor' })
      .expect(201)

    const editorSession = await request(app)
      .post('/api/auth/accept-invite')
      .send({
        token: editorInvite.body.invite.token,
        name: 'Editor',
        password: 'super-secret-pass',
      })
      .expect(200)

    expect(editorSession.body.user).toMatchObject({
      email: 'editor@example.com',
      role: 'editor',
    })

    const editorSessionCookie = editorSession.headers['set-cookie']
      ?.find((value: string) => value.startsWith('cutroom_session='))

    expect(editorSessionCookie).toBeTruthy()
    if (!editorSessionCookie) return

    await request(app)
      .post('/api/users/invite')
      .set('Cookie', editorSessionCookie)
      .send({ email: 'viewer@example.com', role: 'viewer' })
      .expect(403)

    await request(app)
      .get('/api/settings')
      .set('Cookie', editorSessionCookie)
      .expect(403)

    await request(app)
      .get('/api/users')
      .set('Cookie', editorSessionCookie)
      .expect(403)
  })

  it('does not allow admins to issue owner invites', async () => {
    const { app } = createAuthApp()

    const bootstrapInvite = await request(app)
      .post('/api/users/bootstrap-owner-invite')
      .send({ email: 'owner@example.com' })
      .expect(201)

    const ownerSession = await request(app)
      .post('/api/auth/accept-invite')
      .send({
        token: bootstrapInvite.body.invite.token,
        name: 'Owner',
        password: 'super-secret-pass',
      })
      .expect(200)

    const ownerSessionCookie = ownerSession.headers['set-cookie']
      ?.find((value: string) => value.startsWith('cutroom_session='))

    expect(ownerSessionCookie).toBeTruthy()
    if (!ownerSessionCookie) return

    const adminInvite = await request(app)
      .post('/api/users/invite')
      .set('Cookie', ownerSessionCookie)
      .send({ email: 'admin@example.com', role: 'admin' })
      .expect(201)

    const adminSession = await request(app)
      .post('/api/auth/accept-invite')
      .send({
        token: adminInvite.body.invite.token,
        name: 'Admin',
        password: 'super-secret-pass',
      })
      .expect(200)

    const adminSessionCookie = adminSession.headers['set-cookie']
      ?.find((value: string) => value.startsWith('cutroom_session='))

    expect(adminSessionCookie).toBeTruthy()
    if (!adminSessionCookie) return

    await request(app)
      .post('/api/users/invite')
      .set('Cookie', adminSessionCookie)
      .send({ email: 'new-owner@example.com', role: 'owner' })
      .expect(403)
  })

  it('rate limits bootstrap and team invite creation endpoints', async () => {
    const { app } = createAuthApp({
      userInviteRateLimitMax: 1,
      userInviteRateLimitWindowMs: 60_000,
    })

    const bootstrapInvite = await request(app)
      .post('/api/users/bootstrap-owner-invite')
      .send({ email: 'owner@example.com' })
      .expect(201)

    await request(app)
      .post('/api/users/bootstrap-owner-invite')
      .send({ email: 'owner-two@example.com' })
      .expect(429)

    const ownerSession = await request(app)
      .post('/api/auth/accept-invite')
      .send({
        token: bootstrapInvite.body.invite.token,
        name: 'Owner',
        password: 'super-secret-pass',
      })
      .expect(200)

    const ownerSessionCookie = ownerSession.headers['set-cookie']
      ?.find((value: string) => value.startsWith('cutroom_session='))

    expect(ownerSessionCookie).toBeTruthy()
    if (!ownerSessionCookie) return

    await request(app)
      .post('/api/users/invite')
      .set('Cookie', ownerSessionCookie)
      .send({ email: 'editor@example.com', role: 'editor' })
      .expect(201)

    await request(app)
      .post('/api/users/invite')
      .set('Cookie', ownerSessionCookie)
      .send({ email: 'viewer@example.com', role: 'viewer' })
      .expect(429)
  })

  it('allows owners and admins to list current users', async () => {
    const { app } = createAuthApp()

    const bootstrapInvite = await request(app)
      .post('/api/users/bootstrap-owner-invite')
      .send({ email: 'owner@example.com' })
      .expect(201)

    const ownerSession = await request(app)
      .post('/api/auth/accept-invite')
      .send({
        token: bootstrapInvite.body.invite.token,
        name: 'Owner',
        password: 'super-secret-pass',
      })
      .expect(200)

    const ownerSessionCookie = ownerSession.headers['set-cookie']
      ?.find((value: string) => value.startsWith('cutroom_session='))

    expect(ownerSessionCookie).toBeTruthy()
    if (!ownerSessionCookie) return

    const adminInvite = await request(app)
      .post('/api/users/invite')
      .set('Cookie', ownerSessionCookie)
      .send({ email: 'admin@example.com', role: 'admin' })
      .expect(201)

    await request(app)
      .post('/api/auth/accept-invite')
      .send({
        token: adminInvite.body.invite.token,
        name: 'Admin',
        password: 'super-secret-pass',
      })
      .expect(200)

    const ownerListResponse = await request(app)
      .get('/api/users')
      .set('Cookie', ownerSessionCookie)
      .expect(200)

    expect(ownerListResponse.body.users).toEqual([
      expect.objectContaining({
        email: 'owner@example.com',
        role: 'owner',
        name: 'Owner',
      }),
      expect.objectContaining({
        email: 'admin@example.com',
        role: 'admin',
        name: 'Admin',
      }),
    ])

    const adminSession = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'admin@example.com',
        password: 'super-secret-pass',
      })
      .expect(200)

    const adminSessionCookie = adminSession.headers['set-cookie']
      ?.find((value: string) => value.startsWith('cutroom_session='))

    expect(adminSessionCookie).toBeTruthy()
    if (!adminSessionCookie) return

    const adminListResponse = await request(app)
      .get('/api/users')
      .set('Cookie', adminSessionCookie)
      .expect(200)

    expect(adminListResponse.body.users).toHaveLength(2)
    expect(adminListResponse.body.users.map((user: { email: string }) => user.email)).toEqual([
      'owner@example.com',
      'admin@example.com',
    ])
  })

  it('does not allow team invite creation before bootstrap is completed', async () => {
    const { app } = createAuthApp()

    await request(app)
      .post('/api/users/invite')
      .send({ email: 'owner@example.com', role: 'owner' })
      .expect(401)
  })

  it('does not mark auth cookies secure for production http bootstrap flow', async () => {
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    try {
      const { app } = createAuthApp({ bootstrapSetupToken: '' })
      const inviteResponse = await request(app)
        .post('/api/users/bootstrap-owner-invite')
        .send({ email: 'owner@example.com' })
        .expect(201)

      const acceptResponse = await request(app)
        .post('/api/auth/accept-invite')
        .send({
          token: inviteResponse.body.invite.token,
          name: 'Owner',
          password: 'super-secret-pass',
        })
        .expect(200)

      expect(acceptResponse.headers['set-cookie']).toEqual(
        expect.arrayContaining([expect.not.stringContaining('Secure')]),
      )
    } finally {
      process.env.NODE_ENV = previousNodeEnv
    }
  })

  it('marks auth cookies secure when production requests arrive through https forwarding', async () => {
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    try {
      const { app } = createAuthApp({ bootstrapSetupToken: '' })
      const inviteResponse = await request(app)
        .post('/api/users/bootstrap-owner-invite')
        .set('X-Forwarded-Proto', 'https')
        .send({ email: 'owner@example.com' })
        .expect(201)

      const acceptResponse = await request(app)
        .post('/api/auth/accept-invite')
        .set('X-Forwarded-Proto', 'https')
        .send({
          token: inviteResponse.body.invite.token,
          name: 'Owner',
          password: 'super-secret-pass',
        })
        .expect(200)

      expect(acceptResponse.headers['set-cookie']).toEqual(
        expect.arrayContaining([expect.stringContaining('Secure')]),
      )
    } finally {
      process.env.NODE_ENV = previousNodeEnv
    }
  })
})
