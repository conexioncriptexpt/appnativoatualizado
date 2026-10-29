import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { TZ } from "@/lib/datetime";

export default function LisbonClock({ dark = false }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);

  const time = new Intl.DateTimeFormat("pt-PT", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(now);
  const date = new Intl.DateTimeFormat("pt-PT", {
    timeZone: TZ, weekday: "short", day: "2-digit", month: "short",
  }).format(now);

  return (
    <div
      data-testid="lisbon-clock"
      className={`flex items-center gap-2 font-mono text-sm ${
        dark ? "text-gray-300" : "text-[#0D5C75]"
      }`}
      title="Hora de Lisboa"
    >
      <Clock size={16} />
      <span className="font-semibold tabular-nums">{time}</span>
      <span className={dark ? "text-gray-500" : "text-[#475569]"}>· {date} · Lisboa</span>
    </div>
  );
}
