Dim Shell
Set Shell = CreateObject("WScript.Shell")

' Ruta del proyecto (ajustar si se mueve)
Dim ProjectPath
ProjectPath = "c:\Users\gigio\Desktop\PASSOL_COSTEO_DEV"

' Iniciar la aplicacion de escritorio (oculto, sin ventana CMD)
Shell.Run "cmd /c cd /d """ & ProjectPath & """ && python desktop_app.py", 0, False

Set Shell = Nothing
