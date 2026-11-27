'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getProviders, signIn } from 'next-auth/react';
import { Mail, KeyRound, ShieldCheck } from 'lucide-react';

// Errors NextAuth / our signIn callback send back as /login?error=...
const LOGIN_ERRORS: Record<string, string> = {
  GoogleUnverified: 'Your Google account email is not verified.',
  GoogleDomain: 'This Google account is not allowed. Use your company email.',
  AccountDisabled: 'This account is disabled. Contact the administrator.',
  AccessDenied: 'Sign-in was refused.',
  OAuthSignin: 'Could not start Google sign-in. Please try again.',
  OAuthCallback: 'Google sign-in failed. Please try again.',
  Callback: 'Google sign-in failed. Please try again.',
  OAuthAccountNotLinked: 'This email is already linked to another sign-in method.',
};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="w-4 h-4" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function safeNext(next: string | null): string {
  // Only allow same-site relative paths (no protocol-relative or absolute URLs).
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}

function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const urlError = searchParams.get('error');
  const [error, setError] = useState(urlError ? LOGIN_ERRORS[urlError] || 'Sign-in failed. Please try again.' : '');
  const [submitting, setSubmitting] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  useEffect(() => {
    // The Google button appears only when the server has GOOGLE_CLIENT_ID/SECRET configured.
    getProviders()
      .then((p) => setGoogleEnabled(Boolean(p?.google)))
      .catch(() => setGoogleEnabled(false));
  }, []);

  const handleGoogle = () => {
    setError('');
    setSubmitting(true);
    void signIn('google', { callbackUrl: safeNext(searchParams.get('next')) });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      // LEGACY (custom cookie auth, replaced by NextAuth on 2026-11-17):
      // const res = await fetch('/api/auth/login', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ username, password }),
      // });
      // if (res.ok) { window.location.href = safeNext(searchParams.get('next')); return; }
      // const data = await res.json().catch(() => ({}));
      // setError(data.error || 'Login failed. Please try again.');
      const res = await signIn('credentials', { email, password, redirect: false });
      if (res?.ok && !res.error) {
        // Full navigation so the dashboard reloads with the new session.
        window.location.href = safeNext(searchParams.get('next'));
        return;
      }
      // "CredentialsSignin" is NextAuth's generic code; our own messages come through as-is.
      setError(res?.error && res.error !== 'CredentialsSignin' ? res.error : 'Login failed. Please try again.');
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-slate-100 p-8 space-y-6 relative z-10">
      <div className="text-center space-y-3">
        <div className="inline-flex p-3 bg-blue-50 rounded-xl border border-blue-100 shadow-sm">
          <img src="/ceebuild-logo.png" alt="CEEBUILD Logo" className="h-12 w-auto object-contain" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">CEEBUILD Dashboard Login</h1>
          <p className="text-xs text-slate-500 font-medium mt-1">Sign in with your email and password</p>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-xs font-bold text-center"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 text-xs font-medium">
        <div>
          <label htmlFor="email" className="font-semibold text-slate-700 block mb-1.5">
            User ID or email
          </label>
          <div className="relative">
            <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              id="email"
              // text, not email: accounts made before email login still sign in with their old username
              type="text"
              inputMode="email"
              required
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900 font-bold"
            />
          </div>
        </div>

        <div>
          <label htmlFor="password" className="font-semibold text-slate-700 block mb-1.5">
            Password
          </label>
          <div className="relative">
            <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900 font-bold"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold py-3.5 rounded-xl shadow-sm shadow-blue-500/20 text-xs flex items-center justify-center space-x-2"
        >
          <ShieldCheck className="w-4 h-4" />
          <span>{submitting ? 'Signing in...' : 'Login to Dashboard'}</span>
        </button>
      </form>

      {googleEnabled && (
        <>
          <div className="flex items-center gap-3 text-[11px] text-slate-400 font-semibold">
            <div className="h-px flex-1 bg-slate-200" />
            <span>OR</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>
          <button
            type="button"
            onClick={handleGoogle}
            disabled={submitting}
            className="w-full bg-white hover:bg-slate-50 disabled:opacity-60 border border-slate-200 text-slate-700 font-semibold py-3.5 rounded-xl shadow-sm text-xs flex items-center justify-center space-x-2"
          >
            <GoogleIcon />
            <span>Sign in with Google</span>
          </button>
        </>
      )}

      <p className="text-center text-[11px] text-slate-500">
        No account?{' '}
        <Link href="/signup" className="font-bold text-blue-600 hover:underline">
          Sign up
        </Link>
        {' · '}
        <Link href="/" className="font-bold text-blue-600 hover:underline">
          Back to dashboard
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 font-sans p-4 relative overflow-hidden">
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-600/30 rounded-full blur-3xl" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-indigo-600/30 rounded-full blur-3xl" />
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
