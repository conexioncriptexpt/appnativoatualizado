using System;
using System.Threading;
using System.Windows.Forms;
using System.Drawing;

namespace CryptoConex.PC
{
    /// <summary>
    /// Agente Windows do Crypto Conex.
    ///  - Reside na System Tray (NotifyIcon) para facilitar a gestão do processo.
    ///  - Conecta via Socket.io ao backend com reconexão automática (Exponential Backoff).
    ///  - Captura a tela (Desktop Duplication API) e injeta mouse/teclado via user32.dll.
    /// </summary>
    static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new TrayAppContext());
        }
    }

    public class TrayAppContext : ApplicationContext
    {
        private readonly NotifyIcon _tray;
        private readonly SignalingClient _client;
        private readonly ScreenCapture _capture;
        private readonly WebRtcStreamer _rtc = new WebRtcStreamer();
        private DateTime _lastJpeg = DateTime.MinValue;

        public TrayAppContext()
        {
            _client = new SignalingClient("https://crypto-conex.emergent.host");
            _capture = new ScreenCapture();

            var menu = new ContextMenuStrip();
            menu.Items.Add("Conectar ao suporte", null, (s, e) => Connect());
            menu.Items.Add("Encerrar sessão", null, (s, e) => _client.Disconnect());
            menu.Items.Add("Sair", null, (s, e) => Exit());

            _tray = new NotifyIcon
            {
                Icon = SystemIcons.Application,
                Text = "Crypto Conex — Suporte Assistido",
                Visible = true,
                ContextMenuStrip = menu
            };
            _tray.DoubleClick += (s, e) => Connect();

            // Comandos recebidos do técnico -> injeção de mouse/teclado
            _client.OnCommand += cmd => InputSimulator.Execute(cmd);

            // WebRTC: cada técnico que entra recebe uma nova oferta (VP8 via TURN)
            _client.OnOperatorJoined += async () =>
            {
                try { _client.SendOffer(await _rtc.CreateOffer(_client.IceServers)); }
                catch (Exception) { /* sem WebRTC: o modo JPEG continua ativo */ }
            };
            _client.OnAnswer += sdp => _rtc.SetAnswer(sdp);
            _client.OnRemoteIce += (c, mid, idx) => _rtc.AddRemoteIce(c, mid, idx);
            _rtc.OnLocalIce += c => _client.SendIce(c);

            // Frames: WebRTC quando ligado; caso contrário, JPEG por Socket.io (~8 fps)
            _capture.OnFrame += (bgra, w, h) =>
            {
                if (_rtc.IsConnected) { _rtc.PushFrame(bgra, w, h); return; }
                if ((DateTime.UtcNow - _lastJpeg).TotalMilliseconds < 120) return;
                _lastJpeg = DateTime.UtcNow;
                _client.SendScreenPacket(FrameEncoder.EncodeJpeg(bgra, w, h));
            };
        }

        private void Connect()
        {
            _client.Connect();
            _capture.Start();
            _tray.ShowBalloonTip(2000, "Crypto Conex", "Conectado. Um técnico irá ajudá-lo.", ToolTipIcon.Info);
        }

        private void Exit()
        {
            _capture.Stop();
            _rtc.Close();
            _client.Disconnect();
            _tray.Visible = false;
            Application.Exit();
        }
    }
}
