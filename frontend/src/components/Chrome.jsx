"use client";
import { usePathname } from "next/navigation";
import Navbar from "./Navbar";
import Footer from "./Footer";

/** The product shell (navbar + footer) is hidden inside /project, which has its own frame. */
export default function Chrome({ children }) {
  const path = usePathname();
  const isProject = path === "/project" || path.startsWith("/project/");
  return (
    <>
      {!isProject && <Navbar />}
      <main id="main" className="min-h-screen">{children}</main>
      {!isProject && <Footer />}
    </>
  );
}
