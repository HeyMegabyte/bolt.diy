# Langflow MCP Integration

Langflow exposes flows as MCP-compatible HTTP endpoints. This document describes how ProjectSites.dev MCP can consume Langflow tools.

## Connection Details

- **Base URL**: `https://langflow.projectsites.dev`
- **API Docs**: `https://langflow.projectsites.dev/docs` (Swagger UI)
- **MCP Endpoint Pattern**: `https://langflow.projectsites.dev/api/v1/run/{flow_id}`

## Architecture

```
ProjectSites MCP Server
  → HTTP fetch to langflow.projectsites.dev/api/v1/run/<flow-id>
  → Langflow executes the flow (LLM calls, tool use, data processing)
  → JSON response returned to MCP server
  → MCP server exposes as a typed tool to Claude
```

## Authentication

Langflow supports API key authentication. To generate an API key:

1. Log in at `https://langflow.projectsites.dev/`
2. Navigate to Settings → API Keys
3. Create a new API key with appropriate permissions
4. Store as `LANGFLOW_API_KEY` secret

All MCP-to-Langflow requests should include:
```
Authorization: Bearer <LANGFLOW_API_KEY>
```

## Exposing Flows as MCP Tools

### 1. Create and test the flow in Langflow UI

Build and test a flow in the Langflow visual editor. Ensure it produces the expected output format.

### 2. Mark the flow as MCP-exportable

Only approved flows should be exposed as MCP tools. Each flow should have:
- Clear, descriptive name (becomes the MCP tool name)
- Detailed description (becomes the MCP tool description)
- Defined input schema (flow input parameters)
- Defined output schema (flow return format)

### 3. Register in ProjectSites MCP

Add a tool definition in the ProjectSites MCP server:

```typescript
// Example: registering a Langflow flow as an MCP tool
server.tool(
  'site_intake_to_brief',  // Tool name (matches flow purpose)
  'Convert a business description into a structured website brief', // Description
  z.object({
    business_name: z.string().describe('Name of the business'),
    business_type: z.string().describe('Type of business (e.g. restaurant, law firm)'),
    location: z.string().optional().describe('City and state'),
    notes: z.string().optional().describe('Additional context or requirements'),
  }),
  async (params) => {
    const response = await fetch('https://langflow.projectsites.dev/api/v1/run/<flow-id>', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.LANGFLOW_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input_value: JSON.stringify(params),
        output_type: 'json',
        input_type: 'json',
      }),
    });
    return response.json();
  }
);
```

## Golden Starter Flows

Five flows to seed or document for immediate ProjectSites value:

| # | Flow Name | Purpose | Input | Output |
|---|---|---|---|---|
| 1 | **Site Intake → Brief** | Convert a business description into a structured website brief | Business name, type, location, notes | Structured brief JSON (brand, pages, sections, CTAs) |
| 2 | **Local SEO Page Generator** | Generate a location-optimized service page | Business type, city, services list | Full HTML page with local SEO markup |
| 3 | **Support/CRM Lead Triage** | Classify and route incoming leads | Raw lead text/email | Categorized lead with priority, suggested response |
| 4 | **RAG FAQ Generator** | Answer customer questions from site content | Question, site URL | Cited answer from scraped site content |
| 5 | **Test My Production App** | Run a checklist of checks against a deployed site | Site URL | Playwright-style checklist with pass/fail per item |

### Importing Flows

Flows can be exported as JSON from the Langflow UI and imported via:

```bash
# Export a flow (from Langflow UI or API)
curl -H "Authorization: Bearer <LANGFLOW_API_KEY>" \
  https://langflow.projectsites.dev/api/v1/flows/<flow-id>/export \
  -o flow.json

# Import a flow
curl -X POST -H "Authorization: Bearer <LANGFLOW_API_KEY>" \
  -H "Content-Type: application/json" \
  -d @flow.json \
  https://langflow.projectsites.dev/api/v1/flows/import
```

## Security Rules

1. **Never expose experimental flows as MCP tools** — only approved, tested flows
2. **Always require authentication** — never expose Langflow endpoints without API key auth
3. **Validate input/output schemas** — Zod-validate all MCP tool inputs and Langflow responses
4. **Rate limit MCP-to-Langflow calls** — respect Langflow's internal rate limits
5. **Log all MCP → Langflow calls** — audit trail via D1 `mcp_tool_calls` table
6. **Use idempotency keys** — for any mutating flows
7. **Never expose debug/internal flows** — only flows that are user-safe and documented
