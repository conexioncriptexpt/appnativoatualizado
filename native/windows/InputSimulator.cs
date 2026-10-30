using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

namespace CryptoConex.PC
{
    /// <summary>
    /// Simulação de rato e teclado via SendInput (user32.dll).
    /// Coordenadas normalizadas (0..1) são convertidas em posições absolutas do ecrã principal,
    /// o que evita problemas de escala DPI.
    /// </summary>
    public static class InputSimulator
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)]
        private struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Explicit)]
        private struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
        [StructLayout(LayoutKind.Sequential)]
        private struct INPUT { public uint type; public InputUnion u; }

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern short VkKeyScan(char ch);
        [DllImport("user32.dll")]
        private static extern int GetSystemMetrics(int index);

        private const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
        private const uint MOVE = 0x0001, LEFTDOWN = 0x0002, LEFTUP = 0x0004, RIGHTDOWN = 0x0008, RIGHTUP = 0x0010,
                           WHEEL = 0x0800, ABSOLUTE = 0x8000;
        private const uint KEYUP = 0x0002, UNICODE = 0x0004;
        private const ushort VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_MENU = 0x12;

        private static readonly Dictionary<string, ushort> Special = new Dictionary<string, ushort>
        {
            ["Enter"] = 0x0D, ["Backspace"] = 0x08, ["Tab"] = 0x09, ["Escape"] = 0x1B, ["Delete"] = 0x2E,
            ["Home"] = 0x24, ["End"] = 0x23, ["PageUp"] = 0x21, ["PageDown"] = 0x22,
            ["ArrowLeft"] = 0x25, ["ArrowUp"] = 0x26, ["ArrowRight"] = 0x27, ["ArrowDown"] = 0x28,
            ["F1"] = 0x70, ["F2"] = 0x71, ["F3"] = 0x72, ["F4"] = 0x73, ["F5"] = 0x74, ["F6"] = 0x75,
            ["F7"] = 0x76, ["F8"] = 0x77, ["F9"] = 0x78, ["F10"] = 0x79, ["F11"] = 0x7A, ["F12"] = 0x7B,
        };

        /// <summary>Executa um comando JSON vindo do painel do técnico.</summary>
        public static void Execute(Command cmd)
        {
            switch (cmd.Type)
            {
                case "move": MoveTo(cmd); break;
                case "click": MoveTo(cmd); Mouse(LEFTDOWN); Mouse(LEFTUP); break;
                case "doubleclick": MoveTo(cmd); Mouse(LEFTDOWN); Mouse(LEFTUP); Mouse(LEFTDOWN); Mouse(LEFTUP); break;
                case "rightclick": MoveTo(cmd); Mouse(RIGHTDOWN); Mouse(RIGHTUP); break;
                case "longpress": MoveTo(cmd); Mouse(LEFTDOWN); Thread.Sleep(700); Mouse(LEFTUP); break;
                case "drag": Drag(cmd); break;
                case "scroll": MoveTo(cmd); Mouse(WHEEL, cmd.Delta); break;
                case "type": TypeText(cmd.Text ?? ""); break;
                case "key":
                    if (!string.IsNullOrEmpty(cmd.Text)) TypeText(cmd.Text);
                    else if (!string.IsNullOrEmpty(cmd.Key)) PressKey(cmd);
                    break;
            }
        }

        private static (int, int) Abs(double nx, double ny) =>
            ((int)Math.Round(Math.Clamp(nx, 0, 1) * 65535), (int)Math.Round(Math.Clamp(ny, 0, 1) * 65535));

        private static (double, double) Norm(Command c, bool second = false)
        {
            if (second ? c.NX2.HasValue : c.NX.HasValue)
                return second ? (c.NX2.Value, c.NY2.Value) : (c.NX.Value, c.NY.Value);
            double w = Math.Max(1, GetSystemMetrics(0) - 1), h = Math.Max(1, GetSystemMetrics(1) - 1);
            return second ? (c.X2 / w, c.Y2 / h) : (c.X / w, c.Y / h);
        }

        private static void MoveTo(Command c)
        {
            var (nx, ny) = Norm(c);
            var (ax, ay) = Abs(nx, ny);
            Mouse(MOVE | ABSOLUTE, 0, ax, ay);
        }

        private static void Drag(Command c)
        {
            var (x1, y1) = Norm(c);
            var (x2, y2) = Norm(c, true);
            int steps = 20, pause = Math.Max(5, Math.Min(2000, c.Duration > 0 ? c.Duration : 300) / steps);
            MoveTo(c);
            Mouse(LEFTDOWN);
            for (int i = 1; i <= steps; i++)
            {
                var (ax, ay) = Abs(x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps);
                Mouse(MOVE | ABSOLUTE, 0, ax, ay);
                Thread.Sleep(pause);
            }
            Mouse(LEFTUP);
        }

        private static void Mouse(uint flags, int data = 0, int dx = 0, int dy = 0)
        {
            var input = new INPUT { type = INPUT_MOUSE };
            input.u.mi = new MOUSEINPUT { dx = dx, dy = dy, mouseData = unchecked((uint)data), dwFlags = flags };
            SendInput(1, new[] { input }, Marshal.SizeOf<INPUT>());
        }

        private static void Key(ushort vk, ushort scan, uint flags)
        {
            var input = new INPUT { type = INPUT_KEYBOARD };
            input.u.ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags };
            SendInput(1, new[] { input }, Marshal.SizeOf<INPUT>());
        }

        private static void TypeText(string text)
        {
            foreach (char ch in text)
            {
                Key(0, ch, UNICODE);
                Key(0, ch, UNICODE | KEYUP);
            }
        }

        private static void PressKey(Command c)
        {
            ushort vk;
            if (Special.TryGetValue(c.Key, out var sv)) vk = sv;
            else if (c.Key.Length == 1) vk = (ushort)(VkKeyScan(c.Key[0]) & 0xff);
            else return;

            var mods = new List<ushort>();
            if (c.Ctrl) mods.Add(VK_CONTROL);
            if (c.Alt) mods.Add(VK_MENU);
            if (c.Shift) mods.Add(VK_SHIFT);
            foreach (var m in mods) Key(m, 0, 0);
            Key(vk, 0, 0);
            Key(vk, 0, KEYUP);
            for (int i = mods.Count - 1; i >= 0; i--) Key(mods[i], 0, KEYUP);
        }
    }

    public class Command
    {
        public string Type { get; set; }
        public int X { get; set; }
        public int Y { get; set; }
        public int X2 { get; set; }
        public int Y2 { get; set; }
        public double? NX { get; set; }
        public double? NY { get; set; }
        public double? NX2 { get; set; }
        public double? NY2 { get; set; }
        public int Duration { get; set; }
        public int Delta { get; set; }
        public string Text { get; set; }
        public string Key { get; set; }
        public bool Ctrl { get; set; }
        public bool Alt { get; set; }
        public bool Shift { get; set; }
    }
}
