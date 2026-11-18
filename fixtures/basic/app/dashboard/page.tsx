// Heavy route. Known regression chain (intentional, do not "fix"):
//   app/dashboard/page.tsx -> components/DashboardClient.tsx ("use client")
//     -> components/DatePicker.tsx -> moment
import DashboardClient from '../../components/DashboardClient';

export default function DashboardPage() {
  return (
    <main>
      <h1>Dashboard</h1>
      <DashboardClient />
    </main>
  );
}
