import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolvePathWithin } from '../file-utils.js';

export interface AuthUserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthInviteRecord {
  token: string;
  email: string;
  invitedByUserId: string | null;
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

function emptyState(): AuthState {
  return { users: [], invites: [], sessions: [] };
}

async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  const directory = path.dirname(filePath);
  const filename = path.basename(filePath);
  const tempPath = path.join(
    directory,
    `.${filename}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );

  await fs.mkdir(directory, { recursive: true });

  try {
    await fs.writeFile(tempPath, contents, 'utf-8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    try {
      await fs.copyFile(tempPath, filePath);
      await fs.unlink(tempPath);
    } catch {
      try {
        await fs.unlink(tempPath);
      } catch {
        // ignore cleanup errors
      }
      throw error;
    }
  }
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
      createdAt,
      acceptedAt: null,
    };

    this.state.invites = this.state.invites.filter((entry) => !(entry.email === email && entry.acceptedAt === null));
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

    const existingUser = this.state.users.find((entry) => entry.email === invite.email);
    if (existingUser) {
      throw new AuthRepositoryError('USER_ALREADY_EXISTS', 'User already exists');
    }

    const timestamp = new Date().toISOString();
    const user: AuthUserRecord = {
      id: randomUUID(),
      email: invite.email,
      name: input.name.trim(),
      passwordHash: input.passwordHash,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    invite.acceptedAt = timestamp;
    this.state.users.push(user);
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

class FileAuthRepository extends InMemoryAuthRepository {
  private readonly filePath: string;
  private loadPromise: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(filePath: string) {
    super(emptyState());
    this.filePath = filePath;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const raw = await fs.readFile(this.filePath, 'utf-8');
          const parsed = JSON.parse(raw) as Partial<AuthState>;
          this.state = {
            users: Array.isArray(parsed.users) ? parsed.users : [],
            invites: Array.isArray(parsed.invites) ? parsed.invites : [],
            sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
          };
        } catch (error) {
          const code = (error as NodeJS.ErrnoException | null)?.code;
          if (code !== 'ENOENT') {
            throw error;
          }
          this.state = emptyState();
        }
      })();
    }

    await this.loadPromise;
  }

  private async runExclusive<T>(persist: boolean, task: () => Promise<T>): Promise<T> {
    const run = async () => {
      await this.ensureLoaded();
      const result = await task();
      if (persist) {
        await writeFileAtomic(this.filePath, JSON.stringify(this.state, null, 2));
      }
      return result;
    };

    const next = this.queue.catch(() => undefined).then(run);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  override async countUsers(): Promise<number> {
    return this.runExclusive(false, () => super.countUsers());
  }

  override async findUserById(userId: string): Promise<AuthUserRecord | null> {
    return this.runExclusive(false, () => super.findUserById(userId));
  }

  override async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    return this.runExclusive(false, () => super.findUserByEmail(email));
  }

  override async createInvite(input: CreateInviteInput): Promise<AuthInviteRecord> {
    return this.runExclusive(true, () => super.createInvite(input));
  }

  override async findInviteByToken(token: string): Promise<AuthInviteRecord | null> {
    return this.runExclusive(false, () => super.findInviteByToken(token));
  }

  override async acceptInvite(input: AcceptInviteInput): Promise<AuthUserRecord> {
    return this.runExclusive(true, () => super.acceptInvite(input));
  }

  override async createSession(userId: string, expiresAt: Date): Promise<AuthSessionRecord> {
    return this.runExclusive(true, () => super.createSession(userId, expiresAt));
  }

  override async findSessionByToken(token: string): Promise<AuthSessionRecord | null> {
    return this.runExclusive(true, () => super.findSessionByToken(token));
  }

  override async deleteSession(token: string): Promise<void> {
    await this.runExclusive(true, () => super.deleteSession(token));
  }
}

const DEFAULT_AUTH_STATE_PATH = resolvePathWithin(process.cwd(), 'data', 'auth', 'state.json');

export function createInMemoryAuthRepository(initialState?: Partial<AuthState>): AuthRepository {
  return new InMemoryAuthRepository(initialState);
}

export function createFileAuthRepository(filePath = DEFAULT_AUTH_STATE_PATH): AuthRepository {
  return new FileAuthRepository(filePath);
}

export function createDefaultAuthRepository(): AuthRepository {
  return createFileAuthRepository();
}

export function toAuthUser(user: AuthUserRecord): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
  };
}
