"use client";

import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';

export default function LoginPage() { // No functional change, just for consistency
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const router = useRouter();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push('/'); // Redirect to the main register page on successful login
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-cream-50 dark:bg-cream-950">
      <div className="w-full max-w-md p-8 space-y-6 bg-white dark:bg-warmgray-900 rounded-2xl shadow-lg">
        <h1 className="text-title font-black text-center text-ink-900 dark:text-ink-50">
          POS System Login
        </h1>
        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label htmlFor="email" className="text-sm font-bold text-warmgray-600 dark:text-warmgray-400 block">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full mt-2 px-4 py-2 text-ink-900 dark:text-ink-50 bg-warmgray-50 dark:bg-warmgray-800 border border-warmgray-200 dark:border-warmgray-700 rounded-lg focus:ring-clay-400 focus:border-clay-400"
            />
          </div>
          <div>
            <label htmlFor="password"  className="text-sm font-bold text-warmgray-600 dark:text-warmgray-400 block">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full mt-2 px-4 py-2 text-ink-900 dark:text-ink-50 bg-warmgray-50 dark:bg-warmgray-800 border border-warmgray-200 dark:border-warmgray-700 rounded-lg focus:ring-clay-400 focus:border-clay-400"
            />
          </div>
          {error && <p className="text-sm text-rust-500 text-center">{error}</p>}
          <button type="submit" className="w-full py-3 px-4 text-lg font-bold text-white bg-clay-400 rounded-lg hover:bg-clay-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-clay-400">
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}
