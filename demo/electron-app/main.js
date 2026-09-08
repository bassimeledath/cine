// Minimal Electron host for the cine Electron-capture demo.
// Remote debugging is what lets cine attach; a real app would gate this behind
// an env var the way kino gates KINO_BENCHMARK.
const { app, BrowserWindow } = require('electron')
const path = require('path')

app.commandLine.appendSwitch('remote-debugging-port', process.env.CINE_CDP_PORT || '9223')
app.commandLine.appendSwitch('remote-allow-origins', '*')

app.whenReady().then(() => {
  // Demo capture uses CDP and does not need a foreground desktop window.
  if (process.env.CINE_SHOW_DEMO !== '1') app.dock?.hide()
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: process.env.CINE_SHOW_DEMO === '1',
    backgroundColor: '#0b1220',
    titleBarStyle: 'hiddenInset',
    webPreferences: { backgroundThrottling: false },
  })
  win.loadFile(path.join(__dirname, 'index.html'))
})

app.on('window-all-closed', () => app.quit())
