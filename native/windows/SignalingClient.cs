using System;
using System.Collections.Generic;
using System.Text.Json;
using SocketIOClient;

namespace CryptoConex.PC
{
    /// <summary>
    /// Cliente de sinalização Socket.io para o backend Crypto Conex.
    /// Reconexão automática com Exponential Backoff. Transporta a sinalização WebRTC.
    /// </summary>
    public class SignalingClient
    {
        private readonly SocketIOClient.SocketIO _socket;
        public event Action<Command> OnCommand;
        public event Action OnOperatorJoined;
        public event Action<string> OnAnswer;
        public event Action<string, string, ushort> OnRemoteIce;
        private string _sessionId;
        public List<IceServerConfig> IceServers { get; } = new List<IceServerConfig>();

        public SignalingClient(string backendUrl)
        {
            _socket = new SocketIOClient.SocketIO(backendUrl, new SocketIOClient.SocketIOOptions
            {
                Path = "/api/socketio",
                Transport = SocketIOClient.Transport.TransportProtocol.WebSocket,
                Reconnection = true,
                ReconnectionAttempts = int.MaxValue,
                ReconnectionDelay = 1000,
                ReconnectionDelayMax = 15000
            });

            _socket.OnConnected += async (s, e) =>
            {
                await _socket.EmitAsync("device:register", new
                {
                    device_id = Environment.MachineName,
                    platform = "windows",
                    name = Environment.MachineName
                });
            };

            _socket.On("device:registered", res =>
            {
                var doc = res.GetValue<JsonElement>();
                _sessionId = doc.GetProperty("session_id").GetString();
                IceServers.Clear();
                if (doc.TryGetProperty("iceServers", out var servers))
                {
                    foreach (var s in servers.EnumerateArray())
                    {
                        IceServers.Add(new IceServerConfig(
                            s.GetProperty("urls").GetString(),
                            s.TryGetProperty("username", out var u) ? u.GetString() : null,
                            s.TryGetProperty("credential", out var c) ? c.GetString() : null));
                    }
                }
            });

            _socket.On("command:receive", res =>
            {
                var doc = res.GetValue<JsonElement>();
                var cmdJson = doc.GetProperty("command").GetRawText();
                var cmd = JsonSerializer.Deserialize<Command>(cmdJson,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (cmd != null) OnCommand?.Invoke(cmd);
            });

            _socket.On("operator:joined", res => OnOperatorJoined?.Invoke());

            _socket.On("rtc:answer", res =>
            {
                var doc = res.GetValue<JsonElement>();
                if (doc.TryGetProperty("sdp", out var sdp) && sdp.TryGetProperty("sdp", out var text))
                    OnAnswer?.Invoke(text.GetString());
            });

            _socket.On("rtc:ice", res =>
            {
                var doc = res.GetValue<JsonElement>();
                if (!doc.TryGetProperty("candidate", out var c) || c.ValueKind != JsonValueKind.Object) return;
                var cand = c.TryGetProperty("candidate", out var cs) ? cs.GetString() : null;
                var mid = c.TryGetProperty("sdpMid", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() : "0";
                ushort idx = c.TryGetProperty("sdpMLineIndex", out var i) && i.ValueKind == JsonValueKind.Number ? (ushort)i.GetInt32() : (ushort)0;
                OnRemoteIce?.Invoke(cand, mid, idx);
            });
        }

        public async void Connect() => await _socket.ConnectAsync();
        public async void Disconnect() => await _socket.DisconnectAsync();

        public async void SendOffer(string sdp)
        {
            if (_sessionId == null) return;
            await _socket.EmitAsync("rtc:offer", new { session_id = _sessionId, sdp = new { type = "offer", sdp } });
        }

        public async void SendIce(JsonElement candidate)
        {
            if (_sessionId == null) return;
            await _socket.EmitAsync("rtc:ice", new { session_id = _sessionId, candidate });
        }

        public async void SendScreenPacket(byte[] frame)
        {
            if (_sessionId == null) return;
            await _socket.EmitAsync("screen:packet", new
            {
                session_id = _sessionId,
                data = Convert.ToBase64String(frame)
            });
        }
    }
}
