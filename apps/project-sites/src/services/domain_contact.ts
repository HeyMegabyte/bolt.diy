/**
 * @module services/domain_contact
 * @description Domain contact validation — WHOIS-compatible contact data for
 * domain registration and transfer. A pure, deterministic module that validates
 * contact completeness per ICANN-required contact roles and formats contacts in
 * WHOIS-compatible multiline output.
 *
 * ICANN requires four contact roles for every gTLD domain: registrant (the owner),
 * admin (operational contact), tech (technical contact), and billing (financial contact).
 * Each role has a minimum set of required fields; this module enforces those requirements
 * before a domain registration/purchase/transfer is attempted.
 *
 * @packageDocumentation
 */

/** The four ICANN-mandated domain contact roles. */
export type ContactType = 'registrant' | 'admin' | 'tech' | 'billing';

/** A domain contact record matching the WHOIS contact-data shape. */
export interface DomainContact {
  /** ICANN contact role. */
  type: ContactType;
  /** Full name of the contact person. */
  name: string;
  /** Organization or legal entity name. */
  org: string;
  /** Email address (required for all roles). */
  email: string;
  /** Phone number in E.164 or local format. */
  phone: string;
  /** Postal address (street, city, state, ZIP, country). */
  address: string;
}

/**
 * Minimum required fields per contact role under ICANN gTLD rules.
 *
 * - **registrant** — every field is required (full legal identity).
 * - **admin** — name + email; org/phone/address are optional at registration but
 *   strongly recommended.
 * - **tech** — email only (reachable escalation point).
 * - **billing** — email only (invoice recipient).
 *
 * A field counts as present when its trimmed value is non-empty.
 */
export const REQUIRED_FIELDS: Record<ContactType, string[]> = {
  admin: ['name', 'email'],
  billing: ['email'],
  registrant: ['name', 'org', 'email', 'phone', 'address'],
  tech: ['email'],
} as const;

/** Human-readable labels used in WHOIS output — mirrors REQUIRED_FIELDS keys. */
const FIELD_LABELS: Record<string, string> = {
  address: 'Address',
  email: 'Email',
  name: 'Name',
  org: 'Organization',
  phone: 'Phone',
};

const ROLE_LABELS: Record<ContactType, string> = {
  admin: 'Admin',
  billing: 'Billing',
  registrant: 'Registrant',
  tech: 'Tech',
};

/**
 * Validate a domain contact against ICANN-required fields for its role.
 * Pure + deterministic; never throws.
 *
 * @param contact - The {@link DomainContact} to validate.
 * @returns An object with `valid` (boolean) and `errors` (array of human-readable
 *   strings describing every missing required field).
 *
 * @example
 * validateContact({ type: 'registrant', name: '', org: '', email: '', phone: '', address: '' });
 * // → { valid: false, errors: ['Name is required', 'Organization is required', 'Email is required', 'Phone is required', 'Address is required'] }
 *
 * @example
 * validateContact({ type: 'tech', name: '', org: '', email: 'noc@example.com', phone: '', address: '' });
 * // → { valid: true, errors: [] }
 */
export function validateContact(contact: DomainContact): { errors: string[]; valid: boolean } {
  const errors: string[] = [];
  const required = REQUIRED_FIELDS[contact.type];

  for (const field of required) {
    const value = (contact as unknown as Record<string, string>)[field]?.trim() ?? '';
    if (!value) {
      const label = FIELD_LABELS[field] ?? field;
      errors.push(`${label} is required`);
    }
  }

  return { errors, valid: errors.length === 0 };
}

/**
 * Format a domain contact as a WHOIS-compatible multiline string.
 * Produces lines in the standard `Role Field: Value` format used by ICANN WHOIS
 * output and domain-registration APIs (e.g. Squarespace Domains, Namecheap, etc.).
 *
 * Every present (non-empty) field is included; missing fields are omitted silently.
 *
 * @param contact - The {@link DomainContact} to format.
 * @returns A multiline string with one `Role Field: Value` per line, terminated by
 *   a newline. Never empty — at minimum the role-prefixed name is emitted.
 *
 * @example
 * formatWhoisContact({ type: 'registrant', name: 'Jane Doe', org: 'Acme Inc', email: 'jane@acme.com', phone: '+1.5551234567', address: '123 Main St, Newark, NJ 07102' });
 * // → 'Registrant Name: Jane Doe\nRegistrant Organization: Acme Inc\nRegistrant Email: jane@acme.com\nRegistrant Phone: +1.5551234567\nRegistrant Address: 123 Main St, Newark, NJ 07102\n'
 */
export function formatWhoisContact(contact: DomainContact): string {
  const roleLabel = ROLE_LABELS[contact.type];
  const lines: string[] = [];

  const keys: (keyof DomainContact)[] = ['name', 'org', 'email', 'phone', 'address'];
  for (const key of keys) {
    const value = contact[key]?.trim();
    if (value) {
      const label = FIELD_LABELS[key] ?? key;
      lines.push(`${roleLabel} ${label}: ${value}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}
