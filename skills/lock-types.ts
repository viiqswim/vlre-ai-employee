export type LockRole = 'FRONT_DOOR' | 'BACK_DOOR' | 'ROOM_DOOR' | 'COMMON_AREA';

export interface PropertyLock {
  lockId: string;
  sifelyLockId: string;
  lockName: string;
  lockRole: LockRole;
}

export interface LockPasscode {
  keyboardPwdId: number;
  lockId: string;
  keyboardPwd: string;
  keyboardPwdName: string;
  keyboardPwdType: number; // 1=ONE_TIME, 2=PERMANENT, 3=TIMED
  startDate: number;
  endDate: number;
  status: number;
}

export interface AccessRecord {
  recordId: number;
  lockId: number;
  recordType: number; // 4=passcode
  success: number; // 1=success, 0=failed
  keyboardPwd: string;
  lockDate: number; // ms since epoch
  serverDate: number;
}

export interface LockDiagnosis {
  hostfullyDoorCode: string | null;
  locks: Array<{
    lock: PropertyLock;
    passcodes: LockPasscode[];
    matchesHostfully: boolean;
    accessRecords: AccessRecord[];
  }>;
  hasMismatch: boolean;
  diagnosisSummary: string;
}
