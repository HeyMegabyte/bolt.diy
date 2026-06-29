/**
 * @module services/import_validator
 * @description Validates CSV import data for contacts, subscribers, leads, and products.
 * Each import type has a schema defining columns, required fields, type constraints,
 * and maximum row limits. The validator returns errors for invalid cells and warnings
 * for optional empty fields, filtering valid rows into a clean set.
 */

/* ------------------------------------------------------------------ */
/*  Export types                                                      */
/* ------------------------------------------------------------------ */

/** Supported import types for CSV data ingestion. */
export type ImportType = 'contacts' | 'subscribers' | 'leads' | 'products';

/** Schema definition for an import type. */
export interface ImportSchema {
  /** Column names in order. */
  columns: string[];
  /** Columns that must have a non-empty value. */
  required: string[];
  /** Per-column type constraint. */
  types: Record<string, 'string' | 'number' | 'email' | 'url' | 'date'>;
  /** Maximum number of rows allowed. */
  maxRows: number;
}

/* ------------------------------------------------------------------ */
/*  Schema definitions                                                */
/* ------------------------------------------------------------------ */

/** Canonical schema definitions for every supported import type.
 *
 * @example
 * import { IMPORT_SCHEMAS } from './import_validator.js';
 * console.log(IMPORT_SCHEMAS.contacts.maxRows); // 10000
 */
export const IMPORT_SCHEMAS: Record<ImportType, ImportSchema> = {
  contacts: {
    columns: ['name', 'email', 'phone'],
    maxRows: 10_000,
    required: ['name', 'email'],
    types: { email: 'email', name: 'string', phone: 'string' },
  },
  leads: {
    columns: ['business_name', 'address', 'phone'],
    maxRows: 10_000,
    required: ['business_name'],
    types: { address: 'string', business_name: 'string', phone: 'string' },
  },
  products: {
    columns: ['name', 'price', 'description'],
    maxRows: 5_000,
    required: ['name', 'price'],
    types: { description: 'string', name: 'string', price: 'number' },
  },
  subscribers: {
    columns: ['email', 'name'],
    maxRows: 50_000,
    required: ['email'],
    types: { email: 'email', name: 'string' },
  },
};

/* ------------------------------------------------------------------ */
/*  Type validators                                                   */
/* ------------------------------------------------------------------ */

/**
 * Checks whether a cell value passes its type constraint.
 *
 * @param value - The raw cell value to validate.
 * @param type - The expected type.
 * @param optional - Whether the column is optional (empty allowed).
 * @returns true if the value is valid for the given type.
 */
function isValidCell(
  value: string,
  type: 'string' | 'number' | 'email' | 'url' | 'date',
  optional: boolean,
): boolean {
  const trimmed = value.trim();

  if (trimmed === '') {
    return optional; // only valid if the column is optional
  }

  switch (type) {
    case 'string': {
      return trimmed.length > 0;
    }
    case 'number': {
      const num = Number(trimmed);
      return !Number.isNaN(num) && Number.isFinite(num) && trimmed !== '';
    }
    case 'email': {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
    }
    case 'url': {
      return /^https?:\/\/\S+$/i.test(trimmed);
    }
    case 'date': {
      const d = new Date(trimmed);
      return !Number.isNaN(d.getTime());
    }
    default:
      return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Main validator                                                    */
/* ------------------------------------------------------------------ */

/**
 * Validates a batch of import rows against the given import type schema.
 *
 * Each row is a map of column name to string value. The validator checks:
 * - That the rows array is non-empty.
 * - That the row count does not exceed the schema's maxRows.
 * - That every required column has a non-empty value.
 * - That every cell passes its type constraint.
 *
 * Rows with any error are excluded from `cleanRows`. Optional fields that
 * are empty produce a warning instead of an error.
 *
 * @param rows - Array of row objects keyed by column name.
 * @param type - The import type key from IMPORT_SCHEMAS.
 * @returns An object with overall validity, an array of error messages,
 *          an array of warning messages, and the subset of clean rows.
 *
 * @example
 * const rows = [
 *   { name: 'Alice', email: 'alice@example.com', phone: '555-0100' },
 *   { name: '', email: 'bad', phone: '' },
 * ];
 * const result = validateImport(rows, 'contacts');
 * console.log(result.valid); // false
 * console.log(result.errors);
 * // [ 'Row 2: name is required', 'Row 2: email must be a valid email' ]
 * console.log(result.cleanRows.length); // 1
 *
 * @throws Never throws — all validation errors are returned in the result.
 */
export function validateImport(
  rows: Record<string, string>[],
  type: ImportType,
): { valid: boolean; errors: string[]; warnings: string[]; cleanRows: Record<string, string>[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const schema = IMPORT_SCHEMAS[type];

  /* Empty input guard */
  if (rows.length === 0) {
    return { cleanRows: [], errors: ['No rows provided'], valid: false, warnings: [] };
  }

  /* Row count guard */
  if (rows.length > schema.maxRows) {
    errors.push(`Row count ${rows.length} exceeds maximum of ${schema.maxRows}`);
    return { cleanRows: [], errors, valid: false, warnings: [] };
  }

  const rowHasError: boolean[] = new Array(rows.length).fill(false);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowIndex = i + 1; // 1-based for user messages

    for (const col of schema.columns) {
      const value = row[col] ?? '';
      const trimmed = value.trim();
      const typeConstraint = schema.types[col] ?? 'string';
      const isRequired = schema.required.includes(col);
      const isOptional = !isRequired;

      /* Required field check */
      if (isRequired && trimmed === '') {
        errors.push(`Row ${rowIndex}: ${col} is required`);
        rowHasError[i] = true;
        continue;
      }

      /* Type validation */
      if (trimmed !== '' && !isValidCell(value, typeConstraint, isOptional)) {
        errors.push(`Row ${rowIndex}: ${col} must be a valid ${typeConstraint}`);
        rowHasError[i] = true;
        continue;
      }

      /* Warning for empty optional field */
      if (trimmed === '' && isOptional) {
        warnings.push(`Row ${rowIndex}: ${col} is empty (optional)`);
      }
    }
  }

  /* Build clean rows - only rows with zero errors */
  const cleanRows = rows.filter((_, idx) => !rowHasError[idx]);

  return {
    cleanRows,
    errors,
    valid: errors.length === 0,
    warnings,
  };
}
