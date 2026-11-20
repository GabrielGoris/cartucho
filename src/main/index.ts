import { join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, net, protocol, shell } from 'electron';
import { createIPCHandler } from 'electron-trpc/main';
import { openDb } from './db';
import { createRouter } from './router';
import { AchievementService } from './achievements/service';
import { refreshCatalog } from './catalog';
import { createGitHub, type Fetch } from './ports/github';
import { Ports } from './ports/installer';
import { Player } from './play';
import { portsDirOf } from './router';
import { Artwork } from './artwork/service';
import { Translator } from './translate';
import { WinCtl } from './window';
import { Background, playArg, startHidden } from './background';

if (process.env.CARTUCHO_USER_DATA) app.setPath('userData', process.env.CARTUCHO_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();

const APP_ORIGIN = 'app://cartucho';
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);
const DEV_URL = process.env.ELECTRON_RENDERER_URL;
const isOurPage = (url: string) => (DEV_URL ? url.startsWith(DEV_URL) : url.startsWith(`${APP_ORIGIN}/`));

let win: BrowserWindow | null = null;
let ctl: WinCtl | null = null;
let bg: Background | null = null;

function createWindow(show = true) {
  ctl ??= new WinCtl(app.getPath('userData'));
  win = new BrowserWindow({
    ...ctl.options(), minWidth: 1024, minHeight: 640,
    backgroundColor: '#07020f', show: false, autoHideMenuBar: true, title: 'Cartucho',
    icon: join(__dirname, '../renderer/icon.png'),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true },
  });
  ctl.attach(win, show);
  win.on('close', e => { if (bg?.shouldHideOnClose()) { e.preventDefault(); win?.hide(); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!isOurPage(url)) e.preventDefault(); });

  void win.loadURL(DEV_URL ?? `${APP_ORIGIN}/index.html`);
  return win;
}

app.on('second-instance', (_e, argv) => { void bg?.handleArgs(argv).then(played => { if (!played) bg?.show(); }); });

if (process.platform === 'win32') app.setAppUserModelId('app.cartucho');

void app.whenReady().then(async () => {
  const root = join(__dirname, '../renderer');
  protocol.handle('app', req => {
    const { pathname } = new URL(req.url);
    const file = normalize(join(root, decodeURIComponent(pathname)));
    if (!file.startsWith(root + sep)) return new Response('não encontrado', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  const db = openDb(join(app.getPath('userData'), 'cartucho.db'));
  const ach = new AchievementService(db, app.getPath('appData'));
  const player = new Player(db, ach, p => shell.openPath(p), () => { if (win && !win.isDestroyed() && win.isVisible()) { if (win.isMinimized()) win.restore(); win.focus(); } });
  ach.isRunning = player.isRunning;
  const gh = createGitHub({ fetch: ((url, init) => net.fetch(url, init as RequestInit)) as Fetch, ...(process.env.CARTUCHO_GITHUB_API ? { api: process.env.CARTUCHO_GITHUB_API } : {}) });
  const defaultPortsDir = join(app.getPath('home'), 'Games', 'Cartucho');
  const art = new Artwork(join(app.getPath('userData'), 'media'), ((url, init) => net.fetch(url, init as RequestInit)) as Fetch, {
    ...(process.env.CARTUCHO_LAUNCHBOX_METADATA ? { metadataUrl: process.env.CARTUCHO_LAUNCHBOX_METADATA } : {}),
    ...(process.env.CARTUCHO_LAUNCHBOX_IMAGES ? { imageUrl: process.env.CARTUCHO_LAUNCHBOX_IMAGES } : {}),
  });
  protocol.handle('media', req => {
    const u = new URL(req.url);
    const file = u.hostname === 'art' ? art.resolve(decodeURIComponent(u.pathname)) : null;
    if (!file) return new Response('não encontrado', { status: 404 });
    return net.fetch(pathToFileURL(file).toString()).then(r => {
      const h = new Headers(r.headers); h.set('Access-Control-Allow-Origin', '*');
      return new Response(r.body, { status: r.status, headers: h });
    });
  });
  const ports = new Ports(db, ach, gh, () => portsDirOf({ db, defaultPortsDir }), player.isRunning);
  createIPCHandler({
    router: createRouter({ db, ach, ports, player, art, win: () => ctl, bg: () => bg, tr: new Translator(db, ((url, init) => net.fetch(url, init as RequestInit)) as ConstructorParameters<typeof Translator>[1]), defaultPortsDir }),
    preload: false,
    allow: e => isOurPage(e.senderFrame?.url ?? ''),
  });
  bg = new Background(db, () => ctl, player, ach, join(__dirname, '../renderer/icon.png'));
  bg.apply();
  createWindow(!startHidden(process.argv) && !playArg(process.argv));
  void bg.handleArgs(process.argv);
  void ach.start();
  refreshCatalog(db).catch(e => console.warn('[catálogo]', e instanceof Error ? e.message : e));

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else bg?.show(); });
  app.on('before-quit', () => { player.stop(); ach.stop(); db.close(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
