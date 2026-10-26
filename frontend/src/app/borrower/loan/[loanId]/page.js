"use client";
import { use } from "react";
import LoanDetail from "@/components/LoanDetail";

export default function Page({ params }) {
  const { loanId } = use(params);
  return <LoanDetail loanId={loanId} backHref="/borrower" />;
}
