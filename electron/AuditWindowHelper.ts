import { BrowserWindow, screen, app } from "electron";
import path from "node:path";
import type { WindowHelper } from "./WindowHelper";

const isDev = process.env.NODE_ENV === "development";

const startUrl = isDev
  ? "http://localhost:5180"
  : `file://${path.join(app.getAppPath(), "dist/index.html")}`;

export class AuditWindowHelper {
  private window: BrowserWindow | null = null;
  private windowHelper: WindowHelper | null = null;
  private contentProtection: boolean = false;

  public setWindowHelper(wh: WindowHelper): void {
    this.windowHelper = wh;
  }

  public getWindow(): BrowserWindow | null {
    return this.window;
  }

  public showWindow(meetingId?: string): void {
    const bounds = this.getTargetBounds();
    const meetingParam = meetingId ? `&meetingId=${encodeURIComponent(meetingId)}` : '';
    const url = `${startUrl}?window=audit${meetingParam}`;

    if (!this.window || this.window.isDestroyed()) {
      this.createWindow(bounds, url);
      return;
    }

    this.window.setBounds(bounds);
    this.window.setContentProtection(this.contentProtection);
    this.window.loadURL(url).catch((e) => {
      console.error("[AuditWindowHelper] Failed to load URL:", e);
    });
    this.window.show();
    this.window.focus();
  }

  public closeWindow(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
    }
  }

  private createWindow(bounds: Electron.Rectangle, url: string): void {
    const isMac = process.platform === "darwin";

    const windowSettings: Electron.BrowserWindowConstructorOptions = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      minWidth: 600,
      minHeight: 400,
      resizable: true,
      movable: true,
      fullscreenable: true,
      show: false,
      backgroundColor: isMac ? "#00000000" : "#000000",
      transparent: isMac,
      hasShadow: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "preload.js"),
        scrollBounce: true,
        webSecurity: !isDev,
      },
      ...(isMac
        ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 14, y: 14 } }
        : { frame: true, autoHideMenuBar: true }),
      ...(isMac ? { vibrancy: "under-window" as const, visualEffectState: "followWindow" as const } : {}),
    };

    this.window = new BrowserWindow(windowSettings);
    this.window.setContentProtection(this.contentProtection);

    this.window.loadURL(url).catch((e) => {
      console.error("[AuditWindowHelper] Failed to load URL:", e);
    });

    this.window.once("ready-to-show", () => {
      this.window?.show();
    });
  }

  private getTargetBounds(): Electron.Rectangle {
    const launcher = this.windowHelper?.getLauncherWindow();
    if (launcher && !launcher.isDestroyed()) {
      return launcher.getBounds();
    }

    const display = screen.getPrimaryDisplay();
    const workArea = display.workArea;
    const width = Math.min(1200, workArea.width);
    const height = Math.min(800, workArea.height);
    const x = Math.round(workArea.x + (workArea.width - width) / 2);
    const y = Math.round(workArea.y + (workArea.height - height) / 2);

    return { x, y, width, height };
  }

  public setContentProtection(enable: boolean): void {
    this.contentProtection = enable;
    if (this.window && !this.window.isDestroyed()) {
      this.window.setContentProtection(enable);
    }
  }
}
