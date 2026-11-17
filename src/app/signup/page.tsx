'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { Mail, KeyRound, UserPlus, IdCard } from 'lucide-react';

const MIN_PASSWORD_LENGTH = 10; // keep in sync with src/lib/auth/password.ts

const inputClass =
  'w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900 font-bold';

export default function SignupPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Sign up failed. Please try again.');
        return;
      }
      // Account created: sign straight in with the same credentials.
      const login = await signIn('credentials', { email, password, redirect: false });
      window.location.href = login?.ok && !login.error ? '/' : '/login';
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 font-sans p-4 relative overflow-hidden">
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-600/30 rounded-full blur-3xl" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-indigo-600/30 rounded-full blur-3xl" />
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 p-8 space-y-6 relative z-10">
        <div className="text-center space-y-3">
          <div className="inline-flex p-3 bg-blue-50 rounded-2xl border border-blue-100 shadow-sm">
            <img src="/ceebuild-logo.png" alt="CEEBUILD Logo" className="h-12 w-auto object-contain" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">Create a CEEBUILD account</h1>
            <p className="text-xs text-slate-500 font-medium mt-1">An account lets you add and edit dockets, items and terms</p>
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
            <label htmlFor="name" className="font-extrabold text-slate-700 block mb-1.5">
              Full name
            </label>
            <div className="relative">
              <IdCard className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input id="name" type="text" required maxLength={100} autoComplete="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
            </div>
          </div>

          <div>
            <label htmlFor="email" className="font-extrabold text-slate-700 block mb-1.5">
              Email
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="email"
                type="email"
                required
                maxLength={254}
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="font-extrabold text-slate-700 block mb-1.5">
              Password <span className="font-medium text-slate-400">(at least {MIN_PASSWORD_LENGTH} characters)</span>
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input id="password" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
            </div>
          </div>

          <div>
            <label htmlFor="confirm" className="font-extrabold text-slate-700 block mb-1.5">
              Confirm password
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input id="confirm" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-extrabold py-3.5 rounded-xl shadow-md shadow-blue-500/20 text-xs flex items-center justify-center space-x-2"
          >
            <UserPlus className="w-4 h-4" />
            <span>{submitting ? 'Creating account...' : 'Sign up'}</span>
          </button>
        </form>

        <p className="text-center text-[11px] text-slate-500">
          Already have an account?{' '}
          <Link href="/login" className="font-bold text-blue-600 hover:underline">
            Sign in
          </Link>
          {' · '}
          <Link href="/" className="font-bold text-blue-600 hover:underline">
            Back to dashboard
          </Link>
        </p>
      </div>
    </div>
  );
}
