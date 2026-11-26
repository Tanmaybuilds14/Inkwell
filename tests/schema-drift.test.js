/**
 * Drift guard for the sync service's hand-written SQL.
 *
 * sync-service/src/db.js talks to Postgres with `pg` instead of the generated
 * Prisma client (so the two deployables stay independently buildable), which
 * means every table and column name in it is a string literal that Prisma
 * knows nothing about. Renaming a field in prisma/schema.prisma would
 * therefore break the live session path — document load, snapshot persistence,
 * version cadence, audit writes — at runtime, in production, with no compile
 * or test failure anywhere.
 *
 * This test parses prisma/schema.prisma and checks the raw SQL against it, so
 * a rename fails here instead. It also pins the shared Role enum, because the
 * API layer and the WebSocket handshake both branch on those values.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

import { ROLES } from '../shared/roles.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaSource = fs.readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8');
const dbSource = fs.readFileSync(path.join(root, 'sync-service', 'src', 'db.js'), 'utf8');

/** model name → Set of field names */
function parseModels(source) {
  const models = new Map();
  for (const match of source.matchAll(/^model\s+(\w+)\s*\{([^}]*)\}/gm)) {
    const [, name, body] = match;
    const fields = new Set(
      body
        .split('\n')
        .map((line) => /^\s{2,}(\w+)\s+\S/.exec(line))
        .filter(Boolean)
        .map((m) => m[1])
    );
    models.set(name, fields);
  }
  return models;
}

function parseEnum(source, enumName) {
  const match = new RegExp(`^enum\\s+${enumName}\\s*\\{([^}]*)\\}`, 'm').exec(source);
  if (!match) return null;
  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//') && !line.startsWith('@@'));
}

const models = parseModels(schemaSource);

/**
 * Pull the SQL template literals out of db.js. Anything without a SQL verb is
 * skipped — the file also builds parameter placeholders in template strings.
 */
function extractSqlStatements(source) {
  return [...source.matchAll(/`([^`]*)`/g)]
    .map((m) => m[1])
    .filter((sql) => /\b(SELECT|INSERT|UPDATE|DELETE|CREATE)\b/.test(sql));
}

const statements = extractSqlStatements(dbSource);

// Identifiers that name a table rather than a column.
const TABLE_POSITION = /\b(?:FROM|INTO|UPDATE|TABLE|JOIN|ON)\s+"([^"]+)"/g;
// Index/constraint names are quoted too but are not columns.
const NAMED_OBJECT = /\b(?:INDEX|CONSTRAINT)\s+(?:IF NOT EXISTS\s+)?"([^"]+)"/g;

describe('sync-service SQL vs prisma/schema.prisma', () => {
  it('parsed the schema and found the SQL to check', () => {
    // Guards the guard: a parser that silently matches nothing would make
    // every assertion below vacuously true.
    expect(models.size).toBeGreaterThanOrEqual(6);
    expect(statements.length).toBeGreaterThanOrEqual(8);
    expect(models.has('Document')).toBe(true);
  });

  it('every table referenced by raw SQL is a real model', () => {
    const referenced = new Set();
    for (const sql of statements) {
      for (const match of sql.matchAll(TABLE_POSITION)) referenced.add(match[1]);
    }
    expect([...referenced].sort()).toEqual(
      ['ActivityEvent', 'Document', 'Permission', 'User', 'VersionSnapshot'].sort()
    );
    for (const table of referenced) {
      expect(models.has(table), `unknown table "${table}" in sync-service/src/db.js`).toBe(true);
    }
  });

  it('every column referenced by raw SQL exists on that statement\'s table', () => {
    const problems = [];
    for (const sql of statements) {
      const tables = [...sql.matchAll(TABLE_POSITION)].map((m) => m[1]);
      if (tables.length === 0) continue;

      const ignored = new Set([...sql.matchAll(NAMED_OBJECT)].map((m) => m[1]));
      const quoted = [...sql.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

      for (const identifier of quoted) {
        if (tables.includes(identifier) || ignored.has(identifier)) continue;
        const known = tables.some((table) => models.get(table)?.has(identifier));
        if (!known) problems.push(`"${identifier}" is not a column of ${tables.join('/')}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('shared ROLES matches the Prisma Role enum', () => {
    const roleEnum = parseEnum(schemaSource, 'Role');
    expect(roleEnum).not.toBeNull();
    // Both runtimes branch on these strings; a new enum member that is not in
    // shared/roles.js would be treated as "no access" (fail-closed, but wrong).
    expect([...Object.values(ROLES)].sort()).toEqual([...roleEnum].sort());
  });
});
