"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("papotDesktop", {
  saveSetup: (input) => ipcRenderer.invoke("papot:desktop-setup:save", input),
  finishSetup: () => ipcRenderer.invoke("papot:desktop-setup:finish"),
  openBusinessFolder: (input) => ipcRenderer.invoke("papot:business-folder:open", input),
  openBusinessFile: (input) => ipcRenderer.invoke("papot:business-file:open", input),
});
