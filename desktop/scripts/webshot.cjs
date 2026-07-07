// Captures screenshots of the running web app: login page, persona home,
// a persona workspace, and the guide — what the Vercel deployment shows.
const { app, BrowserWindow, session } = require('electron')
const fs = require('node:fs')

const BASE = process.env.SHOT_BASE || 'http://localhost:8795'
const OUT = process.env.SHOT_OUT || '.'

async function shoot(win, file) {
  await new Promise((r) => setTimeout(r, 1600))
  const img = await win.webContents.capturePage()
  fs.writeFileSync(`${OUT}/${file}`, img.toPNG())
  console.log('SHOT', file)
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1360, height: 850, show: false })

  // 1. Login page (logged out)
  await win.loadURL(BASE)
  await shoot(win, 'shot-login.png')

  // 2. Sign up via API, install the session cookie, reload → persona home
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `demo_${Date.now()}@example.com`, password: 'password123', displayName: 'Demo' })
  })
  const setCookie = res.headers.getSetCookie?.()[0] || ''
  const token = setCookie.split(';')[0].split('=')[1]
  await session.defaultSession.cookies.set({ url: BASE, name: 'km_session', value: token, httpOnly: true })
  // Dismiss first-run onboarding so the shots show the screens themselves.
  await fetch(`${BASE}/api/invoke`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `km_session=${token}` },
    body: JSON.stringify({ path: 'app.markOnboardingShown', args: [] }) })
  await win.loadURL(BASE)
  await shoot(win, 'shot-home.png')

  // 3. Open the "For Lawyers" workspace (first persona card)
  await win.webContents.executeJavaScript(`document.querySelectorAll('button.group')[0]?.click()`)
  await shoot(win, 'shot-workspace.png')

  // 4. The Guide book
  await win.loadURL(`${BASE}/#/guide`)
  await shoot(win, 'shot-guide.png')

  app.exit(0)
})
