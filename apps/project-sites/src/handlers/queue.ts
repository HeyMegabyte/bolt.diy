/**
 * Queue message handler
 */
import type { QueueMessage, CloudflareBindings } from '../types.js';

export async function handleQueueMessage(
  message: QueueMessage,
  env: CloudflareBindings
): Promise<void> {
  console.log(`Processing queue message: ${message.type}`, {
    request_id: message.metadata.request_id,
    attempt: message.metadata.attempt,
  });

  switch (message.type) {
    case 'site_generation':
      await handleSiteGeneration(message, env);
      break;

    case 'lighthouse':
      await handleLighthouse(message, env);
      break;

    case 'dunning_notification':
      await handleDunningNotification(message, env);
      break;

    case 'webhook_replay':
      await handleWebhookReplay(message, env);
      break;

    case 'smoke_test':
      await handleSmokeTest(message, env);
      break;

    default:
      console.warn(`Unknown queue message type: ${message.type}`);
  }
}

async function handleSiteGeneration(
  message: QueueMessage,
  env: CloudflareBindings
): Promise<void> {
  const { org_id, site_id, business_name } = message.payload as {
    org_id: string;
    site_id: string;
    business_name: string;
  };

  console.log(`Generating site for: ${business_name}`);

  // TODO: Implement site generation workflow
  // 1. Run AI microtasks (NAP verification, content generation, etc.)
  // 2. Build static site with Astro
  // 3. Upload to R2
  // 4. Run Lighthouse
  // 5. Send "site ready" notification

  // Placeholder: Store a simple HTML file
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${business_name}</title>
      <style>
        body { font-family: system-ui, sans-serif; margin: 0; padding: 0; }
        .hero { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f5f5f5; }
        h1 { font-size: 3rem; color: #333; }
      </style>
    </head>
    <body>
      <div class="hero">
        <h1>${business_name}</h1>
      </div>
    </body>
    </html>
  `;

  const r2Path = `sites/${site_id}`;
  await env.SITES_BUCKET.put(`${r2Path}/index.html`, html, {
    httpMetadata: { contentType: 'text/html' },
  });

  // Update site record
  // Note: In real implementation, use Supabase client
  console.log(`Site generated: ${r2Path}`);
}

async function handleLighthouse(
  message: QueueMessage,
  env: CloudflareBindings
): Promise<void> {
  const { site_id, site_url } = message.payload as {
    site_id: string;
    site_url: string;
  };

  console.log(`Running Lighthouse for: ${site_url}`);

  // TODO: Implement Lighthouse check
  // 1. Run Lighthouse via PageSpeed Insights API
  // 2. Store results in database
  // 3. If score < 90, queue AI fix job
  // 4. If score >= 90, mark site as ready

  console.log('Lighthouse check complete (placeholder)');
}

async function handleDunningNotification(
  message: QueueMessage,
  env: CloudflareBindings
): Promise<void> {
  const { org_id, invoice_id, amount_due } = message.payload as {
    org_id: string;
    invoice_id: string;
    amount_due: number;
  };

  console.log(`Sending dunning notification for org: ${org_id}`);

  // TODO: Implement dunning notification
  // 1. Get org details
  // 2. Determine dunning stage
  // 3. Send appropriate notification via Chatwoot/SendGrid
  // 4. Update dunning state

  console.log('Dunning notification sent (placeholder)');
}

async function handleWebhookReplay(
  message: QueueMessage,
  env: CloudflareBindings
): Promise<void> {
  const { webhook_event_id, provider, event_type } = message.payload as {
    webhook_event_id: string;
    provider: string;
    event_type: string;
  };

  console.log(`Replaying webhook: ${provider} ${event_type}`);

  // TODO: Implement webhook replay
  // 1. Get webhook event from database
  // 2. Get payload from R2 if needed
  // 3. Re-process the webhook

  console.log('Webhook replay complete (placeholder)');
}

async function handleSmokeTest(
  message: QueueMessage,
  env: CloudflareBindings
): Promise<void> {
  const { triggered_by } = message.payload as {
    triggered_by: string;
  };

  console.log(`Running smoke test, triggered by: ${triggered_by}`);

  // TODO: Implement smoke test
  // 1. Create test intake
  // 2. Wait for site generation
  // 3. Check site is accessible
  // 4. Run Lighthouse
  // 5. Report results

  console.log('Smoke test complete (placeholder)');
}
