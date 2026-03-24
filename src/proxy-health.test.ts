import { test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { startProxyHealthMonitor } from './proxy-health.ts';

let logSpy: ReturnType<typeof spyOn<typeof console, 'log'>>;

beforeEach(() => {
  logSpy = spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
});

test('logs "proxy is DOWN" when port transitions up→down', async () => {
  let callCount = 0;
  const mockCheck = async (_host: string, _port: number) => callCount++ === 0;

  const handle = startProxyHealthMonitor('127.0.0.1', 3456, {
    intervalMs: 10,
    _checkFn: mockCheck,
  });

  await new Promise((r) => setTimeout(r, 50));
  handle.stop();

  const calls = logSpy.mock.calls.map((c) => String(c[0]));
  expect(calls.some((msg) => /proxy is DOWN/i.test(msg))).toBe(true);
});

test('logs "proxy recovered" when port transitions down→up', async () => {
  let callCount = 0;
  const mockCheck = async (_host: string, _port: number) => {
    const n = callCount++;
    if (n === 0) return false;
    return true;
  };

  const handle = startProxyHealthMonitor('127.0.0.1', 3456, {
    intervalMs: 10,
    _checkFn: mockCheck,
  });

  await new Promise((r) => setTimeout(r, 50));
  handle.stop();

  const calls = logSpy.mock.calls.map((c) => String(c[0]));
  expect(calls.some((msg) => /proxy is DOWN/i.test(msg))).toBe(true);
  expect(calls.some((msg) => /proxy recovered/i.test(msg))).toBe(true);
});

test('does NOT re-log when proxy stays down (no spam)', async () => {
  const mockCheck = async (_host: string, _port: number) => false;

  const handle = startProxyHealthMonitor('127.0.0.1', 3456, {
    intervalMs: 10,
    _checkFn: mockCheck,
  });

  await new Promise((r) => setTimeout(r, 50));
  handle.stop();

  const downLogs = logSpy.mock.calls.filter((c) => /proxy is DOWN/i.test(String(c[0])));
  expect(downLogs.length).toBe(1);
});

test('stop() clears the interval and no more logging happens', async () => {
  let callCount = 0;
  const mockCheck = async (_host: string, _port: number) => {
    callCount++;
    return false;
  };

  const handle = startProxyHealthMonitor('127.0.0.1', 3456, {
    intervalMs: 10,
    _checkFn: mockCheck,
  });

  await new Promise((r) => setTimeout(r, 30));
  handle.stop();

  const countAfterStop = logSpy.mock.calls.length;
  await new Promise((r) => setTimeout(r, 30));

  expect(logSpy.mock.calls.length).toBe(countAfterStop);
});
