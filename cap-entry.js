import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { StatusBar } from '@capacitor/status-bar';

window.Capacitor = Capacitor;
window.Capacitor.Plugins = window.Capacitor.Plugins || {};
window.Capacitor.Plugins.LocalNotifications = LocalNotifications;
window.Capacitor.Plugins.StatusBar = StatusBar;
