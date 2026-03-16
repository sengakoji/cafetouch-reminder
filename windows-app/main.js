const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage } = require('electron');
const path = require('path');

// パッケージ版（ビルド後）の場合、.exeと同じフォルダ内の「UserData」フォルダに設定等を保存する
if (app.isPackaged) {
  app.setPath('userData', path.join(path.dirname(app.getPath('exe')), 'UserData'));
}

let mainWindow = null;
let tray = null;
let isQuitting = false;
let shouldCloseToTray = false; // デフォルトはオフ

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 680,
    height: 920,
    minWidth: 400,
    minHeight: 600,
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

let activeNotification = null;

// 通知の表示
ipcMain.on('show-notification', (event, { title, body, silent, requireInteraction, preventFocus }) => {
  // すでに通知が表示されている場合は閉じる（累積防止）
  if (activeNotification) {
    activeNotification.close();
  }

  const options = {
    title: title,
    body: body,
    silent: silent || false,
    icon: path.join(__dirname, 'favicon.png'),
  };

  // Windows等で通知を消さずに残す設定
  if (requireInteraction) {
    options.timeoutType = 'never';
  }

  activeNotification = new Notification(options);

  activeNotification.on('click', () => {
    event.reply('notification-clicked');
    if (mainWindow && !preventFocus) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // 通知が閉じられたときに参照をクリア
  activeNotification.on('close', () => {
    activeNotification = null;
  });

  activeNotification.show();
});

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
