import { describe, test, expect } from 'bun:test';
import { diagnoseLockAccess } from './diagnosis.ts';
import type { HostfullyClient } from '../hostfully-client/client.ts';
import type { SifelyClient } from '../sifely-client/sifely-client.ts';
import type { VlreHubClient } from '../vlre-hub-client/vlre-hub-client.ts';
import type { PropertyLock, LockPasscode, AccessRecord } from '../lock-types.ts';

const defaultLock: PropertyLock = {
  lockId: 'cl1',
  sifelyLockId: 'sifely-1',
  lockName: 'Front Door',
  lockRole: 'FRONT_DOOR',
};

const permanentPasscode: LockPasscode = {
  keyboardPwdId: 1,
  lockId: 'sifely-1',
  keyboardPwd: '1234',
  keyboardPwdName: 'Guest Code',
  keyboardPwdType: 2,
  startDate: 0,
  endDate: 0,
  status: 1,
};

function makeClients(opts: {
  doorCode: string | null;
  locks: PropertyLock[];
  passcodes: LockPasscode[];
  accessRecords?: AccessRecord[];
  listPasscodesThrows?: boolean;
}) {
  const hf = {
    getDoorCode: async () => opts.doorCode,
  } as unknown as HostfullyClient;

  const hub = {
    getLocksForProperty: async () => opts.locks,
  } as unknown as VlreHubClient;

  const sifely = {
    listPasscodes: opts.listPasscodesThrows
      ? async () => { throw new Error('Sifely connection error'); }
      : async () => opts.passcodes,
    listAccessRecords: async () => opts.accessRecords ?? [],
  } as unknown as SifelyClient;

  return { hf, hub, sifely };
}

describe('diagnoseLockAccess', () => {
  test('codes match — hasMismatch is false and summary contains "match"', async () => {
    const { hf, hub, sifely } = makeClients({
      doorCode: '1234',
      locks: [defaultLock],
      passcodes: [permanentPasscode],
    });

    const result = await diagnoseLockAccess({
      propertyUid: 'prop-1',
      hostfullyClient: hf,
      sifelyClient: sifely,
      vlreHubClient: hub,
    });

    expect(result.hasMismatch).toBe(false);
    expect(result.diagnosisSummary.toLowerCase()).toContain('match');
  });

  test('codes mismatch — hasMismatch is true and summary contains "MISMATCH"', async () => {
    const mismatchedPasscode: LockPasscode = { ...permanentPasscode, keyboardPwd: '9999' };
    const { hf, hub, sifely } = makeClients({
      doorCode: '1234',
      locks: [defaultLock],
      passcodes: [mismatchedPasscode],
    });

    const result = await diagnoseLockAccess({
      propertyUid: 'prop-1',
      hostfullyClient: hf,
      sifelyClient: sifely,
      vlreHubClient: hub,
    });

    expect(result.hasMismatch).toBe(true);
    expect(result.diagnosisSummary).toContain('MISMATCH');
  });

  test('null door code — returns early with hasMismatch false and "No door code" in summary', async () => {
    const { hf, hub, sifely } = makeClients({
      doorCode: null,
      locks: [],
      passcodes: [],
    });

    const result = await diagnoseLockAccess({
      propertyUid: 'prop-1',
      hostfullyClient: hf,
      sifelyClient: sifely,
      vlreHubClient: hub,
    });

    expect(result.hasMismatch).toBe(false);
    expect(result.diagnosisSummary).toContain('No door code');
    expect(result.locks).toHaveLength(0);
    expect(result.hostfullyDoorCode).toBeNull();
  });

  test('no locks — returns early with hasMismatch false and locks.length === 0', async () => {
    const { hf, hub, sifely } = makeClients({
      doorCode: '1234',
      locks: [],
      passcodes: [],
    });

    const result = await diagnoseLockAccess({
      propertyUid: 'prop-1',
      hostfullyClient: hf,
      sifelyClient: sifely,
      vlreHubClient: hub,
    });

    expect(result.hasMismatch).toBe(false);
    expect(result.locks).toHaveLength(0);
  });

  test('Sifely listPasscodes throws — returns LockDiagnosis without throwing', async () => {
    const { hf, hub, sifely } = makeClients({
      doorCode: '1234',
      locks: [defaultLock],
      passcodes: [],
      listPasscodesThrows: true,
    });

    const result = await diagnoseLockAccess({
      propertyUid: 'prop-1',
      hostfullyClient: hf,
      sifelyClient: sifely,
      vlreHubClient: hub,
    });

    expect(result).toBeDefined();
    expect(typeof result.diagnosisSummary).toBe('string');
    expect(result.locks).toHaveLength(1);
    expect(result.hasMismatch).toBe(false);
  });

  test('access records included in summary when present', async () => {
    const accessRecord: AccessRecord = {
      recordId: 1,
      lockId: 123,
      recordType: 4,
      success: 1,
      keyboardPwd: '1234',
      lockDate: Date.now() - 60_000,
      serverDate: Date.now() - 59_000,
    };
    const { hf, hub, sifely } = makeClients({
      doorCode: '1234',
      locks: [defaultLock],
      passcodes: [permanentPasscode],
      accessRecords: [accessRecord],
    });

    const result = await diagnoseLockAccess({
      propertyUid: 'prop-1',
      hostfullyClient: hf,
      sifelyClient: sifely,
      vlreHubClient: hub,
    });

    expect(result.locks[0]?.accessRecords).toHaveLength(1);
    expect(result.diagnosisSummary).toContain('successful');
  });
});
