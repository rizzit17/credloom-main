import { Suspense } from 'react';
import { SignUpForm } from '@/components/auth/AuthForms';

export const metadata = { title: 'Create account · Credloom' };
export default function Page() {
  return <Suspense><SignUpForm /></Suspense>;
}
