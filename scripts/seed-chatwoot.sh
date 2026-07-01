#!/usr/bin/env bash
# seed-chatwoot.sh — Provision labels, canned responses, and automation rules
# for the ProjectSites support desk at support.projectsites.dev.
#
# Prerequisites:
#   1. Chatwoot deployed + onboarding completed (admin user exists)
#   2. flyctl installed + authenticated
#
# Usage:
#   ./scripts/seed-chatwoot.sh
#   DRY_RUN=1 ./scripts/seed-chatwoot.sh          # preview only
#   FORCE=1  ./scripts/seed-chatwoot.sh           # skip confirmation
#
# What this creates:
#   - 10 support labels (billing, dns, launch-blocker, editor, ai, bug,
#     feature-request, vip, refund-risk, human-needed)
#   - 10 saved replies (domain setup, DNS propagation, login help, launch
#     timeline, billing FAQ, refund policy, investigating incident, handoff
#     to human, screenshot request, registrar access request)
#   - Basic automation rule: VIP customers → priority queue

set -euo pipefail

APP="support-chatwoot"
DRY_RUN="${DRY_RUN:-0}"
FORCE="${FORCE:-0}"

log() { printf '[seed-chatwoot] %s\n' "$*" >&2; }

run_console() {
  local cmd="$1"
  local desc="$2"
  if [[ "${DRY_RUN}" == "1" ]]; then
    printf '[DRY_RUN] %s\n' "${desc}"
    return
  fi
  log "Running: ${desc}"
  flyctl ssh console --app "${APP}" --command "bundle exec rails runner '${cmd}'" 2>&1
}

# ─────────────────────────────────────────────────────────────
# Labels
# ─────────────────────────────────────────────────────────────

create_labels() {
  log "Creating ProjectSites support labels..."

  run_console "
    account = Account.first
    return unless account

    labels = {
      'billing'         => { desc: 'Billing, invoices, plans, payments', color: '#f59e0b' },
      'dns'             => { desc: 'Domain setup, DNS records, SSL certificates', color: '#3b82f6' },
      'launch-blocker'  => { desc: 'Site cannot launch — critical blocker', color: '#ef4444' },
      'editor'          => { desc: 'bolt.diy editor, code generation, preview', color: '#8b5cf6' },
      'ai'              => { desc: 'AI features, prompt quality, model behavior', color: '#06b6d4' },
      'bug'             => { desc: 'Unexpected behavior, error messages, crashes', color: '#dc2626' },
      'feature-request' => { desc: 'New feature or improvement ideas', color: '#10b981' },
      'vip'             => { desc: 'High-value customer — priority handling', color: '#fbbf24' },
      'refund-risk'     => { desc: 'Refund request or cancellation risk', color: '#f97316' },
      'human-needed'    => { desc: 'AI cannot resolve — escalate to human', color: '#e11d48' },
    }

    labels.each do |title, attrs|
      account.labels.find_or_create_by!(title: title) do |l|
        l.description = attrs[:desc]
        l.color       = attrs[:color]
      end
    end
    puts \"✓ Created #{labels.size} labels\"
  " "Create 10 support labels"
}

# ─────────────────────────────────────────────────────────────
# Saved Replies (Canned Responses)
# ─────────────────────────────────────────────────────────────

create_canned_responses() {
  log "Creating ProjectSites saved replies..."

  run_console "
    account = Account.first
    return unless account

    replies = {
      'domain_setup' => {
        short: 'domain_setup',
        text: 'To connect your custom domain to ProjectSites, follow these steps:

1. Go to your domain registrar (GoDaddy, Namecheap, Cloudflare, etc.)
2. Find the DNS management section
3. Add a CNAME record pointing your domain to: {your-site}.projectsites.dev
4. Wait up to 24-48 hours for DNS propagation (usually happens in minutes)

Need more specific help? Let me know your domain registrar and domain name.'
      },
      'dns_propagation' => {
        short: 'dns_propagation',
        text: 'DNS changes typically take 5-30 minutes to propagate, though some providers can take up to 48 hours.

You can check propagation status at: https://www.whatsmydns.net/

If it has been more than an hour and your site still is not resolving, please share:
- Your domain name
- Your domain registrar
- A screenshot of the DNS record you added

We will investigate right away.'
      },
      'login_help' => {
        short: 'login_help',
        text: 'Here is how to access your ProjectSites account:

1. Go to: https://projectsites.dev
2. Click "Sign In" in the top right
3. Enter your email — we will send a magic link
4. Check your inbox (and spam folder) for the link
5. Click the link to sign in

If you are not receiving the magic link, try:
- Checking your spam/junk folder
- Adding noreply@projectsites.dev to your contacts
- Using a different email address if you signed up with another one'
      },
      'launch_timeline' => {
        short: 'launch_timeline',
        text: 'Here is the ProjectSites launch timeline:

1. **Site Generated** — Our AI builds your custom website in ~15 minutes
2. **Review & Edit** — You review and make changes (unlimited edits)
3. **Connect Domain** — Add your custom domain (takes 5-30 minutes for DNS)
4. **Go Live** — Your site is live!

The full process from signup to live site typically takes under an hour. If your domain DNS has been set up for more than 30 minutes and the site is still not loading, please let us know your domain and we will check the DNS configuration.'
      },
      'billing_faq' => {
        short: 'billing_faq',
        text: 'Here are answers to common billing questions:

**What plan am I on?**
Log into your dashboard at https://projectsites.dev and go to Account → Billing.

**How do I upgrade/downgrade?**
Visit Account → Billing → Change Plan. Changes take effect at the next billing cycle.

**Can I get a refund?**
We offer refunds within 7 days of purchase. Contact us with your account email and we will process it within 2-3 business days.

**What payment methods do you accept?**
We accept all major credit/debit cards through Stripe.'
      },
      'refund_policy' => {
        short: 'refund_policy',
        text: 'We offer a 7-day refund policy for all ProjectSites plans.

To request a refund:
1. Reply to this conversation with your request
2. Include your account email
3. We will process within 2-3 business days

Your site will remain active during the refund processing. If you have any questions about what plan is right for you, we are happy to help before you cancel.'
      },
      'investigating' => {
        short: 'investigating',
        text: 'Thank you for reporting this — we are actively investigating.

Our team is looking into the issue now. We will update you within the next 2 hours with:
- What we have found
- What we are doing to fix it
- An estimated resolution time

Your site and data are safe. If this is urgent (your site is completely down), please reply and mention "urgent" and we will escalate immediately.'
      },
      'handoff_human' => {
        short: 'handoff_human',
        text: 'This conversation has been escalated to our support team.

A human agent will review your conversation and respond within 4 business hours (usually much faster).

In the meantime, you might find these resources helpful:
- Help Center: https://support.projectsites.dev
- Launch Guide: docs/how-to-launch
- FAQ: docs/faq

Reference: Your conversation history has been preserved, so you won\'t need to repeat anything.'
      },
      'screenshot_request' => {
        short: 'screenshot_request',
        text: 'To help us diagnose the issue, could you please send a screenshot?

Here is how:
- **Mac:** Press Cmd+Shift+4, then click and drag to select the area
- **Windows:** Press Windows+Shift+S, then click and drag
- **iPhone/iPad:** Press the side button + volume up at the same time
- **Android:** Press power + volume down at the same time

Please also let us know:
- What browser and version you are using (Chrome, Safari, Firefox, etc.)
- What device you are on (laptop, phone, tablet)'
      },
      'registrar_access' => {
        short: 'registrar_access',
        text: 'To set up your domain, we will need access to your domain registrar.

Please share:
1. **Domain registrar** — Where did you buy your domain? (GoDaddy, Namecheap, Google Domains, Cloudflare, etc.)
2. **Domain name** — What is the domain you want to connect?
3. **Access** — If you are comfortable sharing temporary access, we can configure DNS for you. Otherwise, we will send you the exact records to add.

We never store your registrar credentials. If you share access, change your password afterward for security.'
      },
    }

    replies.each do |key, attrs|
      account.canned_responses.find_or_create_by!(short_code: attrs[:short]) do |cr|
        cr.content = attrs[:text]
      end
    end
    puts \"✓ Created #{replies.size} saved replies\"
  " "Create 10 saved replies"
}

# ─────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────

main() {
  log "Seeding Chatwoot support desk at ${APP}"
  log "DRY_RUN=${DRY_RUN}"

  if [[ "${FORCE}" != "1" ]] && [[ "${DRY_RUN}" != "1" ]]; then
    echo ""
    echo "This will create labels and saved replies in the Chatwoot account."
    echo "Make sure onboarding is complete and an admin user exists."
    echo ""
    echo -n "Continue? [y/N] "
    read -r confirm
    if [[ ! "${confirm}" =~ ^[Yy]$ ]]; then
      log "Aborted."
      exit 0
    fi
  fi

  create_labels
  create_canned_responses

  log ""
  log "Done. Labels and saved replies are provisioned."
  log "Verify: https://support.projectsites.dev/app/settings/labels"
  log "Verify: https://support.projectsites.dev/app/settings/canned-responses"
}

main "$@"
