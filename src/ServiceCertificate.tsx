import { useEffect, useState } from 'react';
import type { DiagnosticApi } from './Diagnostics.js';

type Certificate = { fingerprint: string; subject: string; issuer: string; validFrom: string; validTo: string };

export function ServiceCertificate({ api, service, onChanged }: {
  api: DiagnosticApi; service: { id: number; url: string; certificateTrust?: { fingerprint: string } };
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [certificate, setCertificate] = useState<Certificate>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const url = new URL(service.url).href;
  const root = 'admin/diagnostics/services/' + service.id;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setCertificate(undefined); setError('');
    void api<Certificate>(root + '/certificate', 'POST', { url }, controller.signal)
      .then(value => { if (!controller.signal.aborted) setCertificate(value); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [open, retry, url, root, api]);
  async function trust(fingerprint: string | null) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(root + '/tls', 'PUT', { url, fingerprint });
      await onChanged();
      setNotice(fingerprint ? 'Certificate saved for monitoring. Run a service check to update availability.' : 'Certificate trust removed. Standard HTTPS verification applies.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save certificate settings.'); }
    finally { setBusy(false); }
  }
  const matches = certificate?.fingerprint === service.certificateTrust?.fingerprint;
  const expired = certificate && Date.parse(certificate.validTo) < Date.now();
  return <details className="service-certificate" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{service.certificateTrust ? 'Certificate trusted for monitoring' : 'HTTPS certificate'}</summary>
    {open && <>
      {certificate ? <>
        <dl className="metric-grid certificate-details">
          <div><dt>Issued to</dt><dd>{certificate.subject}</dd></div>
          <div><dt>Issuer</dt><dd>{certificate.issuer}</dd></div>
          <div><dt>Expires</dt><dd>{new Date(certificate.validTo).toLocaleString()}{expired && ' · Expired'}</dd></div>
        </dl>
        <label>SHA-256 fingerprint<code className="certificate-fingerprint">{certificate.fingerprint}</code></label>
        {matches ? <p className="muted">This certificate is approved for this service’s uptime checks.</p>
          : <p className="muted">Compare this fingerprint with the service’s certificate before approving it for uptime checks.</p>}
      </> : !error && <p role="status">Reading certificate…</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="service-actions">
        {certificate && !matches && <button className="primary" disabled={busy} onClick={() => void trust(certificate.fingerprint)}>Trust certificate for monitoring</button>}
        {service.certificateTrust && <button disabled={busy} onClick={() => void trust(null)}>Remove certificate trust</button>}
        <button disabled={busy} onClick={() => setRetry(value => value + 1)}>Read certificate again</button>
      </div>
    </>}
  </details>;
}
