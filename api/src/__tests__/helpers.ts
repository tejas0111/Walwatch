import { getDb } from '../db/index.js';
import { users } from '../db/schema.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export async function createTestUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const db = getDb();
  const [user] = await db.insert(users).values({
    email: overrides.email || `test-${Date.now()}@example.com`,
    passwordHash: await bcrypt.hash('password123', 10),
    name: overrides.name || 'Test User',
  }).returning();
  return user;
}

export function generateToken(userId: string): string {
  return jwt.sign({ userId }, config.jwtSecret, { expiresIn: '1h' });
}
