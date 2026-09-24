; NSIS 安装器钩子（经 tauri.conf.json bundle.windows.nsis.installerHooks 引入）。
; Tauri 注册文件关联时把 DefaultIcon 固定为主程序图标，这里在安装完成后
; 覆盖为随包分发的独立文件类型图标（icons/file-miz.ico、icons/file-mip.ico）。
; 注意：ProgID 必须与 tauri.conf.json 中 fileAssociations 的 name 保持一致。
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHELL_CONTEXT "Software\Classes\MimiBox.X.SchemePackage\DefaultIcon" "" "$INSTDIR\icons\file-miz.ico"
  WriteRegStr SHELL_CONTEXT "Software\Classes\MimiBox.X.PluginPackage\DefaultIcon" "" "$INSTDIR\icons\file-mip.ico"
!macroend
