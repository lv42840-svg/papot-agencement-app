"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("papotDesktop", {
  openBusinessFolder: (input) => ipcRenderer.invoke("papot:business-folder:open", input),
  openBusinessFile: (input) => ipcRenderer.invoke("papot:business-file:open", input),
  composeOutlookMail: (input) => ipcRenderer.invoke("papot:outlook:compose", input),
});
