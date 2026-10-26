import Hero from "@/components/Hero";
import Feature from "@/components/Feature";
import Faqs from "@/components/Faqs";
import LiveStats from "@/components/LiveStats";

export default function Home() {
  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <Hero />
      <LiveStats />
      <Feature />
      <Faqs />
    </div>
  );
}
