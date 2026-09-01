import { describe, expect, it } from 'vitest';
import {
  ROLES,
  canComment,
  canEdit,
  canManage,
  canView,
  hasRole,
} from '@/lib/permissions';

describe('role hierarchy', () => {
  it.each([
    ['OWNER', 'OWNER', true],
    ['OWNER', 'EDITOR', true],
    ['EDITOR', 'VIEWER', true],
    ['COMMENTER', 'VIEWER', true],
    ['VIEWER', 'VIEWER', true],
    // Negative cases — the permission boundary.
    ['VIEWER', 'EDITOR', false],
    ['VIEWER', 'COMMENTER', false],
    ['COMMENTER', 'EDITOR', false],
    ['EDITOR', 'OWNER', false],
  ])('%s satisfies %s = %s', (actual, required, expected) => {
    expect(hasRole(actual, required)).toBe(expected);
  });

  it('fails closed on missing or unknown roles', () => {
    expect(hasRole(null, 'VIEWER')).toBe(false);
    expect(hasRole(undefined, 'VIEWER')).toBe(false);
    expect(hasRole('', 'VIEWER')).toBe(false);
    expect(hasRole('ADMIN', 'VIEWER')).toBe(false); // unknown role never passes
    expect(hasRole('VIEWER', null)).toBe(false);
  });
});

describe('capability checks', () => {
  it('editors+ may edit; viewers/commenters may not', () => {
    expect(canEdit('OWNER')).toBe(true);
    expect(canEdit('EDITOR')).toBe(true);
    expect(canEdit('COMMENTER')).toBe(false);
    expect(canEdit('VIEWER')).toBe(false);
    expect(canEdit(null)).toBe(false);
  });

  it('everyone with any valid role may view', () => {
    for (const role of Object.values(ROLES)) {
      expect(canView(role)).toBe(true);
    }
    expect(canView(null)).toBe(false);
  });

  it('only owners manage sharing/permissions/deletion', () => {
    expect(canManage('OWNER')).toBe(true);
    expect(canManage('EDITOR')).toBe(false);
    expect(canManage(null)).toBe(false);
  });

  it('commenter+ may comment', () => {
    expect(canComment('COMMENTER')).toBe(true);
    expect(canComment('EDITOR')).toBe(true);
    expect(canComment('VIEWER')).toBe(false);
  });
});
