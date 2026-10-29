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

        public TrayAppContext()
        {
            _client = new SignalingClient("https://conex-assist--9u92ii2p.preview.emergentagent.com");
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
            // Ao solicitar frame, captura e envia
            _capture.OnFrame += packet => _client.SendScreenPacket(packet);
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
            _client.Disconnect();
            _tray.Visible = false;
            Application.Exit();
        }
    }
}
