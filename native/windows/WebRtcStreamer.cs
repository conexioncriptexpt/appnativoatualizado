using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using SIPSorcery.Net;
using SIPSorceryMedia.Abstractions;
using SIPSorceryMedia.Encoders;

namespace CryptoConex.PC
{
    public record IceServerConfig(string Urls, string Username, string Credential);

    /// <summary>Envia o ecrã ao técnico por WebRTC (VP8) através dos servidores TURN/STUN.</summary>
    public class WebRtcStreamer
    {
        private readonly object _lock = new object();
        private RTCPeerConnection _pc;
        private VpxVideoEncoder _encoder;
        private DateTime _lastFrame = DateTime.MinValue;
        private readonly List<RTCIceCandidateInit> _pendingIce = new List<RTCIceCandidateInit>();
        private bool _remoteSet;

        public event Action<JsonElement> OnLocalIce;
        public bool IsConnected => _pc != null && _pc.connectionState == RTCPeerConnectionState.connected;

        public async Task<string> CreateOffer(IEnumerable<IceServerConfig> servers)
        {
            Close();
            var config = new RTCConfiguration
            {
                // SIPSorcery supports STUN + TURN over UDP; TLS/TCP relays are skipped.
                iceServers = servers
                    .Where(s => !s.Urls.StartsWith("turns:") && !s.Urls.Contains("transport=tcp"))
                    .Select(s => new RTCIceServer { urls = s.Urls, username = s.Username, credential = s.Credential })
                    .ToList()
            };
            var pc = new RTCPeerConnection(config);
            var encoder = new VpxVideoEncoder();
            var track = new MediaStreamTrack(encoder.SupportedFormats, MediaStreamStatusEnum.SendOnly);
            pc.addTrack(track);

            pc.onicecandidate += c =>
            {
                if (c == null) return;
                using var doc = JsonDocument.Parse(c.toJSON());
                OnLocalIce?.Invoke(doc.RootElement.Clone());
            };
            pc.onconnectionstatechange += state =>
            {
                if (state == RTCPeerConnectionState.connected) lock (_lock) _encoder?.ForceKeyFrame();
            };

            lock (_lock)
            {
                _pc = pc;
                _encoder = encoder;
                _remoteSet = false;
                _pendingIce.Clear();
            }

            var offer = pc.createOffer(null);
            await pc.setLocalDescription(offer);
            return offer.sdp;
        }

        public void SetAnswer(string sdp)
        {
            lock (_lock)
            {
                if (_pc == null) return;
                _pc.setRemoteDescription(new RTCSessionDescriptionInit { type = RTCSdpType.answer, sdp = sdp });
                _remoteSet = true;
                foreach (var c in _pendingIce) _pc.addIceCandidate(c);
                _pendingIce.Clear();
            }
        }

        public void AddRemoteIce(string candidate, string sdpMid, ushort sdpMLineIndex)
        {
            if (string.IsNullOrWhiteSpace(candidate)) return;
            var init = new RTCIceCandidateInit { candidate = candidate, sdpMid = sdpMid, sdpMLineIndex = sdpMLineIndex };
            lock (_lock)
            {
                if (_pc == null) return;
                if (_remoteSet) _pc.addIceCandidate(init);
                else _pendingIce.Add(init);
            }
        }

        /// <summary>Recebe um frame BGRA (sem padding) e envia-o codificado em VP8.</summary>
        public void PushFrame(byte[] bgra, int width, int height)
        {
            lock (_lock)
            {
                if (!IsConnected || _encoder == null) return;
                var now = DateTime.UtcNow;
                double elapsedMs = _lastFrame == DateTime.MinValue ? 66 : (now - _lastFrame).TotalMilliseconds;
                _lastFrame = now;
                byte[] encoded = _encoder.EncodeVideo(width, height, bgra, VideoPixelFormatsEnum.Bgra, VideoCodecsEnum.VP8);
                if (encoded == null || encoded.Length == 0) return;
                uint duration = (uint)Math.Max(1, Math.Min(90000, elapsedMs * 90));
                _pc.SendVideo(duration, encoded);
            }
        }

        public void Close()
        {
            lock (_lock)
            {
                try { _pc?.close(); } catch { }
                _encoder?.Dispose();
                _pc = null;
                _encoder = null;
                _lastFrame = DateTime.MinValue;
            }
        }
    }
}
