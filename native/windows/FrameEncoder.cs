using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

namespace CryptoConex.PC
{
    /// <summary>Copia/reduz o buffer BGRA capturado e converte para JPEG (modo de recurso).</summary>
    public static class FrameEncoder
    {
        private const int MaxWidth = 1280;

        /// <summary>Devolve um buffer BGRA compacto (stride = largura*4), reduzido a ≤1280px e com dimensões pares.</summary>
        public static byte[] CopyAndScale(IntPtr data, int width, int height, int rowPitch, out int outW, out int outH)
        {
            using var bmp = new Bitmap(width, height, PixelFormat.Format32bppArgb);
            var bmpData = bmp.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.WriteOnly, bmp.PixelFormat);
            byte[] row = new byte[width * 4];
            for (int y = 0; y < height; y++)
            {
                Marshal.Copy(IntPtr.Add(data, y * rowPitch), row, 0, row.Length);
                Marshal.Copy(row, 0, IntPtr.Add(bmpData.Scan0, y * bmpData.Stride), row.Length);
            }
            bmp.UnlockBits(bmpData);

            double ratio = width > MaxWidth ? MaxWidth / (double)width : 1.0;
            outW = ((int)(width * ratio)) / 2 * 2;
            outH = ((int)(height * ratio)) / 2 * 2;

            using var scaled = new Bitmap(outW, outH, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(scaled))
            {
                g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.Bilinear;
                g.DrawImage(bmp, 0, 0, outW, outH);
            }
            var sData = scaled.LockBits(new Rectangle(0, 0, outW, outH), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            byte[] packed = new byte[outW * outH * 4];
            for (int y = 0; y < outH; y++)
                Marshal.Copy(IntPtr.Add(sData.Scan0, y * sData.Stride), packed, y * outW * 4, outW * 4);
            scaled.UnlockBits(sData);
            return packed;
        }

        public static byte[] EncodeJpeg(byte[] bgra, int width, int height)
        {
            using var bmp = new Bitmap(width, height, PixelFormat.Format32bppArgb);
            var bmpData = bmp.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.WriteOnly, bmp.PixelFormat);
            for (int y = 0; y < height; y++)
                Marshal.Copy(bgra, y * width * 4, IntPtr.Add(bmpData.Scan0, y * bmpData.Stride), width * 4);
            bmp.UnlockBits(bmpData);

            using var ms = new MemoryStream();
            var encoder = Array.Find(ImageCodecInfo.GetImageEncoders(), c => c.FormatID == ImageFormat.Jpeg.Guid);
            var ep = new EncoderParameters(1);
            ep.Param[0] = new EncoderParameter(Encoder.Quality, 45L);
            bmp.Save(ms, encoder, ep);
            return ms.ToArray();
        }
    }
}
