import { Suspense } from 'react';
import { SignInForm } from '@/components/auth/AuthForms';

export const metadata = { title: 'Sign in · Credloom' };
export default function Page() {
  return <Suspense><SignInForm /></Suspense>;
}
