const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('browser',{
  command:(cmd,payload)=>ipcRenderer.invoke('command',cmd,payload),
  onState:cb=>ipcRenderer.on('state',(_e,state)=>cb(state)),
  onFocusAddress:cb=>ipcRenderer.on('focus-address',()=>cb()),
  onOpenPanel:cb=>ipcRenderer.on('open-panel',(_e,name)=>cb(name))
});
