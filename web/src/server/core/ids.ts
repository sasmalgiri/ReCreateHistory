import { randomUUID } from 'node:crypto'

export function newID(): string {
  return randomUUID()
}

export function nowMs(): number {
  return Date.now()
}
