"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("papotDesktop", {
  saveSetup: (input) => ipcRenderer.invoke("papot:desktop-setup:save", input),
});
