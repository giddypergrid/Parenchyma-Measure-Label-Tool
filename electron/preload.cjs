const { contextBridge, ipcRenderer } = require('electron');

// The only surface the React app sees. Keeps the renderer sandboxed.
contextBridge.exposeInMainWorld('api', {
  listProjects: () => ipcRenderer.invoke('list-projects'),
  forgetProject: (dir) => ipcRenderer.invoke('forget-project', dir),
  createProject: (name) => ipcRenderer.invoke('create-project', name),
  openProject: (dir) => ipcRenderer.invoke('open-project', dir),
  saveProject: (opts) => ipcRenderer.invoke('save-project', opts),
  pickVideos: () => ipcRenderer.invoke('pick-videos'),
  importVideo: (opts) => ipcRenderer.invoke('import-video', opts),
  listFrames: (dirPath) => ipcRenderer.invoke('list-frames', dirPath),
  writeFile: (opts) => ipcRenderer.invoke('write-file', opts),
  readImage: (filePath) => ipcRenderer.invoke('read-image', filePath),
});
