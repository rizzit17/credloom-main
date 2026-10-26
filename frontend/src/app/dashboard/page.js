"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth, dashboardFor } from "@/contexts/AuthContext";
import { Spinner } from "@/components/kit";

// Legacy route: send each user to the dashboard for their role.
export default function Dashboard() {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    router.replace(user ? dashboardFor(user.role) : "/signin");
  }, [user, loading, router]);
  return <div className="pt-24"><Spinner /></div>;
}
