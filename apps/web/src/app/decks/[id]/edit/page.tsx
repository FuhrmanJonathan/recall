import DeckEditor from "@/components/deck-editor";

export default async function EditDeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DeckEditor deckId={id} />;
}
