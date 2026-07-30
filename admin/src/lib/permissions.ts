import type { AdminSession, Permission } from '../types/admin'

function matches(granted: string, required: string): boolean {
  if (granted === '*' || granted === required) return true
  return granted.endsWith('.*') && required.startsWith(granted.slice(0, -1))
}

export function can(session: AdminSession | null, permission: Permission): boolean {
  if (!session) return false
  return session.permissions.some((granted) => matches(granted, permission))
}

export function canAny(session: AdminSession | null, permissions: Permission[]): boolean {
  return permissions.some((permission) => can(session, permission))
}

export function ownerCan(session: AdminSession | null, permission: Permission): boolean {
  return Boolean(session?.isOwner && can(session, permission))
}
