export default function Logo({ size = 44, showText = true, dark = false }) {
  return (
    <div className="flex items-center gap-3">
      <img
        src="/logo.png"
        alt="Crypto Conex"
        style={{ width: size, height: size }}
        className="rounded-2xl object-cover bg-white shadow-sm"
      />
      {showText && (
        <div className="leading-none">
          <div className={`font-display font-extrabold text-xl tracking-tight ${dark ? "text-white" : "text-[#0F172A]"}`}>
            Crypto Conex
          </div>
          <div className={`text-sm ${dark ? "text-gray-500 font-mono" : "text-[#475569]"}`}>
            {dark ? "Painel de Gestão · CRM" : "Suporte Assistido"}
          </div>
        </div>
      )}
    </div>
  );
}
