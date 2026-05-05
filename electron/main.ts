import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The built directory structure
//
// dist/
//   index.html
// dist-electron/
//   main.js
//   preload.js
//
process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public')

let win: BrowserWindow | null

// Use ['ENV_NAME'] to avoid vite:define plugin replacement.
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function isTrustedAppUrl(url: string) {
    try {
        const parsed = new URL(url)
        if (VITE_DEV_SERVER_URL) {
            const devUrl = new URL(VITE_DEV_SERVER_URL)
            return parsed.origin === devUrl.origin && parsed.pathname.startsWith(devUrl.pathname)
        }
        if (parsed.protocol !== 'file:') return false

        const appFile = path.normalize(fileURLToPath(parsed)).toLowerCase()
        const appRoot = path.normalize(process.env.DIST as string).toLowerCase()
        return appFile === appRoot || appFile.startsWith(`${appRoot}${path.sep}`)
    } catch {
        return false
    }
}

function openExternalUrl(url: string) {
    try {
        const parsed = new URL(url)
        if (parsed.protocol === 'https:') {
            shell.openExternal(url)
        }
    } catch {
        // Ignore malformed URLs from untrusted renderer content.
    }
}

function createWindow() {
    win = new BrowserWindow({
        icon: path.join(process.env.VITE_PUBLIC as string, 'electron-vite.svg'),
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#020617', // slate-950
            symbolColor: '#cbd5e1', // slate-300
            height: 35
        },
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    })

    win.webContents.setWindowOpenHandler(({ url }) => {
        openExternalUrl(url)
        return { action: 'deny' }
    })

    win.webContents.on('will-navigate', (event, url) => {
        if (!isTrustedAppUrl(url)) {
            event.preventDefault()
            openExternalUrl(url)
        }
    })

    if (VITE_DEV_SERVER_URL) {
        win.loadURL(VITE_DEV_SERVER_URL)
    } else {
        // win.loadFile('dist/index.html')
        win.loadFile(path.join(process.env.DIST as string, 'index.html'))
    }
}

app.on('web-contents-created', (_event, contents) => {
    contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
        callback(false)
    })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
        win = null
    }
})

app.on('activate', () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

app.whenReady().then(createWindow)
