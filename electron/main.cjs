const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const isDev = !app.isPackaged;
const recentsFile = () => path.join(app.getPath('userData'), 'recents.json');

// ffmpeg ships as a binary; when packaged it lives outside the asar archive
function ffmpegPath() {
  const p = require('ffmpeg-static');
  return app.isPackaged ? p.replace('app.asar', 'app.asar.unpacked') : p;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Parenchyma Measure',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#b9bcbf',
    // hide the white OS title bar; Windows draws the caption buttons onto our dark bar
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#14171b', symbolColor: '#e7e9eb', height: 36 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  if (isDev) win.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ---------- recent projects (kept outside any project folder) ---------- */

const recents = () => readJson(recentsFile(), []);

function rememberProject(dir, name) {
  const list = recents().filter((r) => r.dir !== dir);
  list.unshift({ dir, name, lastOpened: new Date().toISOString() });
  writeJson(recentsFile(), list.slice(0, 12));
}

ipcMain.handle('list-projects', async () =>
  recents().filter((r) => fs.existsSync(path.join(r.dir, 'project.json')))
);

ipcMain.handle('forget-project', async (_e, dir) => {
  writeJson(recentsFile(), recents().filter((r) => r.dir !== dir));
  return true;
});

// the name becomes a folder, so strip characters Windows rejects
const safeName = (n) =>
  (String(n).replace(/[\\/:*?"<>|]/g, '-').replace(/[. ]+$/, '').trim() || 'unnamed').slice(0, 80);

ipcMain.handle('create-project', async (_e, name) => {
  const r = await dialog.showOpenDialog({
    title: 'Where should the project folder go?',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled) return null;
  const dir = path.join(r.filePaths[0], safeName(name));
  if (fs.existsSync(path.join(dir, 'project.json')))
    return { error: 'A project already exists in that folder.' };
  fs.mkdirSync(dir, { recursive: true });
  const project = {
    name,
    createdAt: new Date().toISOString(),
    scalePpc: 131.5,
    timepoints: [],
    captures: [],
  };
  writeJson(path.join(dir, 'project.json'), project);
  rememberProject(dir, name);
  return { dir, project };
});

ipcMain.handle('open-project', async (_e, dir) => {
  let target = dir;
  if (!target) {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (r.canceled) return null;
    target = r.filePaths[0];
  }
  const file = path.join(target, 'project.json');
  if (!fs.existsSync(file)) return { error: 'That folder is not a project (no project.json).' };
  const project = readJson(file, null);
  if (!project) return { error: 'project.json could not be read.' };

  // Heal projects saved with absolute paths (or moved from another machine):
  // anything inside the project folder becomes relative so it stays portable.
  const toRel = (p) => {
    if (!p || !path.isAbsolute(p)) return p;
    const r = path.relative(target, p);
    return r.startsWith('..') ? p : r;
  };
  let changed = false;
  project.captures = (project.captures || []).map((c) => {
    const next = {
      ...c,
      framesDir: toRel(c.framesDir),
      videoPath: toRel(c.videoPath),
      framePath: toRel(c.framePath),
    };
    if (next.framesDir !== c.framesDir || next.videoPath !== c.videoPath ||
        next.framePath !== c.framePath) changed = true;
    return next;
  });
  if (changed) writeJson(file, project);

  rememberProject(target, project.name);
  return { dir: target, project };
});

ipcMain.handle('save-project', async (_e, { dir, project }) => {
  writeJson(path.join(dir, 'project.json'), project);
  return true;
});

/* ---------- video / stills ---------- */

ipcMain.handle('pick-videos', async () => {
  const r = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Video', extensions: ['avi', 'mp4', 'mov', 'mkv', 'wmv', 'm4v'] }],
  });
  return r.canceled ? [] : r.filePaths;
});

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), args);
    let err = '';
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-600)))));
  });
}

const isStill = (f) => /\.(png|jpe?g)$/i.test(f);

// Copy the clip into its own folder, then split THAT copy into stills.
// Keeps every set of stills next to the video it came from.
ipcMain.handle('import-video', async (_e, { videoPath, outDir, fps = 5 }) => {
  fs.mkdirSync(outDir, { recursive: true });
  const dest = path.join(outDir, path.basename(videoPath));
  if (path.resolve(dest) !== path.resolve(videoPath)) fs.copyFileSync(videoPath, dest);
  for (const f of fs.readdirSync(outDir)) {
    if (isStill(f)) fs.unlinkSync(path.join(outDir, f));
  }
  await runFfmpeg(['-y', '-i', dest, '-vf', `fps=${fps}`, path.join(outDir, 'frame_%04d.png')]);
  const frames = fs.readdirSync(outDir).filter(isStill).sort().map((f) => path.join(outDir, f));
  return { videoPath: dest, frames };
});

ipcMain.handle('write-file', async (_e, { filePath, contents }) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf8');
  return filePath;
});

// Stills already extracted for a clip
ipcMain.handle('list-frames', async (_e, dirPath) => {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .sort()
    .map((f) => path.join(dirPath, f));
});

// Renderer can't read file:// directly, so hand it a data URI
ipcMain.handle('read-image', async (_e, filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,` + fs.readFileSync(filePath).toString('base64');
});
