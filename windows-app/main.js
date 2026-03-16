const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// パッケージ版（ビルド後）の場合、.exeと同じフォルダ内の「UserData」フォルダに設定等を保存する
if (app.isPackaged) {
  app.setPath('userData', path.join(path.dirname(app.getPath('exe')), 'UserData'));
}

let mainWindow = null;
let tray = null;
let isQuitting = false;
let shouldCloseToTray = false; // デフォルトはオフ

const windowStatePath = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    if (fs.existsSync(windowStatePath)) {
      return JSON.parse(fs.readFileSync(windowStatePath, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load window state:', e);
  }
  return { width: 680, height: 920 };
}

function saveWindowState() {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  try {
    fs.writeFileSync(windowStatePath, JSON.stringify(bounds));
  } catch (e) {
    console.error('Failed to save window state:', e);
  }
}

function createWindow() {
  const state = loadWindowState();

  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 400,
    minHeight: 300, // 600 から 300 に短縮
    icon: path.join(__dirname, 'favicon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#06BBFA',
      symbolColor: '#ffffff',
      height: 32
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // レンダラーにメインウィンドウの準備ができたことを知らせ、初期設定（startMinimizedなど）を適用させる
    mainWindow.webContents.send('window-ready');
  });

  // ウィンドウが移動またはリサイズされたら保存
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);

  // × ボタンでの挙動制御
  mainWindow.on('close', (event) => {
    if (!isQuitting && shouldCloseToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // メニューバーを非表示
  mainWindow.setMenuBarVisibility(false);
}

function createTray() {
  // トレイアイコン用にPNGを使う
  let iconPath = path.join(__dirname, 'favicon.png');
  let trayIcon = nativeImage.createFromPath(iconPath);
  trayIcon = trayIcon.resize({ width: 16, height: 16 });

  tray = new Tray(trayIcon);
  tray.setToolTip('カフェタッチリマインダー');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '開く',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: '終了',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // 2つ目のインスタンスが起動されたら、メインウィンドウを一番手前に表示する
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    createTray();
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}

// === IPC Handlers ===

// 不要になった通知管理変数は削除

// 通知クリック時などにウィンドウを前面に出す処理
ipcMain.on('focus-window', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// レンダラーから直接 Web Notification API を使うようになったため、show-notification ハンドラは削除

// タイトルの更新
ipcMain.on('set-title', (event, title) => {
  if (mainWindow) {
    mainWindow.setTitle(title);
  }
});

// タイトルバーの色を更新
ipcMain.on('set-title-bar-overlay', (event, { color, symbolColor }) => {
  if (mainWindow) {
    mainWindow.setTitleBarOverlay({ color, symbolColor });
  }
});

ipcMain.on('update-close-behavior', (event, closeToTray) => {
  shouldCloseToTray = closeToTray;
});

ipcMain.on('hide-window', () => {
  if (mainWindow) {
    mainWindow.hide();
  }
});
