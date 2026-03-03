import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

window.Capacitor = Capacitor;
window.Capacitor.Plugins = window.Capacitor.Plugins || {};
window.Capacitor.Plugins.LocalNotifications = LocalNotifications;
