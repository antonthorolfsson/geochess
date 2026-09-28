'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Toggle } from './ui';

type PushState = 'loading' | 'unsupported' | 'install' | 'off' | 'on' | 'blocked';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** iPhones and iPads only allow web push once the app is on the home screen. */
function needsInstall(): boolean {
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && !window.matchMedia('(display-mode: standalone)').matches;
}

/** Turns web push on or off for this browser. Hidden when the server or browser can't do push. */
export function NotificationsToggle() {
  const key = useQuery({ queryKey: ['push-key'], queryFn: api.pushKey, staleTime: Infinity });
  const [state, setState] = useState<PushState>('loading');
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState(needsInstall() ? 'install' : 'unsupported');
      return;
    }
    let cancelled = false;
    void navigator.serviceWorker.getRegistration().then(async (reg) => {
      if (cancelled) return;
      if (!reg) return setState('unsupported');
      setRegistration(reg);
      const sub = await reg.pushManager.getSubscription();
      if (!cancelled) setState(Notification.permission === 'denied' ? 'blocked' : sub ? 'on' : 'off');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const publicKey = key.data?.publicKey;
  if (!publicKey || state === 'loading' || state === 'unsupported') return null;
  if (state === 'install') {
    return (
      <p className="text-sm text-muted">
        To get notifications on an iPhone or iPad, add Geo Chess to your home screen from the Share menu.
      </p>
    );
  }

  const setOn = async (on: boolean) => {
    if (!registration) return;
    setBusy(true);
    setError(null);
    try {
      if (on) {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setState(permission === 'denied' ? 'blocked' : 'off');
          return;
        }
        const sub = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        await api.pushSubscribe(sub.toJSON());
        setState('on');
      } else {
        const sub = await registration.pushManager.getSubscription();
        if (sub) {
          await api.pushUnsubscribe(sub.endpoint);
          await sub.unsubscribe();
        }
        setState('off');
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Toggle
        checked={state === 'on'}
        disabled={busy || state === 'blocked'}
        onChange={(on) => void setOn(on)}
        label="Notifications on this device"
        description={
          state === 'blocked'
            ? 'Blocked in your browser settings.'
            : 'Wars declared on you, answers you need to give, your moves, accords and private messages.'
        }
      />
      {error && <p className="text-sm text-[#f19a92]">{error}</p>}
    </div>
  );
}
