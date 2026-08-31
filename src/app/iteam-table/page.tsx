import { redirect } from 'next/navigation';

export default function IteamTableRedirect() {
  redirect('/?tab=items');
}
