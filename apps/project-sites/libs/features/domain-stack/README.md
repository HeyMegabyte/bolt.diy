# domain-stack — Domain Stack Wizard

One-click domain: DNS + SSL + DMARC/SPF/DKIM/MX + GSC, 7-step state machine.

- **Flag key**: `domain_stack_wizard`
- **Lifecycle**: `alpha`
- **Owner**: brian@megabyte.space

## Tests
- `e2e/domain-management.spec.ts`
- `e2e/domain-stack/domain-stack.spec.ts`
- `e2e/_fortress/domain-stack/` — adversarial attack surface
