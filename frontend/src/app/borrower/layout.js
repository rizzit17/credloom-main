import AppShell from '@/components/AppShell';

export default function Layout({ children }) {
  return <AppShell role="borrower">{children}</AppShell>;
}
