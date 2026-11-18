// See fixtures/dynamic-barrel/EXPECTED.md. The patterns below are intentional; do not "fix" them.
import LazyClient from '../../components/LazyClient';

export default function LazyPage() {
  return (
    <main>
      <h1>Lazy</h1>
      <LazyClient />
    </main>
  );
}
