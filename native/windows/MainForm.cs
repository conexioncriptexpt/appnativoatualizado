using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Windows.Forms;

namespace CryptoConex.PC
{
    /// <summary>Janela principal: fundo escuro, logo e um único botão CONECTAR (verde-lima).</summary>
    public class MainForm : Form
    {
        public static readonly Color Bg = Color.FromArgb(11, 13, 16);
        public static readonly Color Lime = Color.FromArgb(127, 209, 19);
        public static readonly Color LimeHover = Color.FromArgb(147, 230, 42);

        private readonly RoundButton _button;
        public event Action ConnectClicked;
        public event Action DisconnectClicked;
        public bool Connected { get; private set; }

        public MainForm()
        {
            Text = "Crypto Conex — Suporte";
            BackColor = Bg;
            ClientSize = new Size(440, 520);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            DoubleBuffered = true;
            Icon = AppIcon();

            var logo = new PictureBox
            {
                Image = LoadImage("logo.png"),
                SizeMode = PictureBoxSizeMode.Zoom,
                BackColor = Color.Transparent,
                Bounds = new Rectangle(50, 50, 340, 170)
            };
            _button = new RoundButton
            {
                Text = "CONECTAR",
                Bounds = new Rectangle(50, 290, 340, 130),
                Font = new Font("Segoe UI", 26, FontStyle.Bold),
                ForeColor = Bg,
                Fill = Lime,
                HoverFill = LimeHover,
                Cursor = Cursors.Hand,
                AccessibleName = "Conectar ao técnico"
            };
            _button.Click += (s, e) =>
            {
                if (Connected) DisconnectClicked?.Invoke();
                else ConnectClicked?.Invoke();
            };
            Controls.Add(logo);
            Controls.Add(_button);
        }

        public void SetConnected(bool connected)
        {
            Connected = connected;
            _button.Text = connected ? "CONECTADO ✓" : "CONECTAR";
            _button.Outline = connected;
            _button.ForeColor = connected ? Lime : Bg;
            _button.Invalidate();
        }

        // Moldura subtil à volta do botão, como no site
        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            var r = new Rectangle(_button.Left - 10, _button.Top - 10, _button.Width + 20, _button.Height + 20);
            using var path = RoundButton.Rounded(r, 30);
            using var fill = new SolidBrush(Color.FromArgb(12, Lime));
            using var pen = new Pen(Color.FromArgb(80, Lime), 1);
            e.Graphics.FillPath(fill, path);
            e.Graphics.DrawPath(pen, path);
        }

        public static Image LoadImage(string name)
        {
            var asm = Assembly.GetExecutingAssembly();
            var res = asm.GetManifestResourceNames().FirstOrDefault(n => n.EndsWith(name, StringComparison.OrdinalIgnoreCase));
            if (res == null) return null;
            using var s = asm.GetManifestResourceStream(res);
            using var ms = new MemoryStream();
            s.CopyTo(ms);
            return Image.FromStream(new MemoryStream(ms.ToArray()));
        }

        public static Icon AppIcon()
        {
            var asm = Assembly.GetExecutingAssembly();
            var res = asm.GetManifestResourceNames().FirstOrDefault(n => n.EndsWith("app.ico", StringComparison.OrdinalIgnoreCase));
            if (res == null) return SystemIcons.Application;
            using var s = asm.GetManifestResourceStream(res);
            return new Icon(s);
        }
    }

    /// <summary>Botão arredondado desenhado à mão (cheio ou contorno).</summary>
    public class RoundButton : Control
    {
        public Color Fill { get; set; }
        public Color HoverFill { get; set; }
        public bool Outline { get; set; }
        private bool _hover;

        public RoundButton()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                     ControlStyles.UserPaint | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
        }

        protected override void OnMouseEnter(EventArgs e) { _hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { _hover = false; Invalidate(); base.OnMouseLeave(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var rect = new Rectangle(1, 1, Width - 3, Height - 3);
            using var path = Rounded(rect, 22);
            if (Outline)
            {
                using var bg = new SolidBrush(Color.FromArgb(22, Fill));
                using var pen = new Pen(Fill, 2);
                g.FillPath(bg, path);
                g.DrawPath(pen, path);
            }
            else
            {
                using var brush = new SolidBrush(_hover ? HoverFill : Fill);
                g.FillPath(brush, path);
            }
            TextRenderer.DrawText(g, Text, Font, ClientRectangle, ForeColor,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
        }

        public static GraphicsPath Rounded(Rectangle r, int radius)
        {
            int d = radius * 2;
            var p = new GraphicsPath();
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }
    }
}
