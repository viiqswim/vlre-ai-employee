import type { LockDiagnosis, PropertyLock, LockPasscode, AccessRecord } from '../lock-types.ts';
import type { SifelyClient } from '../sifely-client/sifely-client.ts';
import type { VlreHubClient } from '../vlre-hub-client/vlre-hub-client.ts';
import type { HostfullyClient } from '../hostfully-client/client.ts';

export interface DiagnosisParams {
  propertyUid: string;
  hostfullyClient: HostfullyClient;
  sifelyClient: SifelyClient;
  vlreHubClient: VlreHubClient;
}

export async function diagnoseLockAccess(params: DiagnosisParams): Promise<LockDiagnosis> {
  const { propertyUid, hostfullyClient, sifelyClient, vlreHubClient } = params;

  // Step 1: Get Hostfully door code
  let hostfullyDoorCode: string | null = null;
  try {
    hostfullyDoorCode = await hostfullyClient.getDoorCode(propertyUid);
  } catch {
    // getDoorCode failure is non-fatal; proceed with null
  }

  if (hostfullyDoorCode === null) {
    return {
      hostfullyDoorCode: null,
      locks: [],
      hasMismatch: false,
      diagnosisSummary: 'No door code configured in Hostfully for this property.',
    };
  }

  const propertyLocks: PropertyLock[] = await vlreHubClient.getLocksForProperty(propertyUid);

  if (propertyLocks.length === 0) {
    return {
      hostfullyDoorCode,
      locks: [],
      hasMismatch: false,
      diagnosisSummary: `No locks found for this property. Door code: ${hostfullyDoorCode}`,
    };
  }

  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  const now = Date.now();

  const lockResults = await Promise.all(
    propertyLocks.map(async (lock) => {
      let passcodes: LockPasscode[] = [];
      let accessRecords: AccessRecord[] = [];

      try {
        passcodes = await sifelyClient.listPasscodes(lock.sifelyLockId);
      } catch {
        // Sifely failure for one lock is non-fatal; skip and continue
      }

      try {
        accessRecords = await sifelyClient.listAccessRecords(lock.sifelyLockId, twoHoursAgo, now);
      } catch {
        // Sifely failure for one lock is non-fatal; skip and continue
      }

      const permanentPasscodes = passcodes.filter((p) => p.keyboardPwdType === 2);
      const matchesHostfully = permanentPasscodes.some((p) => p.keyboardPwd === hostfullyDoorCode);

      return { lock, passcodes, matchesHostfully, accessRecords };
    })
  );

  const hasMismatch = lockResults.some((r) => !r.matchesHostfully && r.passcodes.length > 0);

  const summaryLines: string[] = [];

  if (hasMismatch) {
    summaryLines.push(`⚠️ CODE MISMATCH DETECTED — Hostfully door code: ${hostfullyDoorCode}`);
    for (const { lock, passcodes, matchesHostfully } of lockResults) {
      const permanentCodes = passcodes.filter((p) => p.keyboardPwdType === 2).map((p) => p.keyboardPwd);
      if (!matchesHostfully) {
        summaryLines.push(`  ❌ Lock "${lock.lockName}" (${lock.lockRole}): has codes [${permanentCodes.join(', ')}]`);
      } else {
        summaryLines.push(`  ✅ Lock "${lock.lockName}" (${lock.lockRole}): matches`);
      }
    }
  } else {
    summaryLines.push(`✅ All lock codes match the door code (${hostfullyDoorCode})`);
  }

  // Add access record summary
  for (const { lock, accessRecords } of lockResults) {
    if (accessRecords.length === 0) {
      summaryLines.push(`  🔒 ${lock.lockName}: No access attempts in the last 2 hours`);
    } else {
      const passcodeAttempts = accessRecords.filter((r) => r.recordType === 4);
      const successful = passcodeAttempts.filter((r) => r.success === 1);
      const failed = passcodeAttempts.filter((r) => r.success === 0);

      if (successful.length > 0) {
        summaryLines.push(`  ✅ ${lock.lockName}: ${successful.length} successful entry(ies)`);
      }
      if (failed.length > 0) {
        const wrongCodes = [...new Set(failed.map((r) => r.keyboardPwd))];
        summaryLines.push(`  ❌ ${lock.lockName}: ${failed.length} failed attempt(s) with code(s): ${wrongCodes.join(', ')}`);
      }
    }
  }

  return {
    hostfullyDoorCode,
    locks: lockResults,
    hasMismatch,
    diagnosisSummary: summaryLines.join('\n'),
  };
}
