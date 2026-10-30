export default function Logo({ height = 48, className = "" }) {
  return (
    <img
      src={height > 90 ? "/logo-app.png" : "/logo-app-sm.png"}
      alt="APP de Suporte Técnico — Crypto Conex"
      style={{ height }}
      className={`w-auto select-none ${className}`}
      draggable={false}
      data-testid="brand-logo"
    />
  );
}
