import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type { StringValue } from 'ms';
import { getDb } from '../db/index.js';
import { users } from '../db/schema.js';
import { config } from '../config.js';
import { eq } from 'drizzle-orm';
import { AppError } from '../lib/errors.js';

export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResult {
  user: { id: string; email: string; name: string | null };
  token: string;
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  const db = getDb();

  const existing = await db.select().from(users).where(eq(users.email, input.email.toLowerCase())).limit(1);
  if (existing.length > 0) {
    throw new AppError('Email already registered', 409);
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const [user] = await db.insert(users).values({
    email: input.email.toLowerCase(),
    passwordHash,
    name: input.name || null,
  }).returning();

  const token = jwt.sign({ userId: user.id, auth_time: Math.floor(Date.now() / 1000) }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as StringValue,
    issuer: 'walwatch',
    audience: 'walwatch-api',
    ...(config.jwtKeyId ? { keyid: config.jwtKeyId } : {}),
  });
  return { user: { id: user.id, email: user.email, name: user.name }, token };
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const db = getDb();

  const [user] = await db.select().from(users).where(eq(users.email, input.email.toLowerCase())).limit(1);
  if (!user) {
    throw new AppError('Invalid email or password', 401);
  }

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) {
    throw new AppError('Invalid email or password', 401);
  }

  const token = jwt.sign({ userId: user.id, auth_time: Math.floor(Date.now() / 1000) }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as StringValue,
    issuer: 'walwatch',
    audience: 'walwatch-api',
    ...(config.jwtKeyId ? { keyid: config.jwtKeyId } : {}),
  });
  return { user: { id: user.id, email: user.email, name: user.name }, token };
}
