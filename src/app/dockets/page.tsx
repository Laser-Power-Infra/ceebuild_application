import { redirect } from 'next/navigation';

export default function DocketsRedirect() {
  redirect('/?tab=dockets');
}
