/**
 * Build the facility SOP from the shared national source and builder, prepare both with
 * Nexo Core, and check the prepared identities against the pins for the source and national build.
 * Output: build/protocol.json (the bundle the backend module serves and the compiler reads).
 */
import source from '../../../library/protocols/wip/2026-10-29-rwanda-baseline/hypertension-screening-assessment.rwanda-source.json';
import host from '../../../library/protocols/wip/2026-10-29-rwanda-baseline/hypertension-screening-assessment.rwanda-source.catalog.json';
import trust from '../../../library/protocols/wip/2026-10-29-rwanda-baseline/hypertension.facility.trust.json';
import { buildHypertensionFacility, buildHypertensionFacilityCatalog } from '../../../library/protocols/wip/2026-10-29-rwanda-baseline/hypertension.facility.ts';
import { defineCatalog, type CatalogExtension } from '../../../core/protocol/contracts.ts';
import { prepareProtocol } from '../../../core/protocol/validate.ts';

const PINS = {
  reference: 'sha256:f57a08d143082517519b1b48fb8bcdb3fe8ddfef676c499f885ebef6d2b50448',
  facility: 'sha256:7b277361f58cd538b356654dce56db47ca3e6439d954aa75cd4f60f4cbb648ca',
};
const catalog = defineCatalog(host.extension as unknown as CatalogExtension);
const reference = prepareProtocol(source, catalog);
if (!reference.ok) throw new Error(JSON.stringify(reference.diagnostics));
if (reference.protocol.content.identity !== PINS.reference) throw new Error(`RBCNCD24 source reference identity changed: ${reference.protocol.content.identity}`);
const facilityCatalog = buildHypertensionFacilityCatalog(reference.protocol);
const facility = prepareProtocol(buildHypertensionFacility(reference.protocol), facilityCatalog);
if (!facility.ok) throw new Error(JSON.stringify(facility.diagnostics));
if (facility.protocol.content.identity !== PINS.facility) throw new Error(`National facility 1.0 identity changed: ${facility.protocol.content.identity}`);

const bundle = {
  format: 'nexo-openmrs.bundle/v1',
  note: 'Draft for clinical review. Synthetic simulation authority only. Not for care.',
  content: facility.protocol.content,
  document: facility.protocol.document,
  catalog: { ...host.extension, objects: facilityCatalog.objects },
  trust: trust.trust,
};
await Bun.write(new URL('./build/protocol.json', import.meta.url), JSON.stringify(bundle));
console.log(`RBCNCD24 source reference ${reference.protocol.content.identity}`);
console.log(`National facility 1.0 ${facility.protocol.content.identity}`);
