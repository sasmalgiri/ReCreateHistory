//
// index.ts — Electron main entry. Boots AppState (Storage → Brain), opens the
// window, wires IPC. contextIsolation stays ON; the renderer reaches the
// backend only through the preload `window.km` bridge.
//

import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { AppState } from './app/appState'
import { registerIpc } from './ipc/handlers'
import { log } from './core/logger'

let mainWindow: BrowserWindow | null = null
const appState = new AppState()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 640,
    show: false,
    backgroundColor: '#0f1219',
    title: 'ReCreateHistory',
    icon: join(__dirname, '../../resources/icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  await appState.boot(process.env.KM_DB || undefined)

  // End-to-end smoke test (KM_SMOKE=1): ingest a fixture, run a real Ask,
  // log the result, and exit — no window. Used for CI/verification.
  if (process.env.KM_SMOKE === '1') {
    const { runSmokeTest } = await import('./app/smokeTest')
    await runSmokeTest(appState)
    return
  }

  registerIpc(appState, () => mainWindow)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  try {
    appState.repos?.close()
  } catch (err) {
    log.app.warn(`close ledger failed: ${String(err)}`)
  }
  if (process.platform !== 'darwin') app.quit()
})
