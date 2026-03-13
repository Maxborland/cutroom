import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { createDb } from '../../db/index.js';

export interface AuthUserRecord {
  id: string;
  email: string;
  name: string;
  role: AuthRole;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

export const AUTH_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;

export type AuthRole = (typeof AUTH_ROLES)[number];

export interface AuthInviteRecord {
  token: string;
  email: string;
  invitedByUserId: string | null;
  role: AuthRole;
  createdAt: string;
  acceptedAt: string | null;
}

export interface AuthSessionRecord {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

interface AuthState {
  users: AuthUserRecord[];
  invites: AuthInviteRecord[];
  sessions: AuthSessionRecord[];
}

export interface CreateInviteInput {
  email: string;
  invitedByUserId: string | null;
  role: AuthRole;
}

export interface AcceptInviteInput {
  token: string;
  name: string;
  passwordHash: string;
}

export class AuthRepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AuthRepositoryError';
    this.code = code;
  }
}

export interface AuthRepository {
  countUsers(): Promise<number>;
  listUsers(): Promise<AuthUserRecord[]>;
  findUserById(userId: string): Promise<AuthUserRecord | null>;
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
  createInvite(input: CreateInviteInput): Promise<AuthInviteRecord>;
  findInviteByToken(token: string): Promise<AuthInviteRecord | null>;
  acceptInvite(input: AcceptInviteInput): Promise<AuthUserRecord>;
  createSession(userId: string, expiresAt: Date): Promise<AuthSessionRecord>;
  findSessionByToken(token: string): Promise<AuthSessionRecord | null>;
  deleteSession(token: string): Promise<void>;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: AuthRole;
  createdAt: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function cloneUser(user: AuthUserRecord): AuthUserRecord {
  return { ...user };
}

function cloneInvite(invite: AuthInviteRecord): AuthInviteRecord {
  return { ...invite };
}

function cloneSession(session: AuthSessionRecord): AuthSessionRecord {
  return { ...session };
}

function isBootstrapInvite(invite: Pick<AuthInviteRecord, 'invitedByUserId'>): boolean {
  return invite.invitedByUserId === null;
}

export function isAuthRole(value: string): value is AuthRole {
  return AUTH_ROLES.includes(value as AuthRole);
}

class InMemoryAuthRepository implements AuthRepository {
  protected state: AuthState;

  constructor(initialState?: Partial<AuthState>) {
    this.state = {
      users: [...(initialState?.users ?? [])],
      invites: [...(initialState?.invites ?? [])],
      sessions: [...(initialState?.sessions ?? [])],
    };
  }

  async countUsers(): Promise<number> {
    return this.state.users.length;
  }

  async listUsers(): Promise<AuthUserRecord[]> {
    return this.state.users
      .slice()
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((user) => cloneUser(user));
  }

  async findUserById(userId: string): Promise<AuthUserRecord | null> {
    const user = this.state.users.find((entry) => entry.id === userId);
    return user ? cloneUser(user) : null;
  }

  async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const normalizedEmail = normalizeEmail(email);
    const user = this.state.users.find((entry) => entry.email === normalizedEmail);
    return user ? cloneUser(user) : null;
  }

  async createInvite(input: CreateInviteInput): Promise<AuthInviteRecord> {
    const email = normalizeEmail(input.email);
    const createdAt = new Date().toISOString();
    const invite: AuthInviteRecord = {
      token: randomBytes(24).toString('hex'),
      email,
      invitedByUserId: input.invitedByUserId,
      role: input.role,
      createdAt,
      acceptedAt: null,
    };

    this.state.invites = this.state.invites.filter((entry) => {
      if (entry.acceptedAt !== null) {
        return true;
      }

      if (input.invitedByUserId === null && isBootstrapInvite(entry)) {
        return false;
      }

      return entry.email !== email;
    });

    this.state.invites.push(invite);
    return cloneInvite(invite);
  }

  async findInviteByToken(token: string): Promise<AuthInviteRecord | null> {
    const invite = this.state.invites.find((entry) => entry.token === token);
    return invite ? cloneInvite(invite) : null;
  }

  async acceptInvite(input: AcceptInviteInput): Promise<AuthUserRecord> {
    const invite = this.state.invites.find((entry) => entry.token === input.token);
    if (!invite) {
      throw new AuthRepositoryError('INVITE_NOT_FOUND', 'Invite not found');
    }

    if (invite.acceptedAt) {
      throw new AuthRepositoryError('INVITE_ALREADY_ACCEPTED', 'Invite has already been accepted');
    }

    if (isBootstrapInvite(invite) && this.state.users.length > 0) {
      throw new AuthRepositoryError('BOOTSTRAP_INVITE_CLOSED', 'Bootstrap invite is no longer valid');
    }

    const existingUser = this.state.users.find((entry) => entry.email === invite.email);
    if (existingUser) {
      throw new AuthRepositoryError('USER_ALREADY_EXISTS', 'User already exists');
    }

    const timestamp = new Date().toISOString();
    const user: AuthUserRecord = {
      id: randomUUID(),
      email: invite.email,
      name: input.name.trim(),
      role: invite.role,
      passwordHash: input.passwordHash,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    invite.acceptedAt = timestamp;
    this.state.users.push(user);
    if (isBootstrapInvite(invite)) {
      this.state.invites = this.state.invites.filter(
        (entry) => entry.token === invite.token || !isBootstrapInvite(entry) || entry.acceptedAt !== null,
      );
    }

    return cloneUser(user);
  }

  async createSession(userId: string, expiresAt: Date): Promise<AuthSessionRecord> {
    const session: AuthSessionRecord = {
      token: randomBytes(32).toString('hex'),
      userId,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    this.state.sessions.push(session);
    return cloneSession(session);
  }

  async findSessionByToken(token: string): Promise<AuthSessionRecord | null> {
    const now = Date.now();
    this.state.sessions = this.state.sessions.filter((entry) => new Date(entry.expiresAt).getTime() > now);
    const session = this.state.sessions.find((entry) => entry.token === token);
    return session ? cloneSession(session) : null;
  }

  async deleteSession(token: string): Promise<void> {
    this.state.sessions = this.state.sessions.filter((entry) => entry.token !== token);
  }
}

type AuthDb = Pick<Pool, 'query' | 'connect'>;

interface CreateAuthRepositoryOptions {
  db?: AuthDb;
  connectionString?: string;
}

type AuthUserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  password_hash: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type AuthInviteRow = {
  token: string;
  email: string;
  invited_by_user_id: string | null;
  role: string;
  created_at: Date | string;
  accepted_at: Date | string | null;
};

type AuthSessionRow = {
  token: string;
  user_id: string;
  created_at: Date | string;
  expires_at: Date | string;
};

function normalizeTimestampValue(value: Date | string | null): string | null {
  if (value == null) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function mapUserRow(row: AuthUserRow | undefined): AuthUserRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: isAuthRole(row.role) ? row.role : 'editor',
    passwordHash: row.password_hash,
    createdAt: normalizeTimestampValue(row.created_at) ?? new Date().toISOString(),
    updatedAt: normalizeTimestampValue(row.updated_at) ?? new Date().toISOString(),
  };
}

function mapInviteRow(row: AuthInviteRow | undefined): AuthInviteRecord | null {
  if (!row) {
    return null;
  }

  return {
    token: row.token,
    email: row.email,
    invitedByUserId: row.invited_by_user_id,
    role: isAuthRole(row.role) ? row.role : 'editor',
    createdAt: normalizeTimestampValue(row.created_at) ?? new Date().toISOString(),
    acceptedAt: normalizeTimestampValue(row.accepted_at),
  };
}

function mapSessionRow(row: AuthSessionRow | undefined): AuthSessionRecord | null {
  if (!row) {
    return null;
  }

  return {
    token: row.token,
    userId: row.user_id,
    createdAt: normalizeTimestampValue(row.created_at) ?? new Date().toISOString(),
    expiresAt: normalizeTimestampValue(row.expires_at) ?? new Date().toISOString(),
  };
}

async function withTransaction<T>(db: AuthDb, task: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    const result = await task(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresAuthRepository implements AuthRepository {
  private readonly db: AuthDb;

  constructor(options: CreateAuthRepositoryOptions = {}) {
    this.db = options.db ?? createDb(options.connectionString);
  }

  async countUsers(): Promise<number> {
    const result = await this.db.query<{ count: string | number }>('SELECT COUNT(*) AS count FROM auth_users');
    return Number(result.rows[0]?.count ?? 0);
  }

  async listUsers(): Promise<AuthUserRecord[]> {
    const result = await this.db.query<AuthUserRow>(
      `
        SELECT id, email, name, role, password_hash, created_at, updated_at
        FROM auth_users
        ORDER BY created_at ASC
      `,
    );

    return result.rows
      .map((row) => mapUserRow(row))
      .filter((user): user is AuthUserRecord => Boolean(user));
  }

  async findUserById(userId: string): Promise<AuthUserRecord | null> {
    const result = await this.db.query<AuthUserRow>(
      `
        SELECT id, email, name, role, password_hash, created_at, updated_at
        FROM auth_users
        WHERE id = $1
        LIMIT 1
      `,
      [userId],
    );

    return mapUserRow(result.rows[0]);
  }

  async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const result = await this.db.query<AuthUserRow>(
      `
        SELECT id, email, name, role, password_hash, created_at, updated_at
        FROM auth_users
        WHERE email = $1
        LIMIT 1
      `,
      [normalizeEmail(email)],
    );

    return mapUserRow(result.rows[0]);
  }

  async createInvite(input: CreateInviteInput): Promise<AuthInviteRecord> {
    return withTransaction(this.db, async (client) => {
      const email = normalizeEmail(input.email);
      const token = randomBytes(24).toString('hex');
      const createdAt = new Date().toISOString();

      if (input.invitedByUserId === null) {
        await client.query('LOCK TABLE auth_invites IN EXCLUSIVE MODE');
        await client.query(
          `
            DELETE FROM auth_invites
            WHERE invited_by_user_id IS NULL AND accepted_at IS NULL
          `,
        );
      } else {
        await client.query(
          `
            DELETE FROM auth_invites
            WHERE email = $1 AND accepted_at IS NULL
          `,
          [email],
        );
      }

      const result = await client.query<AuthInviteRow>(
        `
          INSERT INTO auth_invites (token, email, invited_by_user_id, role, created_at, accepted_at)
          VALUES ($1, $2, $3, $4, $5, NULL)
          RETURNING token, email, invited_by_user_id, role, created_at, accepted_at
        `,
        [token, email, input.invitedByUserId, input.role, createdAt],
      );

      return mapInviteRow(result.rows[0]) as AuthInviteRecord;
    });
  }

  async findInviteByToken(token: string): Promise<AuthInviteRecord | null> {
    const result = await this.db.query<AuthInviteRow>(
      `
        SELECT token, email, invited_by_user_id, role, created_at, accepted_at
        FROM auth_invites
        WHERE token = $1
        LIMIT 1
      `,
      [token],
    );

    return mapInviteRow(result.rows[0]);
  }

  async acceptInvite(input: AcceptInviteInput): Promise<AuthUserRecord> {
    return withTransaction(this.db, async (client) => {
      const inviteResult = await client.query<AuthInviteRow>(
        `
          SELECT token, email, invited_by_user_id, role, created_at, accepted_at
          FROM auth_invites
          WHERE token = $1
          FOR UPDATE
        `,
        [input.token],
      );

      const invite = mapInviteRow(inviteResult.rows[0]);
      if (!invite) {
        throw new AuthRepositoryError('INVITE_NOT_FOUND', 'Invite not found');
      }

      if (invite.acceptedAt) {
        throw new AuthRepositoryError('INVITE_ALREADY_ACCEPTED', 'Invite has already been accepted');
      }

      if (isBootstrapInvite(invite)) {
        const userCountResult = await client.query<{ count: string | number }>(
          `
            SELECT COUNT(*) AS count
            FROM auth_users
          `,
        );

        if (Number(userCountResult.rows[0]?.count ?? 0) > 0) {
          throw new AuthRepositoryError('BOOTSTRAP_INVITE_CLOSED', 'Bootstrap invite is no longer valid');
        }
      }

      const existingUserResult = await client.query<{ id: string }>(
        `
          SELECT id
          FROM auth_users
          WHERE email = $1
          LIMIT 1
        `,
        [invite.email],
      );

      if (existingUserResult.rows[0]) {
        throw new AuthRepositoryError('USER_ALREADY_EXISTS', 'User already exists');
      }

      const userId = randomUUID();
      const timestamp = new Date().toISOString();

      const userResult = await client.query<AuthUserRow>(
        `
          INSERT INTO auth_users (id, email, name, role, password_hash, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id, email, name, role, password_hash, created_at, updated_at
        `,
        [userId, invite.email, input.name.trim(), invite.role, input.passwordHash, timestamp, timestamp],
      );

      await client.query(
        `
          UPDATE auth_invites
          SET accepted_at = $2
          WHERE token = $1
        `,
        [invite.token, timestamp],
      );

      if (isBootstrapInvite(invite)) {
        await client.query(
          `
            DELETE FROM auth_invites
            WHERE invited_by_user_id IS NULL AND accepted_at IS NULL AND token <> $1
          `,
          [invite.token],
        );
      }

      return mapUserRow(userResult.rows[0]) as AuthUserRecord;
    });
  }

  async createSession(userId: string, expiresAt: Date): Promise<AuthSessionRecord> {
    const token = randomBytes(32).toString('hex');
    const createdAt = new Date().toISOString();

    const result = await this.db.query<AuthSessionRow>(
      `
        INSERT INTO auth_sessions (token, user_id, created_at, expires_at)
        VALUES ($1, $2, $3, $4)
        RETURNING token, user_id, created_at, expires_at
      `,
      [token, userId, createdAt, expiresAt.toISOString()],
    );

    return mapSessionRow(result.rows[0]) as AuthSessionRecord;
  }

  async findSessionByToken(token: string): Promise<AuthSessionRecord | null> {
    const result = await this.db.query<AuthSessionRow>(
      `
        SELECT token, user_id, created_at, expires_at
        FROM auth_sessions
        WHERE token = $1 AND expires_at > NOW()
        LIMIT 1
      `,
      [token],
    );

    return mapSessionRow(result.rows[0]);
  }

  async deleteSession(token: string): Promise<void> {
    await this.db.query('DELETE FROM auth_sessions WHERE token = $1', [token]);
  }
}

export function createInMemoryAuthRepository(initialState?: Partial<AuthState>): AuthRepository {
  return new InMemoryAuthRepository(initialState);
}

export function createAuthRepository(options: CreateAuthRepositoryOptions = {}): AuthRepository {
  return new PostgresAuthRepository(options);
}

export function createDefaultAuthRepository(): AuthRepository {
  return createAuthRepository();
}

export function toAuthUser(user: AuthUserRecord): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
  };
}
