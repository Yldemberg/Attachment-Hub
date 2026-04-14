import { FlaskConical } from "lucide-react";

export function DemoBanner() {
  if (import.meta.env.VITE_DEMO_MODE !== "true") return null;

  return (
    <div className="flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium bg-violet-600 text-white flex-shrink-0">
      <FlaskConical className="w-3.5 h-3.5 flex-shrink-0" />
      <span>Modo Demo — dados fictícios. Nenhuma ação real será executada.</span>
    </div>
  );
}
