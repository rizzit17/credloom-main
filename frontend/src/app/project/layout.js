import ProjectNav from "@/components/ProjectNav";

export const metadata = { title: "Project documentation · Credloom" };

export default function ProjectLayout({ children }) {
  return (
    <div className="bg-zinc-950">
      <ProjectNav />
      {children}
    </div>
  );
}
