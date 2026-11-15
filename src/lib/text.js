export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function truncate(value, max = 180) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function redactSecrets(value, secrets = []) {
  let text = String(value ?? '');
  for (const secret of secrets) {
    if (secret && secret.length > 3) text = text.split(secret).join('[redacted]');
  }
  return text.slice(0, 500);
}

export function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
