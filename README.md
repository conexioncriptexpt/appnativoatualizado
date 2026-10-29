# Crypto Conex — Ecossistema de Assistência Digital Inclusiva

Suporte Assistido remoto para usuários com baixa alfabetização tecnológica e pessoas com
deficiência motora. Um técnico guia o usuário final visualizando a tela dele e executando
ações em seu nome.

## Componentes

| Componente | Pasta | Stack | Executa neste ambiente |
|---|---|---|---|
| **Backend / Sinalização** | `/app/backend` | FastAPI + python-socketio + MongoDB | ✅ Sim |
| **Painel CRM Web** | `/app/frontend` | React + WebRTC + Socket.io | ✅ Sim |
| **Página pública de conexão** | `/app/frontend` (`/`) | React + getDisplayMedia + WebRTC | ✅ Sim |
| **Agente Android** | `/app/native/android` | Kotlin (MediaProjection + AccessibilityService) | 📦 Código-fonte p/ GitHub |
| **Agente Windows** | `/app/native/windows` | C# .NET (Desktop Duplication + user32.dll) | 📦 Código-fonte p/ GitHub |
| **Servidor Node.js (referência)** | `/app/native/server-node` | Node.js + Socket.io | 📦 Referência alternativa |

> O backend em produção usa **FastAPI + python-socketio** (equivalente ao Node.js + Socket.io
> descrito no briefing) porque este ambiente é Python. O conceito de **Rooms** para roteamento
> dinâmico Admin → Técnico → Dispositivo está totalmente implementado. Uma implementação
> Node.js de referência 100% compatível também é fornecida em `native/server-node/`.

## Protocolo Socket.io (eventos)

Caminho do socket: `/api/socketio`

### Dispositivo (usuário final — Android / Windows / Web)
- `device:register` → `{ device_id, platform, name }` → recebe `device:registered { session_id, pin, iceServers }`
- `operator:joined` (recebido) → dispositivo cria e envia `rtc:offer`
- `rtc:offer` / `rtc:answer` / `rtc:ice` → sinalização WebRTC
- `a11y:tree` → `{ session_id, tree: [...] }` envia a hierarquia de acessibilidade
- `command:receive` (recebido) → `{ command }` executa clique/swipe/texto/voltar/início

### Operador (CRM)
Conecta com `auth: { token }` (JWT). Entra automaticamente na room `operators`.
- `queue:update` (recebido) → fila global de sessões
- `session:assign` → `{ session_id, technician_id }` (Admin atribui / Técnico pega p/ si)
- `operator:subscribe` → `{ session_id }` entra na room da sessão e solicita o stream
- `rtc:answer` / `rtc:ice` → sinalização
- `command:send` → `{ session_id, command }`
- `a11y:request` → solicita a árvore de acessibilidade

## ICE Servers (travessia de NAT)
STUN/TURN Metered configurados no backend (`/api/config/ice`).

## Credenciais iniciais
Ver `/app/memory/test_credentials.md`.
