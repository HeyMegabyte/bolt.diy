/**
 * @module services/smtp_config
 * @description Pure, deterministic SMTP configuration builder. Assembles typed
 * {@link SmtpConfig} objects from raw host/port/credentials, validates them
 * against common SMTP rules (non-empty fields, port range, no empty password),
 * and produces connection strings for use by Nodemailer / workers / CLIs.
 *
 * @packageDocumentation
 */

/** Port number used for implicit TLS (SMTPS). */
export const PORT_SMTPS = 465 as const;

/** Port number used for STARTTLS (submission). */
export const PORT_SUBMISSION = 587 as const;

/**
 * Port number used for plain-text SMTP (no encryption).
 * @deprecated Most SMTP providers require encryption on 465 or 587.
 */
export const PORT_PLAIN = 25 as const;

/** Standard SMTP ports. */
export type SmtpPort = 25 | 465 | 587;

/** The TLS mode implied by the port selection. */
export type SmtpSecurity = 'tls' | 'starttls' | 'none';

/** A fully-assembled SMTP configuration. */
export interface SmtpConfig {
  /** SMTP server hostname or IP address. */
  host: string;
  /** TCP port (typically 25, 465, or 587). */
  port: SmtpPort;
  /** Authentication username (often a full email address). */
  user: string;
  /** Authentication password or app-specific token. */
  pass: string;
  /**
   * Whether this config uses TLS.
   * Derived from the port: 465 → true, 587/25 → false (STARTTLS is handled
   * at connection time, not at config level).
   */
  secure: boolean;
  /**
   * The TLS security mode implied by the port.
   * - 465 → `'tls'` (implicit TLS)
   * - 587 → `'starttls'` (explicit upgrade)
   * - 25  → `'none'`
   */
  security: SmtpSecurity;
}

/**
 * Single validation finding for an SMTP config.
 */
export interface SmtpValidationFinding {
  /** The field that failed validation. */
  field: keyof SmtpConfig | 'base';
  /** Human-readable explanation of the issue. */
  message: string;
  /** Stable error code for programmatic handling. */
  code: string;
}

/**
 * Build a typed {@link SmtpConfig} from raw connection parameters.
 * Pure — never throws, never performs I/O. The `secure` and `security` fields
 * are derived from the port.
 *
 * @param host - SMTP server hostname (e.g. "smtp.sendgrid.net").
 * @param port - TCP port (defaults to 587). Values outside the standard set
 *   are accepted but should be validated separately.
 * @param user - Authentication username.
 * @param pass - Authentication password or app token.
 * @returns A fully-populated {@link SmtpConfig}.
 *
 * @example
 * buildSmtpConfig('smtp.sendgrid.net', 587, 'apikey', 'SG.xxxxx');
 * // => {
 * //   host: 'smtp.sendgrid.net',
 * //   port: 587,
 * //   user: 'apikey',
 * //   pass: 'SG.xxxxx',
 * //   secure: false,
 * //   security: 'starttls',
 * // }
 *
 * @example
 * buildSmtpConfig('smtp.gmail.com', 465, 'user@gmail.com', 'app-password');
 * // => { host: 'smtp.gmail.com', port: 465, secure: true, security: 'tls', ... }
 */
export function buildSmtpConfig(
  host: string,
  port: number = PORT_SUBMISSION,
  user: string,
  pass: string,
): SmtpConfig {
  const secure = port === PORT_SMTPS;
  const security: SmtpSecurity = port === PORT_SMTPS ? 'tls' : port === PORT_PLAIN ? 'none' : 'starttls';

  return {
    host,
    pass,
    port: port as SmtpPort,
    secure,
    security,
    user,
  };
}

/**
 * Validate an {@link SmtpConfig} and return a list of findings.
 * Returns an empty array when the config is valid. Pure — never throws.
 *
 * Checks performed:
 * - `host` must be a non-empty string.
 * - `host` must contain at least one dot (basic FQDN sanity check).
 * - `port` must be a number between 1 and 65535.
 * - `user` must be a non-empty string.
 * - `pass` must be a non-empty string.
 *
 * @param config - The SMTP config to validate.
 * @returns An array of {@link SmtpValidationFinding}. Empty = valid.
 *
 * @example
 * validateSmtp(buildSmtpConfig('', 587, 'u', 'p'));
 * // => [{ field: 'host', message: 'Host must not be empty', code: 'host_empty' }]
 *
 * @example
 * validateSmtp(buildSmtpConfig('smtp.example.com', 587, 'user', 'pass'));
 * // => []
 */
export function validateSmtp(config: SmtpConfig): readonly SmtpValidationFinding[] {
  const findings: SmtpValidationFinding[] = [];

  if (!config.host || config.host.trim().length === 0) {
    findings.push({ code: 'host_empty', field: 'host', message: 'Host must not be empty' });
  } else {
    const trimmed = config.host.trim();
    if (!trimmed.includes('.') && trimmed !== 'localhost') {
      findings.push({
        code: 'host_not_fqdn',
        field: 'host',
        message: 'Host should be a fully qualified domain name (e.g. smtp.example.com)',
      });
    }
  }

  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    findings.push({
      code: 'port_invalid',
      field: 'port',
      message: 'Port must be an integer between 1 and 65535',
    });
  }

  if (!config.user || config.user.trim().length === 0) {
    findings.push({ code: 'user_empty', field: 'user', message: 'Username must not be empty' });
  }

  if (!config.pass || config.pass.length === 0) {
    findings.push({ code: 'pass_empty', field: 'pass', message: 'Password must not be empty' });
  }

  return findings;
}

/**
 * Produce an SMTP connection URI string (RFC 3986-style) for use by
 * Nodemailer, the `nodemailer` transport, or CLI tools.
 *
 * The password is URI-encoded so that special characters (spaces, @, :, #, ?)
 * do not break the URL. The `secure` flag is encoded as a query parameter.
 *
 * @param config - The SMTP config to serialise.
 * @returns An RFC 3986 SMTP connection URI.
 *
 * @example
 * smtpConnectionString(buildSmtpConfig('smtp.sendgrid.net', 587, 'apikey', 'SG.foo'));
 * // => 'smtp://apikey:SG.foo@smtp.sendgrid.net:587?secure=false'
 *
 * @example
 * smtpConnectionString(buildSmtpConfig('smtp.gmail.com', 465, 'me@gmail.com', 'pass'));
 * // => 'smtp://me%40gmail.com:pass@smtp.gmail.com:465?secure=true'
 */
export function smtpConnectionString(config: SmtpConfig): string {
  const encodedUser = encodeURIComponent(config.user);
  const encodedPass = encodeURIComponent(config.pass);
  return `smtp://${encodedUser}:${encodedPass}@${config.host}:${config.port}?secure=${config.secure}`;
}
