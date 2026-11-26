/**
 * Tests for the error/telemetry funnel.
 *
 * The load-bearing claim is that reporting can never make things worse: an
 * error handler that throws replaces the error it was reporting, so the funnel
 * must swallow every failure — including the @sentry/nextjs v10 quirk it works
 * around, where the server entry exposes `captureException` only on the CJS
 * interop `default` rather than as a named export.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

import {
  reportError,
  addTelemetryBreadcrumb,
  isReportingConfigured,
} from '../src/lib/error-reporting.js';

const DSN = 'https://public@example.invalid/1';

afterEach(() => {
  delete process.env.SENTRY_DSN;
  delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  vi.restoreAllMocks();
});

describe('error reporting', () => {
  it('is inert until a DSN is configured', () => {
    expect(isReportingConfigured()).toBe(false);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // No DSN: local log only, no SDK lookup, nothing to send.
    reportError(new Error('nope'), { scope: 'test' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('logs locally and forwards once a DSN is set, without throwing', async () => {
    process.env.SENTRY_DSN = DSN;
    expect(isReportingConfigured()).toBe(true);

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => reportError(new Error('boom'), { scope: 'route-error' })).not.toThrow();
    expect(() => addTelemetryBreadcrumb('doc_created', { document_id: 'd1' })).not.toThrow();

    // Let the lazy import settle; it must not reject.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(spy).toHaveBeenCalledWith('[error] route-error:', expect.any(Error));
  });

  it('resolves the Sentry API the way the bucket does (named export or interop default)', async () => {
    const mod = await import('@sentry/nextjs');
    for (const name of ['captureException', 'addBreadcrumb']) {
      const candidate = mod?.[name] ?? mod?.default?.[name];
      expect(typeof candidate, `${name} should be reachable on either shape`).toBe('function');
    }
  });

  it('accepts a client-side DSN too', () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = DSN;
    expect(isReportingConfigured()).toBe(true);
  });
});
