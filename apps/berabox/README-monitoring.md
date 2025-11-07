# 📊 Berabox Monitoring Setup

This guide covers setting up monitoring for your Berabox installations using Prometheus and Grafana.

## Prometheus & Grafana Monitoring

Berabox automatically configures Prometheus scraping endpoints and provides Grafana dashboard generation for comprehensive monitoring of all installations.

**Generate monitoring configurations**:
```bash
bb debug
```

This generates a `prometheus.yml` in the `debug` directory you can directly install to prometheus. It will then scrape data out of your running processes.

**Example Prometheus setup**:
```bash
bb bb-testnet-reth start
bb debug
prometheus --config.file=debug/prometheus/prometheus.yml --storage.tsdb.path=./prometheus-data
```

This also generates a Grafana dashboard definition JSON in the `debug` directory you can upload to grafana and immediately get useful telemetry from the system.

## Grafana Dashboard Integration

Berabox generates a ready-to-import Grafana dashboard JSON file in the `debug` directory. This dashboard visualizes key metrics from all your running installations—think of it as a bear's-eye view of your node health, performance, and logs. You can upload this dashboard directly into Grafana for instant telemetry, no need to paw through manual setup.

**How the Dashboard and Datasource Integration Works:**

- The dashboard JSON uses a Prometheus datasource. To make the dashboard work out-of-the-box, Berabox can automatically discover or create the correct Prometheus datasource in your Grafana instance—no more guessing UUIDs or playing "datasource roulette."
- Berabox injects the discovered Prometheus datasource UUID into the dashboard JSON, so your graphs light up with data as soon as you import it. No more dashboards with empty panels—unless you like staring into the void.

## Setting Up Grafana API Access

To let Berabox work its magic, you need to provide API access to your Grafana instance. This allows Berabox to:
- Query existing datasources
- Create a Prometheus datasource if one doesn't exist
- Patch the dashboard JSON with the correct datasource UUID

**Steps:**

1. **Create a Grafana API Key:**
   - Log in to Grafana (usually at http://localhost:3000)
   - Go to: Configuration → API Keys
   - Click: "Add API key"
   - Fill in:
     - Name: `berabox-automation`
     - Role: `Editor` (required to create datasources and dashboards)
     - Time to live: `No expiration` or set an expiry
   - Copy the key (Grafana only shows it once—don't let it escape!)

2. **Install the API Key in Your Environment:**
   ```bash
   # Add these lines to your ~/.bashrc or ~/.zshrc
   export GRAFANA_API_KEY="your_api_key_here"
   export GRAFANA_URL="http://localhost:3000"
   
   # Reload your shell to apply changes
   source ~/.bashrc
   ```

3. **Verify API Access:**
   ```bash
   curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
     "$GRAFANA_URL/api/health"
   # If you see a healthy response, you're ready to bear down on dashboards!
   ```

**What Happens Next:**

- When you run `bb debug`, Berabox uses your API key to connect to Grafana, find or create the Prometheus datasource, and update the dashboard JSON with the correct UUID.
- You can then upload the dashboard JSON from `debug/grafana/` into Grafana, and it will immediately show live data from your nodes—no manual wiring required.
- If you ever wondered what a bear's favorite metric is, it's probably "honey per second," but you'll have to settle for node health and block times.
