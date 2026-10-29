# Crypto Conex — Aplicações Nativas (Android & Windows)

Aplicações que o **cliente final instala** no seu dispositivo. Abrem com **um único botão
"Conectar"** e ligam-se ao painel do técnico. O ecrã é transmitido ao técnico e os comandos
(cliques, gestos, texto) são executados no dispositivo.

Os instaladores são gerados **automaticamente** pelo GitHub Actions ao fazer push do repositório.

## 📱 Android (`native/android`)
- Botão único "Conectar", Foreground Service com WakeLock + WifiLock, AccessibilityService
  (leitura de nós + gestos), captura de ecrã via MediaProjection (frames JPEG).
- **Instalar:** descarregue o artefacto `CryptoConex-Android-APK` do separador *Actions* do GitHub
  e instale o `.apk` no telemóvel (ative "fontes desconhecidas"). Na 1.ª vez, conceda as
  permissões de **Acessibilidade** e **Sobreposição**.

### Build local
```bash
cd native/android
gradle assembleDebug          # ou ./gradlew assembleDebug se gerar o wrapper
# APK em app/build/outputs/apk/debug/
```

## 🖥️ Windows (`native/windows`)
- Reside na **System Tray**, liga via Socket.io, captura com **Desktop Duplication API**,
  injeta mouse/teclado via **user32.dll**.
- **Instalar:** descarregue o artefacto `CryptoConex-Windows-EXE` do separador *Actions* e
  execute `CryptoConexPC.exe` (ficheiro único, não precisa de instalação do .NET).

### Build local
```bash
cd native/windows
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o publish
# EXE em publish/CryptoConexPC.exe
```

## Configuração do servidor
O URL do backend está definido em:
- Android: `SocketManager.kt` → `BACKEND_URL`
- Windows: `Program.cs` → construtor de `SignalingClient`

Atualize-o para o seu URL de produção após a publicação.

## Como gerar os instaladores no GitHub
1. Faça push deste repositório para o GitHub (botão **Save to Github**).
2. Abra o separador **Actions** — os workflows "Build Android APK" e "Build Windows EXE"
   correm automaticamente.
3. Descarregue os **Artifacts** gerados (APK e EXE) e distribua aos clientes.
