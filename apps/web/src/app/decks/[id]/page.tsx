import DeckDetails from "@/components/deck-details";

export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DeckDetails deckId={id} />;
}
