// Base state for diffing against fixtures/basic (which adds moment via DatePicker).
//   app/dashboard/page.tsx -> components/DashboardClient.tsx ("use client")
//     -> components/DatePicker.tsx (Intl only)
import DashboardClient from '../../components/DashboardClient';

export default function DashboardPage() {
  return (
    <main>
      <h1>Dashboard</h1>
      <DashboardClient />
    </main>
  );
}
