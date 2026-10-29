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
