// Light route: server component only, used as the baseline.
import Link from 'next/link';

export default function HomePage() {
  return (
    <main>
      <h1>Home</h1>
      <Link href="/lazy">Lazy</Link>
    </main>
  );
}
