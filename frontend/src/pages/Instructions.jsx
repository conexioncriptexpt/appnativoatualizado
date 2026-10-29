import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Smartphone, Monitor, Download, ArrowLeft, Volume2, Info } from "lucide-react";
import { detectOS } from "@/lib/datetime";
import Logo from "@/components/Logo";
import LisbonClock from "@/components/LisbonClock";

const DOWNLOADS = {
  android: process.env.REACT_APP_DOWNLOAD_ANDROID_URL,
  windows: process.env.REACT_APP_DOWNLOAD_WINDOWS_URL,
};

const GUIDES = {
  android: {
    label: "Telemóvel Android",
    icon: Smartphone,
    file: "Aplicação Android (.apk)",
    steps: [
      { t: "Descarregue a aplicação", d: "Carregue no botão azul acima. O ficheiro fica na pasta Transferências." },
      { t: "Abra o ficheiro", d: "Toque na notificação ou abra a pasta Transferências e toque em «CryptoConex»." },
      { t: "Permita a instalação", d: "Se aparecer «Fontes desconhecidas», toque em Definições e ative «Permitir desta origem». Volte atrás e toque em Instalar." },
      { t: "Abra o Crypto Conex", d: "Toque no grande botão CONECTAR." },
      { t: "Ative a Acessibilidade", d: "O telemóvel abre as Definições. Toque em «Aplicações instaladas» → «Crypto Conex» → ative o interruptor → Permitir. Assim o técnico pode tocar no ecrã por si." },
      { t: "Permita sobrepor a outras apps", d: "Ative «Permitir sobreposição» para o Crypto Conex e volte à aplicação." },
      { t: "Autorize a partilha do ecrã", d: "Toque outra vez em CONECTAR e depois em «Começar agora» / «Partilhar ecrã inteiro». Pronto — o técnico já o vê." },
    ],
  },
  windows: {
    label: "Computador Windows",
    icon: Monitor,
    file: "Aplicação Windows (.exe)",
    steps: [
      { t: "Descarregue a aplicação", d: "Clique no botão azul acima. O ficheiro «CryptoConexPC.exe» fica na pasta Transferências." },
      { t: "Abra o ficheiro", d: "Faça duplo clique em «CryptoConexPC.exe»." },
      { t: "Se o Windows avisar", d: "No ecrã azul «O Windows protegeu o seu PC», clique em «Mais informações» e depois em «Executar mesmo assim»." },
      { t: "Encontre o ícone", d: "A aplicação fica junto ao relógio, no canto inferior direito. Se não a vir, clique na pequena seta ^." },
      { t: "Ligue-se ao técnico", d: "Faça duplo clique no ícone do Crypto Conex. Aparece a mensagem «Conectado». O técnico já vê o seu ecrã." },
      { t: "Para terminar", d: "Clique com o botão direito no ícone e escolha «Encerrar sessão»." },
    ],
  },
};

function speak(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "pt-PT";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch (e) {}
}

function OsTabs({ os, setOs }) {
  return (
    <div className="grid grid-cols-2 gap-3" role="tablist">
      {Object.entries(GUIDES).map(([k, g]) => (
        <button
          key={k}
          role="tab"
          aria-selected={os === k}
          onClick={() => setOs(k)}
          data-testid={`instructions-tab-${k}`}
          className={`h-20 rounded-2xl border-2 text-lg font-bold flex items-center justify-center gap-3 transition-colors ${
            os === k ? "bg-[#0D5C75] text-white border-slate-900" : "bg-white text-slate-900 border-slate-300 hover:border-slate-900"
          }`}
        >
          <g.icon size={26} /> {g.label}
        </button>
      ))}
    </div>
  );
}

function DownloadBox({ os }) {
  const url = DOWNLOADS[os];
  if (!url)
    return (
      <div className="rounded-2xl border-2 border-amber-500 bg-amber-50 p-5 flex gap-3 text-amber-900" data-testid="download-unavailable">
        <Info size={24} className="shrink-0 mt-0.5" />
        <div className="text-lg">O ficheiro de instalação estará disponível aqui em breve. Entretanto, use o botão CONECTAR na página inicial.</div>
      </div>
    );
  return (
    <a
      href={url}
      data-testid="download-app-link"
      className="h-24 w-full rounded-3xl bg-[#0D5C75] hover:bg-[#083D4E] text-white text-2xl font-extrabold border-4 border-slate-900 flex items-center justify-center gap-4 transition-colors"
    >
      <Download size={32} /> Descarregar {GUIDES[os].file}
    </a>
  );
}

export default function Instructions() {
  const [params] = useSearchParams();
  const initial = params.get("os") || detectOS();
  const [os, setOs] = useState(GUIDES[initial] ? initial : "android");
  const guide = GUIDES[os];

  return (
    <div className="min-h-screen bg-[#FAFAFD] text-[#0F172A] flex flex-col">
      <header className="w-full border-b-2 border-slate-900/10 bg-white">
        <div className="max-w-3xl mx-auto px-5 py-4 flex items-center justify-between gap-3">
          <Link to="/" aria-label="Página inicial"><Logo size={44} /></Link>
          <div className="hidden sm:block"><LisbonClock /></div>
          <Link to="/" className="h-11 px-4 rounded-xl border-2 border-slate-900 flex items-center gap-2 font-bold hover:bg-slate-100 transition-colors" data-testid="instructions-back-button">
            <ArrowLeft size={20} /> Voltar
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-5 py-10 space-y-8">
        <div>
          <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight leading-tight">Instalar a aplicação assistente</h1>
          <p className="text-xl text-[#475569] mt-3">Escolha o seu aparelho e siga os passos, um de cada vez.</p>
        </div>

        <OsTabs os={os} setOs={setOs} />
        <DownloadBox os={os} />

        <ol className="space-y-4" data-testid="instructions-steps">
          {guide.steps.map((s, i) => (
            <li key={`${os}-${i}`} className="flex gap-4 rounded-2xl border-2 border-slate-200 bg-white p-5">
              <div className="h-12 w-12 shrink-0 rounded-full bg-slate-900 text-white text-2xl font-extrabold flex items-center justify-center">{i + 1}</div>
              <div className="flex-1">
                <div className="text-xl font-bold">{s.t}</div>
                <div className="text-lg text-[#475569] mt-1 leading-snug">{s.d}</div>
              </div>
              <button
                onClick={() => speak(`Passo ${i + 1}. ${s.t}. ${s.d}`)}
                aria-label={`Ouvir passo ${i + 1}`}
                data-testid={`instructions-speak-step-${i + 1}`}
                className="h-12 w-12 shrink-0 rounded-xl border-2 border-slate-900 flex items-center justify-center hover:bg-slate-100 transition-colors"
              >
                <Volume2 size={22} />
              </button>
            </li>
          ))}
        </ol>

        <div className="rounded-2xl bg-slate-900 text-white p-6 text-lg">
          Precisa de ajuda para instalar? Volte à página inicial e carregue em <b>CONECTAR</b> — um técnico guia-o pelo navegador.
        </div>
      </main>
    </div>
  );
}
