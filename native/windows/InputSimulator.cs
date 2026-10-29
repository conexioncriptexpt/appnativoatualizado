using System;
using System.Runtime.InteropServices;

namespace CryptoConex.PC
{
    /// <summary>
    /// Simulação de eventos de mouse e teclado via user32.dll (P/Invoke).
    /// Permite que o técnico auxilie na navegação do sistema em nome do usuário.
    /// </summary>
    public static class InputSimulator
    {
        [DllImport("user32.dll")]
        private static extern bool SetCursorPos(int x, int y);

        [DllImport("user32.dll")]
        private static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint data, UIntPtr extra);

        [DllImport("user32.dll")]
        private static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern short VkKeyScan(char ch);

        private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        private const uint MOUSEEVENTF_LEFTUP = 0x0004;
        private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        private const uint KEYEVENTF_KEYUP = 0x0002;

        /// <summary>Executa um comando JSON vindo do painel do técnico.</summary>
        public static void Execute(Command cmd)
        {
            switch (cmd.Type)
            {
                case "click":
                    SetCursorPos(cmd.X, cmd.Y);
                    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
                    break;
                case "doubleclick":
                    SetCursorPos(cmd.X, cmd.Y);
                    for (int i = 0; i < 2; i++)
                    {
                        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
                    }
                    break;
                case "rightclick":
                    SetCursorPos(cmd.X, cmd.Y);
                    mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, UIntPtr.Zero);
                    mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, UIntPtr.Zero);
                    break;
                case "move":
                    SetCursorPos(cmd.X, cmd.Y);
                    break;
                case "type":
                    TypeText(cmd.Text ?? "");
                    break;
            }
        }

        private static void TypeText(string text)
        {
            foreach (char c in text)
            {
                short vk = VkKeyScan(c);
                byte key = (byte)(vk & 0xff);
                keybd_event(key, 0, 0, UIntPtr.Zero);
                keybd_event(key, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
            }
        }
    }

    public class Command
    {
        public string Type { get; set; }
        public int X { get; set; }
        public int Y { get; set; }
        public string Text { get; set; }
    }
}
