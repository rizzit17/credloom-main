import { redirect } from 'next/navigation';

// Moved: project and presentation material now lives under /project
export default function Page() { redirect('/project/demo'); }
