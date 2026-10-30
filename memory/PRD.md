# Crypto Conex — PRD

## Problema
Ecossistema de assistência digital inclusiva ("Suporte Assistido") para usuários com baixa
alfabetização tecnológica e deficiência motora. Um técnico guia o usuário final vendo a tela
dele e executando ações em seu nome. Componentes: Agentes (Android/Windows) + Painel CRM Web
+ página pública de conexão no navegador.

## Personas
- **Usuário final**: idoso / baixa literacia / deficiência motora. Só precisa tocar "Conectar".
- **Técnico**: atende sessões atribuídas a ele.
- **Super Admin**: vê fila global, atribui sessões, cria técnicos.

## Arquitetura
- Backend: FastAPI + python-socketio (Socket.io, path `/api/socketio`) + MongoDB. ASGI `app`.
- Frontend: React (`/` página pública, `/login`, `/crm`). WebRTC com TURN Metered.
- Roteamento por Rooms: `operators` e `session:{id}` (Admin → Técnico → Dispositivo).
- Nativo (código-fonte p/ GitHub): `native/android` (Kotlin, MediaProjection+MediaCodec+
  AccessibilityService), `native/windows` (C# Desktop Duplication + user32.dll + System Tray),
  `native/server-node` (servidor Node.js de referência compatível).

## Implementado (2026-10-29)
- Auth JWT (login/me/register) com bcrypt; seed de Super Admin.
- Página pública acessível: botão único CONECTAR → compartilhamento de tela real (getDisplayMedia)
  → WebRTC; controles de fonte (escala no root), voz, código de sessão, botões de download.
- CRM: fila global em tempo real, atribuir sessão (admin) / atribuir a mim (técnico),
  visualizador WebRTC ao vivo, console de comandos (click/longpress/swipe/back/home/digitar/
  mensagem guiada + coordenadas X,Y), leitor de árvore de acessibilidade, logs por sessão, stats.
- Sinalização WebRTC bidirecional + relay de comandos + autorização por sessão (admin/técnico
  atribuído). Reconexão com Exponential Backoff (socket.io).
- Testado: backend 19/19 pytest (inclui E2E socket.io); fluxos de UI do CRM; WebRTC ao vivo
  confirmado com captura simulada (vídeo recebido no CRM, mensagem guiada no usuário, disconnect).

## Backlog / Próximos
- P1: WebRTC com um PeerConnection por operador (suporte a múltiplos espectadores simultâneos).
- P1: Reverter status da sessão para "assigned/waiting" quando o operador sai sem stream ativo.
- P2: Brute-force lockout no login; origens CORS explícitas em produção.
- P2: Gravação de sessão, histórico persistente navegável, notas do técnico.
- P2: Build e publicação dos instaladores nativos (APK / EXE) + botões de download apontando a eles.

## Correções (2026-10-29 · CI + streaming nativo)
- Android Actions: removido pacote obsoleto `tools`; instala platform-tools/android-34/build-tools;34.0.0.
- Windows: `SocketIO` totalmente qualificado (`SocketIOClient.SocketIO`) — corrige CS0118.
- HIGH: `max_http_buffer_size=16MB` (frames >1MB já não desligam o dispositivo); frames Windows com escala ≤1280px, q45, ~12fps.
- Segurança socket: só o dispositivo dono envia screen:packet/a11y:tree; guards para data nulo; marcação "active" sem escrita por frame.
- Verificado: testing_agent 37/37; teste direto frame 1,6MB OK + bloqueio de estranhos OK.

## Iteração 3 (2026-10-29 · Equipa + Instruções + WebRTC nativo)
- Gestão de Equipa `/crm/equipa` (só Administrador): criar conta (Técnico/Administrador), mudar tipo,
  redefinir palavra-passe, remover. Proteções: não se remove/despromove a si; tem de existir ≥1 admin.
  Remover → sessões voltam à fila + sockets desligados; mudar tipo → sockets desligados (permissões atualizadas).
  API: `GET /api/users`, `PUT /api/users/{id}`, `DELETE /api/users/{id}`.
- Página `/instrucoes` (Android/Windows, passos numerados com voz). Botão "Instalar" da página pública leva para lá.
  Links de download via `REACT_APP_DOWNLOAD_ANDROID_URL` / `REACT_APP_DOWNLOAD_WINDOWS_URL` (ainda por definir).
- WebRTC nativo: Android (`io.getstream:stream-webrtc-android:1.3.10`, ScreenCapturerAndroid, H.264/VP8 HW) e
  Windows (SIPSorcery 8.0.23 + VP8 libvpx) enviam oferta ao receber `operator:joined`; fallback JPEG por Socket.io
  enquanto o WebRTC não liga. Windows compilado localmente com sucesso; Kotlin do Android compilado com kotlinc.
- Workflows publicam em GitHub Releases (`android-latest` / `windows-latest`) para links estáveis.
- Startup: sessões abertas de execuções anteriores são marcadas "ended". Testado: iteration_3 (36/36 backend, UI 100%).

## Backlog
- P1: Definir URLs de download (após "Save to GitHub" → Releases) nas variáveis de ambiente.
- P1: URL do backend nas apps nativas aponta para o preview; mudar para o domínio de produção após deploy.
- P2: Um PeerConnection por operador (vários técnicos em simultâneo), invalidar JWT ao mudar palavra-passe,
  gravação de sessão, notas do técnico.

## Iteração 4 (2026-10-30 · Downloads reais)
- Página pública simplificada: só 2 botões — CONECTAR e INSTALAR APP (removidos controlos de fonte/voz do topo).
- INSTALAR APP descarrega diretamente da GitHub Release (repo conexioncriptexpt/appnativoatualizado):
  Android → android-latest/CryptoConex.apk · Windows → windows-latest/CryptoConexPC.exe; depois abre /instrucoes?os=…
  Outros sistemas → /instrucoes para escolher. URLs em REACT_APP_DOWNLOAD_ANDROID_URL / _WINDOWS_URL.
- EXE Windows com compressão single-file (ficará mais pequeno no próximo build).

## Iteração 5 (2026-10-30 · Bug Acessibilidade Android)
- Corrigido: CONECTAR pedia sempre para ativar a Acessibilidade mesmo já ativa. Causa: comparação de texto com o nome
  curto ".service.X", mas o Android guarda o nome completo do pacote. Agora compara via ComponentName (+ instância ativa).
- Pendente (perguntado ao utilizador, sem resposta): app Windows com janela de botão único + auto-instalação de atalhos;
  guia de permissões Android com voz.
