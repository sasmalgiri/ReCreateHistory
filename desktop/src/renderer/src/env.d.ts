/// <reference types="vite/client" />

import type { KalsmritikoshApi } from '../../shared/ipc'

declare global {
  interface Window {
    km: KalsmritikoshApi
  }
}

export {}
