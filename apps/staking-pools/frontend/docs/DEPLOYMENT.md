# Deployment Guide

Deploy a branded staking pool frontend from clone to live site. This guide focuses on single-pool mode, which covers the typical deployment scenario.

## Prerequisites

- Staking pool contract address
- Validator public key (98 hex characters from the beacon chain)
- RPC endpoint for your target network (Bepolia testnet or mainnet)
- Hosting account
- Pool name for branding
- Logo file (optional; SVG recommended, 48x48px works well)

If you're unsure about the pool address or validator pubkey, check your deployment records or use the factory contract's `getCoreContracts(bytes pubkey)` function. The `generate-frontend-config.sh` script in `guides/apps/staking-pools/install-helpers/` can also generate these values for you.

## Clone and Configure

1. Clone the repository and install dependencies
2. Copy `public/config.example.json` to `public/config.json`
3. Configure network, branding, contracts, and pool details

Set the network section to match your deployment target. See [CONFIG_GUIDE.md](./CONFIG_GUIDE.md#network-presets) for network presets and current contract addresses.

In the pools section, add your pool details. Set `mode` to `"single"` and add a pool entry under the `pools` object. The `name` field is what users see, `stakingPool` is your contract address, `validatorPubkey` is the 98-character hex public key, and `enabled` should be `true`. The delegation handler can be left as `0x0000000000000000000000000000000000000000` if you're not running a delegated pool or don't want to mention it.

## Branding

Set `branding.name` to your pool's display name and `branding.logo` to the logo path (or `null`). Logo paths are relative to `public`, so `/branding/logo.svg` references `public/branding/logo.svg`.

For theme colors, set `branding.theme` to a preset (`"blue"`, `"purple"`, `"green"`, `"orange"`, `"teal"`, `"coral"`, `"indigo"`, `"emerald"`, `"cyan"`, or `"slate"`). Presets correspond to `public/theme-overrides.example-<theme>.css` files. For custom colors, leave `theme` as `null` and edit `public/theme-overrides.css` to override CSS variables. See [CONFIG_GUIDE.md](./CONFIG_GUIDE.md#branding) for details.

## Build

Run `npm run build`. The output in `dist/` contains your static site. Test locally with `npm run preview` before deploying. The build copies `config.json` and `public/` assets to `dist/`; verify your config is correct first, because fixing it after deployment requires either rebuilding or editing files on the server, and you're better than that.

## Deploy to Vercel

Vercel is the simplest option. Install the CLI with `npm i -g vercel`, then run `vercel` from your project directory and follow the prompts. Vercel detects the Vite setup automatically. For production, run `vercel --prod`. Your site goes live at a `*.vercel.app` domain immediately; add a custom domain in the dashboard.

Vercel handles SPA routing automatically. If you see 404s on refresh, check that the framework preset is Vite and rewrites serve `index.html` for all routes. This is usually automatic, but Vercel's detection sometimes fails when you're in a hurry.

## Deploy to nginx

For self-hosted deployments, copy `dist/` contents to your server. Typical locations are `/var/www/your-pool-name` or `/usr/share/nginx/html/your-pool-name`, though you probably have opinions about this. Create an nginx config at `/etc/nginx/sites-available/your-pool-name`:

Here's a minimal configuration:

```nginx
server {
    listen 80;
    server_name your-pool-domain.com;
    root /var/www/your-pool-name;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

1. Enable the site: `ln -s /etc/nginx/sites-available/your-pool-name /etc/nginx/sites-enabled/`
2. Test the configuration: `nginx -t`
3. Reload nginx: `systemctl reload nginx` or `service nginx reload`

For HTTPS, consider using Let's Encrypt with certbot to obtain certificates, then update the server block to listen on port 443 with SSL configuration.

## Troubleshooting

1. **RPC connection failures:** Verify the URL in `config.json` is correct and accessible from your deployment environment. Test with `curl` to confirm it responds. Some providers require API keys or have rate limits that kick in at the worst possible moment. CORS errors mean the RPC server isn't allowing requests from your domain; contact your provider or use one that supports browser requests.

2. **Contract address mistakes:** Verify the staking pool address matches your deployed contract and is correct for the network in your config. The validator pubkey must be exactly 98 hex characters (0x prefix plus 96 characters).

3. **Build failures:** Validate `config.json` syntax with a linter before building. If `npm install` fails, check your Node.js version (18+ recommended). Missing file warnings mean referenced assets in `public/` don't exist.

4. **Config not loading:** If the site shows "Loading..." indefinitely, check that `config.json` exists in the deployed `dist/` directory. Browser developer tools show 404 errors if the file is missing or in the wrong location.
