/**
 * The OpenMRS REST API of a server for the scripts, with the login from OPENMRS_USER and OPENMRS_PASSWORD. It returns
 * the status and the parsed body of each call, and does not throw for an HTTP error.
 */
import type { Rest } from '../packages/nexo-forms/src/dictionary.ts';

export function openmrsRest(server: string): Rest {
  if (!process.env.OPENMRS_USER || !process.env.OPENMRS_PASSWORD) throw new Error('Set OPENMRS_USER and OPENMRS_PASSWORD to an OpenMRS login.');
  const base = server.replace(/\/$/, '') + '/ws/rest/v1';
  const auth = 'Basic ' + Buffer.from(`${process.env.OPENMRS_USER}:${process.env.OPENMRS_PASSWORD}`).toString('base64');
  return async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { Authorization: auth, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await r.text();
    let parsed: unknown = text;
    try { parsed = text ? JSON.parse(text) : undefined; } catch { /* keep the text: an error page */ }
    return { status: r.status, body: parsed };
  };
}
