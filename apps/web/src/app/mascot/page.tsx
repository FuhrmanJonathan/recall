import { notFound } from "next/navigation";
import Yogo, { type YogoExpression } from "@/components/yogo";
import YogoReplay from "@/components/yogo-replay";

const poses: YogoExpression[] = ["idle", "thinking", "celebrating", "encouraging"];
const sizes = [20, 24, 32, 48];

export default function MascotPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return <section>
    <h1 className="mb-6 text-3xl font-semibold tracking-tight">Yogo</h1>
    <YogoReplay>
      <div className="space-y-8">{[{ name: "Light", background: "#F9FAFB", foreground: "#111827" }, { name: "Dark", background: "#111827", foreground: "#F9FAFB" }].map((panel) => <section key={panel.name} className="rounded-2xl border border-gray-200 p-5 sm:p-6" style={{ background: panel.background, color: panel.foreground }}>
        <h2 className="mb-6 text-xl font-semibold">{panel.name}</h2>
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">{poses.map((expression) => <figure key={expression} className="grid justify-items-center gap-3"><Yogo expression={expression} size={240} title={`Yogo ${expression}`} /><figcaption className="text-sm font-medium capitalize">{expression}</figcaption></figure>)}</div>
        <div className="mt-8 overflow-x-auto"><table className="w-full text-center text-sm"><thead><tr><th scope="col" className="px-3 py-3 text-left">Pose</th>{sizes.map((size) => <th key={size} scope="col" className="px-3 py-3">{size}px</th>)}</tr></thead><tbody>{poses.map((expression) => <tr key={expression}><th scope="row" className="px-3 py-3 text-left font-medium capitalize">{expression}</th>{sizes.map((size) => <td key={size} className="px-3 py-3"><Yogo expression={expression} size={size} className="mx-auto" /></td>)}</tr>)}</tbody></table></div>
      </section>)}</div>
    </YogoReplay>
  </section>;
}
