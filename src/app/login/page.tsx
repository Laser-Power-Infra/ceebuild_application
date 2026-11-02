'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { UserCheck, KeyRound, ShieldCheck } from 'lucide-react';

function safeNext(next: string | null): string {
  // Only allow same-site relative paths (no protocol-relative or absolute URLs).
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}

function LoginForm() {
  const searchParams = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        // Full navigation so middleware sees the new cookie.
        window.location.href = safeNext(searchParams.get('next'));
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Login failed. Please try again.');
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 p-8 space-y-6 relative z-10">
      <div className="text-center space-y-3">
        <div className="inline-flex p-3 bg-blue-50 rounded-2xl border border-blue-100 shadow-sm">
          <img src="/ceebuild-logo.png" alt="CEEBUILD Logo" className="h-12 w-auto object-contain" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">CEEBUILD Dashboard Login</h1>
          <p className="text-xs text-slate-500 font-medium mt-1">Sign in with the username and password issued to you</p>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-2xl text-xs font-bold text-center"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 text-xs font-medium">
        <div>
          <label htmlFor="username" className="font-extrabold text-slate-700 block mb-1.5">
            Username
          </label>
          <div className="relative">
            <UserCheck className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              id="username"
              type="text"
              required
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900 font-bold"
            />
          </div>
        </div>

        <div>
          <label htmlFor="password" className="font-extrabold text-slate-700 block mb-1.5">
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
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-extrabold py-3.5 rounded-xl shadow-md shadow-blue-500/20 text-xs flex items-center justify-center space-x-2"
        >
          <ShieldCheck className="w-4 h-4" />
          <span>{submitting ? 'Signing in...' : 'Login to Dashboard'}</span>
        </button>
      </form>

      <p className="text-center text-[11px] text-slate-400">No account? Ask a CEEBUILD dashboard administrator.</p>
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
