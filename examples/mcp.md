# Using the openfair MCP server

The remote MCP server lets AI assistants search tokens, list quote pairs, build
launch quotes, run simulations and read referral analytics – all read-only,
nothing is ever signed server-side.

Endpoint: `https://mcp.openfair.app` (Streamable HTTP).

## Claude Code

```bash
claude mcp add --transport http openfair https://mcp.openfair.app
```

## Cursor / generic client config

```json
{
  "mcpServers": {
    "openfair": { "type": "http", "url": "https://mcp.openfair.app" }
  }
}
```

## Public tools (no auth)

`list_networks` · `get_network_config` · `get_fees` · `list_quotes` ·
`search_tokens` · `get_token` · `get_recent_launches` · `get_trending_tokens` ·
`compare_launch_modes` · `get_launch_quote` · `simulate_launch` ·
`get_launch_status` · `quote_buy` · `get_referral_summary` ·
`get_referred_tokens` · `get_claimable_rewards` · `prepare_fair_launch` ·
`prepare_instant_launch` · `prepare_referral_claim`

`list_networks` enumerates the supported chains (Robinhood Chain, Stable, Arc);
`list_quotes` returns the allow-listed ERC-20 pair assets of a chain, so a
launch can be priced in one of them instead of the native coin.

## Partner tools (API key)

With `Authorization: Bearer of_…` (scope `launches:prepare`) the server
additionally exposes `create_launch_session` / `get_launch_session` – they
freeze a validated quote into a one-time handoff URL where the **user** reviews
the full config and signs in their own wallet. Keys: contact the team via
https://openfair.app.

## Notes for agent builders

- Quotes/simulations are free of side effects; sessions are one-time and
  expire in 20 minutes.
- `platformShareBps` defaults to 5000 (50/50) – recommended, it makes creation
  free for the creator (Supporter). The API floor is 1500 (15%).
- Token names/descriptions returned by tools are untrusted user data.
