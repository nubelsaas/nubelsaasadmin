'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase';

type Setup = { factorId: string; qrCode?: string; secret?: string };

export default function MfaPage() {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) { setError(listError.message); return; }

      const verified = factors.totp[0];
      if (verified) { setSetup({ factorId: verified.id }); return; }

      // Un enrolamiento abandonado queda sin verificar y bloquea el siguiente.
      for (const factor of factors.all.filter(f => f.status === 'unverified')) {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `Nubel Admin ${Date.now()}`,
      });
      if (enrollError) { setError(enrollError.message); return; }
      setSetup({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    }
    load();
  }, []);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!setup) return;
    setError(null);
    setVerifying(true);
    const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({
      factorId: setup.factorId,
      code: code.trim(),
    });
    if (verifyError) {
      setError('Invalid code');
      setVerifying(false);
      return;
    }
    router.push('/');
    router.refresh();
  }

  async function handleSignOut() {
    await createClient().auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 p-8 shadow-sm space-y-5">
        <div className="text-center">
          <ShieldCheck size={24} className="mx-auto text-indigo-500 mb-2" />
          <h1 className="text-lg font-black text-slate-900">Two-factor authentication</h1>
          <p className="text-sm text-slate-500 mt-1">
            {setup?.qrCode ? 'Scan this code with your authenticator app, then enter the 6-digit code.' : 'Enter the 6-digit code from your authenticator app.'}
          </p>
        </div>

        {setup?.qrCode && (
          <div className="space-y-2">
            <Image src={setup.qrCode} alt="Authenticator QR code" width={192} height={192} unoptimized className="mx-auto" />
            <p className="text-[11px] font-mono text-slate-400 text-center break-all">{setup.secret}</p>
          </div>
        )}

        <form onSubmit={handleVerify} className="space-y-3">
          <input
            value={code}
            onChange={e => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {error && <p className="text-sm text-rose-600 text-center">{error}</p>}
          <button type="submit" disabled={!setup || code.trim().length !== 6 || verifying}
            className="w-full rounded-full bg-indigo-600 text-white font-black px-6 py-2.5 text-sm disabled:opacity-50">
            {verifying ? 'Verifying…' : 'Verify'}
          </button>
        </form>

        <button type="button" onClick={handleSignOut} className="w-full text-xs text-slate-400 hover:text-slate-600">
          Sign out
        </button>
      </div>
    </div>
  );
}
