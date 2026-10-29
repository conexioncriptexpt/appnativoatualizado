using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

namespace CryptoConex.PC
{
    /// <summary>Converte o buffer BGRA capturado para JPEG comprimido.</summary>
    public static class FrameEncoder
    {
        public static byte[] EncodeBgraToJpeg(IntPtr data, int width, int height, int rowPitch)
        {
            using var bmp = new Bitmap(width, height, PixelFormat.Format32bppArgb);
            var rect = new Rectangle(0, 0, width, height);
            var bmpData = bmp.LockBits(rect, ImageLockMode.WriteOnly, bmp.PixelFormat);
            for (int y = 0; y < height; y++)
            {
                IntPtr src = IntPtr.Add(data, y * rowPitch);
                IntPtr dst = IntPtr.Add(bmpData.Scan0, y * bmpData.Stride);
                byte[] row = new byte[width * 4];
                Marshal.Copy(src, row, 0, row.Length);
                Marshal.Copy(row, 0, dst, row.Length);
            }
            bmp.UnlockBits(bmpData);

            // Downscale to keep each frame comfortably small for the Socket.io channel.
            const int maxWidth = 1280;
            Bitmap toEncode = bmp;
            Bitmap scaled = null;
            if (width > maxWidth)
            {
                int newH = (int)(height * (maxWidth / (double)width));
                scaled = new Bitmap(maxWidth, newH);
                using var g = Graphics.FromImage(scaled);
                g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.Bilinear;
                g.DrawImage(bmp, 0, 0, maxWidth, newH);
                toEncode = scaled;
            }

            using var ms = new MemoryStream();
            var encoder = ImageCodecInfo.GetImageEncoders()[1]; // JPEG
            var ep = new EncoderParameters(1);
            ep.Param[0] = new EncoderParameter(Encoder.Quality, 45L);
            toEncode.Save(ms, encoder, ep);
            scaled?.Dispose();
            return ms.ToArray();
        }
    }
}
