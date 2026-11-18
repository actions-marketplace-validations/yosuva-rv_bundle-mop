// Light route: server component only, no client JS of its own.
import Link from 'next/link';

export default function HomePage() {
  return (
    <main>
      <h1>Home</h1>
      <p>Lightweight route used as the baseline.</p>
      <Link href="/dashboard">Dashboard</Link>
    </main>
  );
}
