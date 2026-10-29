using System;
using System.Threading;
using SharpDX;
using SharpDX.Direct3D11;
using SharpDX.DXGI;
using Device = SharpDX.Direct3D11.Device;
using MapFlags = SharpDX.Direct3D11.MapFlags;

namespace CryptoConex.PC
{
    /// <summary>
    /// Captura de tela eficiente via Desktop Duplication API (DXGI).
    /// Emite pacotes de frame (JPEG/H.264) para o técnico com baixa latência.
    /// </summary>
    public class ScreenCapture
    {
        public event Action<byte[]> OnFrame;
        private Thread _worker;
        private volatile bool _running;

        public void Start()
        {
            if (_running) return;
            _running = true;
            _worker = new Thread(CaptureLoop) { IsBackground = true };
            _worker.Start();
        }

        public void Stop() => _running = false;

        private void CaptureLoop()
        {
            var factory = new Factory1();
            var adapter = factory.GetAdapter1(0);
            var device = new Device(adapter);
            var output = adapter.GetOutput(0);
            var output1 = output.QueryInterface<Output1>();
            var bounds = output.Description.DesktopBounds;
            int width = bounds.Right - bounds.Left;
            int height = bounds.Bottom - bounds.Top;

            var textureDesc = new Texture2DDescription
            {
                CpuAccessFlags = CpuAccessFlags.Read,
                BindFlags = BindFlags.None,
                Format = Format.B8G8R8A8_UNorm,
                Width = width,
                Height = height,
                OptionFlags = ResourceOptionFlags.None,
                MipLevels = 1,
                ArraySize = 1,
                SampleDescription = { Count = 1, Quality = 0 },
                Usage = ResourceUsage.Staging
            };
            var stagingTexture = new Texture2D(device, textureDesc);
            var duplication = output1.DuplicateOutput(device);

            while (_running)
            {
                try
                {
                    var result = duplication.TryAcquireNextFrame(100, out _, out var resource);
                    if (!result.Success) continue;

                    using (var screenTexture = resource.QueryInterface<Texture2D>())
                        device.ImmediateContext.CopyResource(screenTexture, stagingTexture);

                    var dataBox = device.ImmediateContext.MapSubresource(stagingTexture, 0, MapMode.Read, MapFlags.None);
                    byte[] frame = FrameEncoder.EncodeBgraToJpeg(dataBox.DataPointer, width, height, dataBox.RowPitch);
                    device.ImmediateContext.UnmapSubresource(stagingTexture, 0);

                    OnFrame?.Invoke(frame);
                    duplication.ReleaseFrame();
                }
                catch (SharpDXException) { /* timeout de frame — ignora */ }
            }

            duplication.Dispose();
            stagingTexture.Dispose();
            device.Dispose();
            factory.Dispose();
        }
    }
}
