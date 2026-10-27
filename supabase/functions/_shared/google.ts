// Token OAuth do Google para uma Service Account (JSON da chave em string),
// trocando um JWT assinado em RS256 pelo access token.
export async function getGoogleAccessToken(serviceAccountJson: string, scope: string): Promise<string> {
  const serviceAccount = JSON.parse(serviceAccountJson);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToBuffer(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } },
    false,
    ['sign']
  );

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    cryptoKey,
    new TextEncoder().encode(`${header}.${payload}`)
  );
  const jwt = `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await resp.json();
  if (!resp.ok || !data.access_token) {
    throw new Error(`Falha ao autenticar no Google: ${data.error_description ?? data.error ?? resp.status}`);
  }
  return data.access_token;
}

function pemToBuffer(pem: string): ArrayBuffer {
  const conteudo = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const bin = atob(conteudo);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function base64Url(source: string | Uint8Array): string {
  const b64 = typeof source === 'string' ? btoa(source) : btoa(String.fromCharCode(...source));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
