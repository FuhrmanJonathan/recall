"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { RequireAuth } from "@/components/auth";
import { Card, btnPrimary } from "@/components/ui";

type Deck = { id:number; title:string; description:string; subject:string; card_count:number };
type Detail = Deck & {flashcards:{question:string;answer:string}[]};
function Explore() {
  const [query,setQuery] = useState("");
  const [decks,setDecks] = useState<Deck[]>([]);
  const [selected,setSelected] = useState<Detail|null>(null);
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);
  useEffect(()=>{
    let active=true;
    fetch(`/api/public/decks?q=${encodeURIComponent(query)}`)
      .then(async r=>{if(!r.ok)throw new Error("Could not load public decks");return r.json()})
      .then(data=>{if(active)setDecks(data)})
      .catch(e=>{if(active)setError(String(e))});
    return ()=>{active=false};
  },[query]);
  async function preview(id:number){
    setError("");setMessage("");
    const r=await fetch(`/api/public/decks/${id}`);
    if(!r.ok){setError("Deck is no longer public.");return;}
    setSelected(await r.json());
  }
  async function copy(){
    if(!selected)return;
    setBusy(true);setError("");
    try{
      const r=await fetch(`/api/public/decks/${selected.id}/copy`,{method:"POST"});
      if(!r.ok)throw new Error(r.status===401?"Please log in.":"Could not copy this deck.");
      setMessage("Deck copied to My Decks as a private copy.");
    } catch(e){setError(String(e))} finally{setBusy(false)}
  }
  return <main className="space-y-5">
    <h1 className="text-3xl font-bold">Explore flashcards</h1>
    <p className="text-sm text-gray-600">Browse public decks and save them into your library.</p>
    <input aria-label="Search public decks" className="w-full rounded-lg border p-3" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by subject, title, or description"/>
    {error&&<p role="alert" className="text-red-700">{error}</p>}
    {message&&<p role="status" className="text-green-700">{message} <Link href="/decks" className="underline">View My Decks</Link></p>}
    <div className="grid gap-3 sm:grid-cols-2">{decks.map(d=><Card key={d.id} className="p-4">
      <h2 className="font-semibold">{d.title}</h2><p className="text-sm text-gray-600">{d.subject} · {d.card_count} cards</p>
      <p className="mt-2 text-sm">{d.description}</p><button className="mt-3 text-sm font-semibold underline" onClick={()=>void preview(d.id)}>Preview cards</button>
    </Card>)}</div>
    {!decks.length&&<p className="text-sm text-gray-500">No public decks found yet.</p>}
    {selected&&<Card className="space-y-3 p-5"><h2 className="font-semibold">{selected.title}</h2>
      {selected.flashcards.slice(0,5).map((c,i)=><div key={i} className="rounded border p-3 text-sm"><b>{c.question}</b><p>{c.answer}</p></div>)}
      {selected.flashcards.length>5&&<p className="text-sm">Showing first 5 of {selected.flashcards.length} cards</p>}
      <button disabled={busy} onClick={()=>void copy()} className={btnPrimary}>{busy?"Copying…":"Copy to My Decks"}</button>
    </Card>}
  </main>;
}
export default function ExplorePage(){return <RequireAuth><Explore/></RequireAuth>}
