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

            using var ms = new MemoryStream();
            var encoder = ImageCodecInfo.GetImageEncoders()[1]; // JPEG
            var ep = new EncoderParameters(1);
            ep.Param[0] = new EncoderParameter(Encoder.Quality, 55L);
            bmp.Save(ms, encoder, ep);
            return ms.ToArray();
        }
    }
}
