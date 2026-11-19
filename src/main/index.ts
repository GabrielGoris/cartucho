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

// Para desenvolvimento/testes: perfil separado (CARTUCHO_USER_DATA) sem mexer no seu.
if (process.env.CARTUCHO_USER_DATA) app.setPath('userData', process.env.CARTUCHO_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();

/**
 * Em produção a tela é servida por app://cartucho/ em vez de file://.
 * Com file:// o fetch do navegador não funciona, e o carregador dos modelos 3D usa fetch.
 */
const APP_ORIGIN = 'app://cartucho';
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const DEV_URL = process.env.ELECTRON_RENDERER_URL;
const isOurPage = (url: string) => (DEV_URL ? url.startsWith(DEV_URL) : url.startsWith(`${APP_ORIGIN}/`));

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 640,
    backgroundColor: '#07020f', show: false, autoHideMenuBar: true, title: 'Cartucho',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true },
  });
  win.once('ready-to-show', () => win?.show());
  // Links externos (GitHub, Recompendium) abrem no navegador, nunca dentro do app.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!isOurPage(url)) e.preventDefault(); });
  // F11 = tela cheia (o Cartucho foi pensado para ficar na TV também)
  win.webContents.on('before-input-event', (_e, input) => { if (input.type === 'keyDown' && input.key === 'F11') win?.setFullScreen(!win.isFullScreen()); });

  void win.loadURL(DEV_URL ?? `${APP_ORIGIN}/index.html`);
  return win;
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

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
  // Quando o jogo fecha, o Cartucho volta para a frente.
  const player = new Player(db, ach, p => shell.openPath(p), () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); } });
  ach.isRunning = player.isRunning;
  // net.fetch usa a rede do Chromium (proxy e certificados do sistema), melhor que o fetch do Node para downloads grandes.
  const gh = createGitHub({ fetch: ((url, init) => net.fetch(url, init as RequestInit)) as Fetch, ...(process.env.CARTUCHO_GITHUB_API ? { api: process.env.CARTUCHO_GITHUB_API } : {}) });
  const defaultPortsDir = join(app.getPath('home'), 'Games', 'Cartucho');
  const ports = new Ports(db, ach, gh, () => portsDirOf({ db, defaultPortsDir }), player.isRunning);
  createIPCHandler({
    router: createRouter({ db, ach, ports, player, defaultPortsDir }),
    preload: false,
    // Só a nossa própria página fala com o processo principal.
    allow: e => isOurPage(e.senderFrame?.url ?? ''),
  });
  createWindow();
  void ach.start();
  // Catálogo em segundo plano; se estiver offline, a tela usa a última cópia.
  refreshCatalog(db).catch(e => console.warn('[catálogo]', e instanceof Error ? e.message : e));

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on('before-quit', () => { player.stop(); ach.stop(); db.close(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
