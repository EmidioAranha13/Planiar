import type { MemberRole } from '../entities/types';

export function canEditSchedules(role: MemberRole | null): boolean {
  return role === 'owner' || role === 'editor';
}

export function canManageRoutine(role: MemberRole | null): boolean {
  return role === 'owner';
}
