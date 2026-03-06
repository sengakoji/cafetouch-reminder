const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    showNotification: (title, body, options = {}) => {
        ipcRenderer.send('show-notification', { title, body, ...options });
    },
    setTitle: (title) => {
        ipcRenderer.send('set-title', title);
    },
    setTitleBarOverlay: (color, symbolColor) => {
        ipcRenderer.send('set-title-bar-overlay', { color, symbolColor });
    },
    onNotificationClicked: (callback) => {
        ipcRenderer.on('notification-clicked', () => callback());
    },
    updateCloseBehavior: (closeToTray) => {
        ipcRenderer.send('update-close-behavior', closeToTray);
    },
    hideWindow: () => {
        ipcRenderer.send('hide-window');
    },
    onWindowReady: (callback) => {
        ipcRenderer.on('window-ready', () => callback());
    }
});
