#!/usr/bin/env bash
set -euo pipefail

# Usage:
# ./scripts/rewards.sh
#
# Reads files/allocations.csv and writes files/rewards.csv, both relative
# to the current directory. Creates files/ when it is missing.
# Exits non-zero when files/allocations.csv is missing.
#
# One output row per reward vault address. The two percentage columns are
# JavaScript numbers printed with Number.prototype.toString.

mkdir -p files

if [[ ! -f files/allocations.csv ]]; then
  echo "Error: files/allocations.csv not found" >&2
  exit 1
fi

node <<'EOF'
const fs = require("fs");

const inputPath = "files/allocations.csv";
const outputPath = "files/rewards.csv";
const header =
  "address,name,protocol,validatorsDirectingRewards,validatorsDirectingPercentage,bgtDirectingPercentage";

function parseCsvLine(line) {
  if (line.endsWith("\r")) line = line.slice(0, -1);
  const fields = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}

function fieldAt(fields, index) {
  return index < fields.length ? fields[index] : "";
}

const text = fs.readFileSync(inputPath, "utf8");
const records = text.split("\n").slice(1);
const recordCount = records.length;

const order = [];
const byAddress = new Map();

for (const record of records) {
  const fields = parseCsvLine(record);
  for (let slot = 0; slot < 10; slot++) {
    const base = 3 + slot * 5;
    const address = fieldAt(fields, base);
    if (address === "") continue;
    const name = fieldAt(fields, base + 1);
    const protocol = fieldAt(fields, base + 2);
    const percentageRaw = fieldAt(fields, base + 4);
    const percentage = percentageRaw === "" ? 0 : Number(percentageRaw);

    let entry = byAddress.get(address);
    if (entry === undefined) {
      entry = {
        address,
        name,
        protocol,
        count: 0,
        sum: 0,
        index: order.length,
      };
      byAddress.set(address, entry);
      order.push(entry);
    }
    entry.count += 1;
    entry.sum += percentage;
  }
}

for (const entry of order) {
  entry.validatorsDirectingPercentage = (entry.count / recordCount) * 100;
  entry.bgtDirectingPercentage = entry.sum / recordCount;
}

order.sort((a, b) => {
  if (a.validatorsDirectingPercentage < b.validatorsDirectingPercentage) return 1;
  if (a.validatorsDirectingPercentage > b.validatorsDirectingPercentage) return -1;
  return a.index - b.index;
});

const lines = [header];
for (const entry of order) {
  lines.push(
    [
      entry.address,
      entry.name,
      entry.protocol,
      String(entry.count),
      entry.validatorsDirectingPercentage.toString(),
      entry.bgtDirectingPercentage.toString(),
    ].join(","),
  );
}

fs.writeFileSync(outputPath, lines.join("\n"));
EOF
