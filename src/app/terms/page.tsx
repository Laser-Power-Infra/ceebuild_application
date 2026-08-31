import { redirect } from 'next/navigation';

export default function TermsRedirect() {
  redirect('/?tab=terms');
}
