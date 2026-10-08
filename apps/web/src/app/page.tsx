import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h2>Recall</h2>
      
      <p>
        <Link href="/login" className="underline">Log in</Link>
        <Link href="/signup" className="underline">Sign up</Link>
      </p>
    </main>
  );
}
// export default function Home() {
//   return "Recall";
// }
