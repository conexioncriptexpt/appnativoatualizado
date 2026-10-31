using System;
using System.IO;
using System.Windows.Forms;

namespace CryptoConex.PC
{
    /// <summary>Na primeira abertura cria um atalho «Crypto Conex» no Ambiente de Trabalho.</summary>
    public static class DesktopShortcut
    {
        public static void EnsureCreated()
        {
            try
            {
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string lnk = Path.Combine(desktop, "Crypto Conex.lnk");
                string exe = Environment.ProcessPath ?? Application.ExecutablePath;
                if (File.Exists(lnk) || string.IsNullOrEmpty(exe)) return;

                var shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) return;
                dynamic shell = Activator.CreateInstance(shellType);
                dynamic shortcut = shell.CreateShortcut(lnk);
                shortcut.TargetPath = exe;
                shortcut.WorkingDirectory = Path.GetDirectoryName(exe);
                shortcut.IconLocation = exe + ",0";
                shortcut.Description = "Crypto Conex — pedir ajuda ao técnico";
                shortcut.Save();
            }
            catch (Exception)
            {
                // sem atalho não é crítico
            }
        }
    }
}
