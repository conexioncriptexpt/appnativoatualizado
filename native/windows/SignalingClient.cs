using System;
using System.Text.Json;
using SocketIOClient;

namespace CryptoConex.PC
{
    /// <summary>
    /// Cliente de sinalização Socket.io para o backend Crypto Conex.
    /// Reconexão automática com Exponential Backoff.
    /// </summary>
    public class SignalingClient
    {
        private readonly SocketIO _socket;
        public event Action<Command> OnCommand;
        private string _sessionId;

        public SignalingClient(string backendUrl)
        {
            _socket = new SocketIO(backendUrl, new SocketIOOptions
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
            });

            _socket.On("command:receive", res =>
            {
                var doc = res.GetValue<JsonElement>();
                var cmdJson = doc.GetProperty("command").GetRawText();
                var cmd = JsonSerializer.Deserialize<Command>(cmdJson,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (cmd != null) OnCommand?.Invoke(cmd);
            });
        }

        public async void Connect() => await _socket.ConnectAsync();
        public async void Disconnect() => await _socket.DisconnectAsync();

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
