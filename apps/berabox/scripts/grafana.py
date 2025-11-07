#!/usr/bin/env python3
"""
Grafana dashboard generator for Berabox installations.
Dynamically creates monitoring dashboards based on installation configurations.
"""

import json
import re
import sys
from pathlib import Path

# Hardcoded templates extracted using jq from grafana-template.json
# System Infrastructure template (panels[0])
SYSTEM_TEMPLATE = {
  "collapsed": True,
  "gridPos": {
    "h": 1,
    "w": 24,
    "x": 0,
    "y": 0
  },
  "id": 200,
  "panels": [
    {
      "datasource": {
        "type": "prometheus",
        "uid": "aeveen1aeky68e"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "palette-classic"
          },
          "custom": {
            "axisBorderShow": False,
            "axisCenteredZero": False,
            "axisColorMode": "text",
            "axisGridShow": True,
            "axisLabel": "",
            "axisPlacement": "auto",
            "barAlignment": 0,
            "barWidthFactor": 0.6,
            "drawStyle": "line",
            "fillOpacity": 0,
            "gradientMode": "none",
            "hideFrom": {
              "legend": False,
              "tooltip": False,
              "viz": False
            },
            "insertNulls": False,
            "lineInterpolation": "linear",
            "lineWidth": 1,
            "pointSize": 5,
            "scaleDistribution": {
              "type": "linear"
            },
            "showPoints": "auto",
            "spanNulls": False,
            "stacking": {
              "group": "A",
              "mode": "normal"
            },
            "thresholdsStyle": {
              "mode": "off"
            }
          },
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": 0
              }
            ]
          },
          "unit": "percentunit"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 5,
        "w": 11,
        "x": 0,
        "y": 1
      },
      "id": 201,
      "options": {
        "legend": {
          "calcs": [
            "lastNotNull"
          ],
          "displayMode": "table",
          "placement": "right",
          "showLegend": True,
          "sortBy": "Last *",
          "sortDesc": True
        },
        "tooltip": {
          "hideZeros": False,
          "mode": "multi",
          "sort": "desc"
        }
      },
      "pluginVersion": "12.1.1",
      "targets": [
        {
          "disableTextWrap": False,
          "editorMode": "builder",
          "expr": "avg by(mode) (rate(node_cpu_seconds_total{mode!=\"idle\"}[5m]))",
          "fullMetaSearch": False,
          "includeNullMetadata": True,
          "legendFormat": "__auto",
          "range": True,
          "refId": "A",
          "useBackend": False
        }
      ],
      "title": "CPU Usage",
      "type": "timeseries"
    },
    {
      "datasource": {
        "type": "prometheus",
        "uid": "aeveen1aeky68e"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "palette-classic"
          },
          "custom": {
            "axisBorderShow": False,
            "axisCenteredZero": False,
            "axisColorMode": "text",
            "axisLabel": "",
            "axisPlacement": "auto",
            "barAlignment": 0,
            "barWidthFactor": 0.6,
            "drawStyle": "line",
            "fillOpacity": 0,
            "gradientMode": "none",
            "hideFrom": {
              "legend": False,
              "tooltip": False,
              "viz": False
            },
            "insertNulls": False,
            "lineInterpolation": "linear",
            "lineWidth": 1,
            "pointSize": 5,
            "scaleDistribution": {
              "type": "linear"
            },
            "showPoints": "auto",
            "spanNulls": False,
            "stacking": {
              "group": "A",
              "mode": "none"
            },
            "thresholdsStyle": {
              "mode": "off"
            }
          },
          "mappings": [],
          "min": 0,
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": 0
              },
              {
                "color": "red",
                "value": 80
              }
            ]
          },
          "unit": "decbytes"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 5,
        "w": 13,
        "x": 11,
        "y": 1
      },
      "id": 202,
      "options": {
        "legend": {
          "calcs": [
            "lastNotNull"
          ],
          "displayMode": "table",
          "placement": "right",
          "showLegend": True,
          "sortBy": "Last *",
          "sortDesc": True
        },
        "tooltip": {
          "hideZeros": False,
          "mode": "multi",
          "sort": "none"
        }
      },
      "pluginVersion": "12.1.1",
      "targets": [
        {
          "editorMode": "code",
          "expr": "node_memory_Active_bytes",
          "legendFormat": "active",
          "range": True,
          "refId": "A"
        },
        {
          "editorMode": "code",
          "expr": "node_memory_MemFree_bytes",
          "legendFormat": "free",
          "range": True,
          "refId": "B"
        },
        {
          "editorMode": "code",
          "expr": "node_memory_Cached_bytes\n",
          "legendFormat": "cached",
          "range": True,
          "refId": "C"
        }
      ],
      "title": "Memory Usage",
      "type": "timeseries"
    },
    {
      "datasource": {
        "type": "prometheus",
        "uid": "aeveen1aeky68e"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "palette-classic"
          },
          "custom": {
            "axisBorderShow": False,
            "axisCenteredZero": False,
            "axisColorMode": "text",
            "axisLabel": "",
            "axisPlacement": "auto",
            "barAlignment": 0,
            "barWidthFactor": 0.6,
            "drawStyle": "line",
            "fillOpacity": 0,
            "gradientMode": "none",
            "hideFrom": {
              "legend": False,
              "tooltip": False,
              "viz": False
            },
            "insertNulls": False,
            "lineInterpolation": "linear",
            "lineWidth": 1,
            "pointSize": 5,
            "scaleDistribution": {
              "type": "linear"
            },
            "showPoints": "auto",
            "spanNulls": False,
            "stacking": {
              "group": "A",
              "mode": "none"
            },
            "thresholdsStyle": {
              "mode": "off"
            }
          },
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": 0
              },
              {
                "color": "red",
                "value": 80
              }
            ]
          },
          "unit": "bytes"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 6,
        "w": 8,
        "x": 0,
        "y": 58
      },
      "id": 611,
      "options": {
        "legend": {
          "calcs": [
            "lastNotNull"
          ],
          "displayMode": "table",
          "placement": "right",
          "showLegend": True
        },
        "tooltip": {
          "hideZeros": False,
          "mode": "multi",
          "sort": "none"
        }
      },
      "pluginVersion": "12.1.1",
      "targets": [
        {
          "disableTextWrap": False,
          "editorMode": "builder",
          "expr": "node_filesystem_avail_bytes",
          "fullMetaSearch": False,
          "includeNullMetadata": True,
          "legendFormat": "{{device}}",
          "range": True,
          "refId": "A",
          "useBackend": False
        }
      ],
      "title": "Disk free",
      "type": "timeseries"
    },
    {
      "datasource": {
        "type": "prometheus",
        "uid": "aeveen1aeky68e"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "palette-classic"
          },
          "custom": {
            "axisBorderShow": False,
            "axisCenteredZero": False,
            "axisColorMode": "text",
            "axisLabel": "",
            "axisPlacement": "auto",
            "barAlignment": 0,
            "barWidthFactor": 0.6,
            "drawStyle": "line",
            "fillOpacity": 0,
            "gradientMode": "none",
            "hideFrom": {
              "legend": False,
              "tooltip": False,
              "viz": False
            },
            "insertNulls": False,
            "lineInterpolation": "linear",
            "lineWidth": 1,
            "pointSize": 5,
            "scaleDistribution": {
              "type": "linear"
            },
            "showPoints": "auto",
            "spanNulls": False,
            "stacking": {
              "group": "A",
              "mode": "none"
            },
            "thresholdsStyle": {
              "mode": "off"
            }
          },
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": 0
              }
            ]
          },
          "unit": "Bps"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 6,
        "w": 8,
        "x": 8,
        "y": 58
      },
      "id": 203,
      "options": {
        "legend": {
          "calcs": [],
          "displayMode": "list",
          "placement": "right",
          "showLegend": True
        },
        "tooltip": {
          "hideZeros": False,
          "mode": "single",
          "sort": "none"
        }
      },
      "pluginVersion": "12.1.1",
      "targets": [
        {
          "disableTextWrap": False,
          "editorMode": "builder",
          "expr": "rate(node_disk_read_bytes_total[$__rate_interval])",
          "fullMetaSearch": False,
          "includeNullMetadata": False,
          "legendFormat": "{{device}} reads",
          "range": True,
          "refId": "A",
          "useBackend": False
        },
        {
          "disableTextWrap": False,
          "editorMode": "builder",
          "expr": "rate(node_disk_written_bytes_total[$__rate_interval])",
          "fullMetaSearch": False,
          "includeNullMetadata": False,
          "legendFormat": "{{device}} writes",
          "range": True,
          "refId": "B",
          "useBackend": False
        }
      ],
      "title": "Disk Data Throughput",
      "type": "timeseries"
    },
    {
      "datasource": {
        "type": "prometheus",
        "uid": "aeveen1aeky68e"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "palette-classic"
          },
          "custom": {
            "axisBorderShow": False,
            "axisCenteredZero": False,
            "axisColorMode": "text",
            "axisLabel": "",
            "axisPlacement": "auto",
            "barAlignment": 0,
            "barWidthFactor": 0.6,
            "drawStyle": "line",
            "fillOpacity": 0,
            "gradientMode": "none",
            "hideFrom": {
              "legend": False,
              "tooltip": False,
              "viz": False
            },
            "insertNulls": False,
            "lineInterpolation": "linear",
            "lineWidth": 1,
            "pointSize": 5,
            "scaleDistribution": {
              "type": "linear"
            },
            "showPoints": "auto",
            "spanNulls": False,
            "stacking": {
              "group": "A",
              "mode": "none"
            },
            "thresholdsStyle": {
              "mode": "off"
            }
          },
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": 0
              }
            ]
          },
          "unit": "ops"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 6,
        "w": 8,
        "x": 16,
        "y": 58
      },
      "id": 612,
      "options": {
        "legend": {
          "calcs": [],
          "displayMode": "list",
          "placement": "right",
          "showLegend": True
        },
        "tooltip": {
          "hideZeros": False,
          "mode": "single",
          "sort": "none"
        }
      },
      "pluginVersion": "12.1.1",
      "targets": [
        {
          "disableTextWrap": False,
          "editorMode": "builder",
          "expr": "rate(node_disk_writes_completed_total[$__rate_interval])",
          "fullMetaSearch": False,
          "includeNullMetadata": False,
          "legendFormat": "{{device}} writes",
          "range": True,
          "refId": "A",
          "useBackend": False
        },
        {
          "disableTextWrap": False,
          "editorMode": "builder",
          "expr": "rate(node_disk_reads_completed_total[$__rate_interval])",
          "fullMetaSearch": False,
          "includeNullMetadata": False,
          "legendFormat": "{{device}} reads",
          "range": True,
          "refId": "B",
          "useBackend": False
        }
      ],
      "title": "Disk IOPS",
      "type": "timeseries"
    }
  ],
  "title": "System Infrastructure",
  "type": "row"
}

# Reth template (panels[1])
RETH_TEMPLATE = {
  "collapsed": True,
  "gridPos": {
    "h": 1,
    "w": 24,
    "x": 0,
    "y": 1
  },
  "id": 616,
  "panels": [
    {
      "datasource": {
        "type": "prometheus",
        "uid": "aeveen1aeky68e"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "palette-classic"
          },
          "custom": {
            "axisBorderShow": False,
            "axisCenteredZero": False,
            "axisColorMode": "text",
            "axisLabel": "",
            "axisPlacement": "auto",
            "barAlignment": 0,
            "barWidthFactor": 0.6,
            "drawStyle": "line",
            "fillOpacity": 0,
            "gradientMode": "none",
            "hideFrom": {
              "legend": False,
              "tooltip": False,
              "viz": False
            },
            "insertNulls": False,
            "lineInterpolation": "linear",
            "lineWidth": 1,
            "pointSize": 5,
            "scaleDistribution": {
              "type": "linear"
            },
            "showPoints": "auto",
            "spanNulls": False,
            "stacking": {
              "group": "A",
              "mode": "none"
            },
            "thresholdsStyle": {
              "mode": "off"
            }
          },
          "fieldMinMax": False,
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": 0
              }
            ]
          },
          "unit": "none"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 4,
        "w": 6,
        "x": 0,
        "y": 2
      },
      "id": 617,
      "options": {
        "legend": {
          "calcs": [
            "lastNotNull"
          ],
          "displayMode": "list",
          "placement": "bottom",
          "showLegend": True
        },
        "tooltip": {
          "hideZeros": False,
          "mode": "single",
          "sort": "none"
        }
      },
      "pluginVersion": "12.1.1",
      "targets": [
        {
          "editorMode": "code",
          "expr": "cometbft_consensus_height\n{installation=\"bb-mainnet-reth\"}",
          "legendFormat": "CL Height",
          "range": True,
          "refId": "A"
        }
      ],
      "title": "CL Height",
      "type": "timeseries"
    },
    {
      "datasource": {
        "type": "prometheus",
        "uid": "aeveen1aeky68e"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "palette-classic"
          },
          "custom": {
            "axisBorderShow": False,
            "axisCenteredZero": False,
            "axisColorMode": "text",
            "axisLabel": "",
            "axisPlacement": "auto",
            "barAlignment": 0,
            "barWidthFactor": 0.6,
            "drawStyle": "line",
            "fillOpacity": 0,
            "gradientMode": "none",
            "hideFrom": {
              "legend": False,
              "tooltip": False,
              "viz": False
            },
            "insertNulls": False,
            "lineInterpolation": "linear",
            "lineWidth": 1,
            "pointSize": 5,
            "scaleDistribution": {
              "type": "linear"
            },
            "showPoints": "auto",
            "spanNulls": False,
            "stacking": {
              "group": "A",
              "mode": "none"
            },
            "thresholdsStyle": {
              "mode": "off"
            }
          },
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": 0
              }
            ]
          },
          "unit": "sishort"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 8,
        "w": 6,
        "x": 6,
        "y": 2
      },
      "id": 618,
      "options": {
        "legend": {
          "calcs": [],
          "displayMode": "list",
          "placement": "bottom",
          "showLegend": False
        },
        "tooltip": {
          "hideZeros": False,
          "mode": "single",
          "sort": "none"
        }
      },
      "pluginVersion": "12.1.1",
      "targets": [
        {
          "disableTextWrap": False,
          "editorMode": "builder",
          "expr": "reth_sync_checkpoint{installation=\"bb-mainnet-reth\"}",
          "fullMetaSearch": False,
          "includeNullMetadata": True,
          "legendFormat": "{{stage}}",
          "range": True,
          "refId": "A",
          "useBackend": False
        }
      ],
      "title": "EL Height",
      "type": "timeseries"
    },
    {
      "datasource": {
        "type": "prometheus",
        "uid": "aeveen1aeky68e"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "palette-classic"
          },
          "custom": {
            "axisBorderShow": False,
            "axisCenteredZero": False,
            "axisColorMode": "text",
            "axisLabel": "",
            "axisPlacement": "auto",
            "axisSoftMin": 0,
            "barAlignment": 0,
            "barWidthFactor": 0.6,
            "drawStyle": "line",
            "fillOpacity": 0,
            "gradientMode": "none",
            "hideFrom": {
              "legend": False,
              "tooltip": False,
              "viz": False
            },
            "insertNulls": False,
            "lineInterpolation": "linear",
            "lineWidth": 1,
            "pointSize": 5,
            "scaleDistribution": {
              "type": "linear"
            },
            "showPoints": "auto",
            "spanNulls": False,
            "stacking": {
              "group": "A",
              "mode": "none"
            },
            "thresholdsStyle": {
              "mode": "off"
            }
          },
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": 0
              }
            ]
          }
        },
        "overrides": []
      },
      "gridPos": {
        "h": 4,
        "w": 6,
        "x": 12,
        "y": 2
      },
      "id": 619,
      "options": {
        "legend": {
          "calcs": [],
          "displayMode": "list",
          "placement": "bottom",
          "showLegend": False
        },
        "tooltip": {
          "hideZeros": False,
          "mode": "multi",
          "sort": "none"
        }
      },
      "pluginVersion": "12.1.1",
      "targets": [
        {
          "editorMode": "code",
          "expr": "reth_network_outgoing_connections{installation=\"bb-mainnet-reth\"}",
          "legendFormat": "outgoing",
          "range": True,
          "refId": "A"
        },
        {
          "editorMode": "code",
          "expr": "reth_network_incoming_connections{installation=\"bb-mainnet-reth\"}",
          "legendFormat": "incoming",
          "range": True,
          "refId": "B"
        }
      ],
      "title": "Reth Peers",
      "type": "timeseries"
    },
    {
      "datasource": {
        "type": "prometheus",
        "uid": "aeveen1aeky68e"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "palette-classic"
          },
          "custom": {
            "axisBorderShow": False,
            "axisCenteredZero": False,
            "axisColorMode": "text",
            "axisLabel": "",
            "axisPlacement": "auto",
            "axisSoftMin": 0,
            "barAlignment": 0,
            "barWidthFactor": 0.6,
            "drawStyle": "line",
            "fillOpacity": 0,
            "gradientMode": "none",
            "hideFrom": {
              "legend": False,
              "tooltip": False,
              "viz": False
            },
            "insertNulls": False,
            "lineInterpolation": "linear",
            "lineWidth": 1,
            "pointSize": 5,
            "scaleDistribution": {
              "type": "linear"
            },
            "showPoints": "auto",
            "spanNulls": False,
            "stacking": {
              "group": "A",
              "mode": "none"
            },
            "thresholdsStyle": {
              "mode": "off"
            }
          },
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": 0
              },
              {
                "color": "red",
                "value": 80
              }
            ]
          }
        },
        "overrides": []
      },
      "gridPos": {
        "h": 4,
        "w": 6,
        "x": 18,
        "y": 2
      },
      "id": 623,
      "options": {
        "legend": {
          "calcs": [
            "lastNotNull"
          ],
          "displayMode": "list",
          "placement": "bottom",
          "showLegend": False
        },
        "tooltip": {
          "hideZeros": False,
          "mode": "single",
          "sort": "none"
        }
      },
      "pluginVersion": "12.1.1",
      "targets": [
        {
          "disableTextWrap": False,
          "editorMode": "builder",
          "expr": "reth_transaction_pool_queued_pool_transactions{installation=\"bb-mainnet-reth\"}",
          "fullMetaSearch": False,
          "includeNullMetadata": True,
          "legendFormat": "queued",
          "range": True,
          "refId": "A",
          "useBackend": False
        },
        {
          "datasource": {
            "type": "prometheus",
            "uid": "aeveen1aeky68e"
          },
          "disableTextWrap": False,
          "editorMode": "builder",
          "expr": "reth_transaction_pool_pending_pool_transactions{installation=\"bb-mainnet-reth\"}",
          "fullMetaSearch": False,
          "hide": False,
          "includeNullMetadata": True,
          "instant": False,
          "legendFormat": "pending",
          "range": True,
          "refId": "B",
          "useBackend": False
        }
      ],
      "title": "Reth txpool",
      "type": "timeseries"
    },
    {
      "datasource": {
        "type": "prometheus",
        "uid": "aeveen1aeky68e"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "palette-classic"
          },
          "custom": {
            "axisBorderShow": False,
            "axisCenteredZero": False,
            "axisColorMode": "text",
            "axisLabel": "",
            "axisPlacement": "auto",
            "barAlignment": 0,
            "barWidthFactor": 0.6,
            "drawStyle": "line",
            "fillOpacity": 0,
            "gradientMode": "none",
            "hideFrom": {
              "legend": False,
              "tooltip": False,
              "viz": False
            },
            "insertNulls": False,
            "lineInterpolation": "linear",
            "lineWidth": 1,
            "pointSize": 5,
            "scaleDistribution": {
              "type": "linear"
            },
            "showPoints": "auto",
            "spanNulls": False,
            "stacking": {
              "group": "A",
              "mode": "none"
            },
            "thresholdsStyle": {
              "mode": "off"
            }
          },
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": 0
              }
            ]
          }
        },
        "overrides": []
      },
      "gridPos": {
        "h": 4,
        "w": 6,
        "x": 0,
        "y": 6
      },
      "id": 621,
      "options": {
        "legend": {
          "calcs": [],
          "displayMode": "list",
          "placement": "bottom",
          "showLegend": True
        },
        "tooltip": {
          "hideZeros": False,
          "mode": "multi",
          "sort": "none"
        }
      },
      "pluginVersion": "12.1.1",
      "targets": [
        {
          "editorMode": "code",
          "expr": "cometbft_p2p_peers{installation=\"bb-mainnet-reth\"}",
          "legendFormat": "CL Peers",
          "range": True,
          "refId": "A"
        }
      ],
      "title": "CL Peers",
      "type": "timeseries"
    },
    {
      "datasource": {
        "type": "prometheus",
        "uid": "aeveen1aeky68e"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "palette-classic"
          },
          "custom": {
            "axisBorderShow": False,
            "axisCenteredZero": False,
            "axisColorMode": "text",
            "axisLabel": "",
            "axisPlacement": "auto",
            "barAlignment": 0,
            "barWidthFactor": 0.6,
            "drawStyle": "line",
            "fillOpacity": 0,
            "gradientMode": "none",
            "hideFrom": {
              "legend": False,
              "tooltip": False,
              "viz": False
            },
            "insertNulls": False,
            "lineInterpolation": "linear",
            "lineWidth": 1,
            "pointSize": 5,
            "scaleDistribution": {
              "type": "linear"
            },
            "showPoints": "auto",
            "spanNulls": False,
            "stacking": {
              "group": "A",
              "mode": "none"
            },
            "thresholdsStyle": {
              "mode": "off"
            }
          },
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": 0
              }
            ]
          },
          "unit": "sishort"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 4,
        "w": 6,
        "x": 12,
        "y": 6
      },
      "id": 620,
      "options": {
        "legend": {
          "calcs": [],
          "displayMode": "list",
          "placement": "bottom",
          "showLegend": False
        },
        "tooltip": {
          "hideZeros": False,
          "mode": "single",
          "sort": "none"
        }
      },
      "pluginVersion": "12.1.1",
      "targets": [
        {
          "editorMode": "code",
          "expr": "reth_sync_execution_gas_per_second{installation=\"bb-mainnet-reth\"}",
          "legendFormat": "gas/sec",
          "range": True,
          "refId": "A"
        }
      ],
      "title": "Reth Performance gas/sec",
      "type": "timeseries"
    }
  ],
  "title": "Reth Template",
  "type": "row"
}

# Geth template (panels[2])
GETH_TEMPLATE = {
  "collapsed": True,
  "gridPos": {
    "h": 1,
    "w": 24,
    "x": 0,
    "y": 2
  },
  "id": 630,
  "panels": [
    {
      "datasource": {
        "type": "prometheus",
        "uid": "aeveen1aeky68e"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "palette-classic"
          },
          "custom": {
            "axisBorderShow": False,
            "axisCenteredZero": False,
            "axisColorMode": "text",
            "axisLabel": "",
            "axisPlacement": "auto",
            "barAlignment": 0,
            "barWidthFactor": 0.6,
            "drawStyle": "line",
            "fillOpacity": 0,
            "gradientMode": "none",
            "hideFrom": {
              "legend": False,
              "tooltip": False,
              "viz": False
            },
            "insertNulls": False,
            "lineInterpolation": "linear",
            "lineWidth": 1,
            "pointSize": 5,
            "scaleDistribution": {
              "type": "linear"
            },
            "showPoints": "auto",
            "spanNulls": False,
            "stacking": {
              "group": "A",
              "mode": "none"
            },
            "thresholdsStyle": {
              "mode": "off"
            }
          },
          "fieldMinMax": False,
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": 0
              }
            ]
          },
          "unit": "none"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 4,
        "w": 6,
        "x": 0,
        "y": 3
      },
      "id": 625,
      "options": {
        "legend": {
          "calcs": [
            "lastNotNull"
          ],
          "displayMode": "list",
          "placement": "bottom",
          "showLegend": True
        },
        "tooltip": {
          "hideZeros": False,
          "mode": "single",
          "sort": "none"
        }
      },
      "pluginVersion": "12.1.1",
      "targets": [
        {
          "editorMode": "code",
          "expr": "cometbft_consensus_height\n{installation=\"bb-testnet-geth\"}",
          "legendFormat": "CL Height",
          "range": True,
          "refId": "A"
        }
      ],
      "title": "CL Height",
      "type": "timeseries"
    },
    {
      "datasource": {
        "type": "prometheus",
        "uid": "aeveen1aeky68e"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "palette-classic"
          },
          "custom": {
            "axisBorderShow": False,
            "axisCenteredZero": False,
            "axisColorMode": "text",
            "axisLabel": "",
            "axisPlacement": "auto",
            "barAlignment": 0,
            "barWidthFactor": 0.6,
            "drawStyle": "line",
            "fillOpacity": 0,
            "gradientMode": "none",
            "hideFrom": {
              "legend": False,
              "tooltip": False,
              "viz": False
            },
            "insertNulls": False,
            "lineInterpolation": "linear",
            "lineWidth": 1,
            "pointSize": 5,
            "scaleDistribution": {
              "type": "linear"
            },
            "showPoints": "auto",
            "spanNulls": False,
            "stacking": {
              "group": "A",
              "mode": "none"
            },
            "thresholdsStyle": {
              "mode": "off"
            }
          },
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": 0
              }
            ]
          },
          "unit": "sishort"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 8,
        "w": 6,
        "x": 6,
        "y": 3
      },
      "id": 626,
      "options": {
        "legend": {
          "calcs": [
            "lastNotNull"
          ],
          "displayMode": "table",
          "placement": "right",
          "showLegend": False
        },
        "tooltip": {
          "hideZeros": False,
          "mode": "single",
          "sort": "none"
        }
      },
      "pluginVersion": "12.1.1",
      "targets": [
        {
          "editorMode": "code",
          "expr": "chain_head_finalized{installation=\"bb-testnet-geth\"}",
          "legendFormat": "finalized",
          "range": True,
          "refId": "A"
        },
        {
          "datasource": {
            "type": "prometheus",
            "uid": "aeveen1aeky68e"
          },
          "disableTextWrap": False,
          "editorMode": "builder",
          "expr": "chain_head_header{installation=\"bb-testnet-geth\"}",
          "fullMetaSearch": False,
          "hide": False,
          "includeNullMetadata": True,
          "instant": False,
          "legendFormat": "header",
          "range": True,
          "refId": "B",
          "useBackend": False
        },
        {
          "datasource": {
            "type": "prometheus",
            "uid": "aeveen1aeky68e"
          },
          "disableTextWrap": False,
          "editorMode": "builder",
          "expr": "chain_head_receipt{installation=\"bb-testnet-geth\"}",
          "fullMetaSearch": False,
          "hide": False,
          "includeNullMetadata": True,
          "instant": False,
          "legendFormat": "receipt",
          "range": True,
          "refId": "C",
          "useBackend": False
        }
      ],
      "title": "EL Height",
      "type": "timeseries"
    },
    {
      "datasource": {
        "type": "prometheus",
        "uid": "aeveen1aeky68e"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "palette-classic"
          },
          "custom": {
            "axisBorderShow": False,
            "axisCenteredZero": False,
            "axisColorMode": "text",
            "axisLabel": "",
            "axisPlacement": "auto",
            "axisSoftMin": 0,
            "barAlignment": 0,
            "barWidthFactor": 0.6,
            "drawStyle": "line",
            "fillOpacity": 0,
            "gradientMode": "none",
            "hideFrom": {
              "legend": False,
              "tooltip": False,
              "viz": False
            },
            "insertNulls": False,
            "lineInterpolation": "linear",
            "lineWidth": 1,
            "pointSize": 5,
            "scaleDistribution": {
              "type": "linear"
            },
            "showPoints": "auto",
            "spanNulls": False,
            "stacking": {
              "group": "A",
              "mode": "none"
            },
            "thresholdsStyle": {
              "mode": "off"
            }
          },
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": 0
              }
            ]
          }
        },
        "overrides": []
      },
      "gridPos": {
        "h": 4,
        "w": 6,
        "x": 12,
        "y": 3
      },
      "id": 628,
      "options": {
        "legend": {
          "calcs": [],
          "displayMode": "list",
          "placement": "bottom",
          "showLegend": False
        },
        "tooltip": {
          "hideZeros": False,
          "mode": "multi",
          "sort": "none"
        }
      },
      "pluginVersion": "12.1.1",
      "targets": [
        {
          "editorMode": "code",
          "expr": "p2p_peers_inbound{installation=\"bb-testnet-geth\"}",
          "legendFormat": "inbound",
          "range": True,
          "refId": "A"
        },
        {
          "editorMode": "code",
          "expr": "p2p_peers_outbound{installation=\"bb-testnet-geth\"}",
          "legendFormat": "outbound",
          "range": True,
          "refId": "B"
        }
      ],
      "title": "Geth Peers",
      "type": "timeseries"
    },
    {
      "datasource": {
        "type": "prometheus",
        "uid": "aeveen1aeky68e"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "palette-classic"
          },
          "custom": {
            "axisBorderShow": False,
            "axisCenteredZero": False,
            "axisColorMode": "text",
            "axisLabel": "",
            "axisPlacement": "auto",
            "axisSoftMin": 0,
            "barAlignment": 0,
            "barWidthFactor": 0.6,
            "drawStyle": "line",
            "fillOpacity": 0,
            "gradientMode": "none",
            "hideFrom": {
              "legend": False,
              "tooltip": False,
              "viz": False
            },
            "insertNulls": False,
            "lineInterpolation": "linear",
            "lineWidth": 1,
            "pointSize": 5,
            "scaleDistribution": {
              "type": "linear"
            },
            "showPoints": "auto",
            "spanNulls": False,
            "stacking": {
              "group": "A",
              "mode": "none"
            },
            "thresholdsStyle": {
              "mode": "off"
            }
          },
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": 0
              },
              {
                "color": "red",
                "value": 80
              }
            ]
          }
        },
        "overrides": []
      },
      "gridPos": {
        "h": 4,
        "w": 6,
        "x": 18,
        "y": 3
      },
      "id": 627,
      "options": {
        "legend": {
          "calcs": [
            "lastNotNull"
          ],
          "displayMode": "table",
          "placement": "right",
          "showLegend": False
        },
        "tooltip": {
          "hideZeros": False,
          "mode": "single",
          "sort": "none"
        }
      },
      "pluginVersion": "12.1.1",
      "targets": [
        {
          "disableTextWrap": False,
          "editorMode": "builder",
          "expr": "txpool_pending{installation=\"bb-testnet-geth\"}",
          "fullMetaSearch": False,
          "includeNullMetadata": True,
          "legendFormat": "pending",
          "range": True,
          "refId": "A",
          "useBackend": False
        },
        {
          "datasource": {
            "type": "prometheus",
            "uid": "aeveen1aeky68e"
          },
          "disableTextWrap": False,
          "editorMode": "builder",
          "expr": "txpool_queued{installation=\"bb-testnet-geth\"}",
          "fullMetaSearch": False,
          "hide": False,
          "includeNullMetadata": True,
          "instant": False,
          "legendFormat": "queued",
          "range": True,
          "refId": "B",
          "useBackend": False
        }
      ],
      "title": "Geth txpool",
      "type": "timeseries"
    },
    {
      "datasource": {
        "type": "prometheus",
        "uid": "aeveen1aeky68e"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "palette-classic"
          },
          "custom": {
            "axisBorderShow": False,
            "axisCenteredZero": False,
            "axisColorMode": "text",
            "axisLabel": "",
            "axisPlacement": "auto",
            "barAlignment": 0,
            "barWidthFactor": 0.6,
            "drawStyle": "line",
            "fillOpacity": 0,
            "gradientMode": "none",
            "hideFrom": {
              "legend": False,
              "tooltip": False,
              "viz": False
            },
            "insertNulls": False,
            "lineInterpolation": "linear",
            "lineWidth": 1,
            "pointSize": 5,
            "scaleDistribution": {
              "type": "linear"
            },
            "showPoints": "auto",
            "spanNulls": False,
            "stacking": {
              "group": "A",
              "mode": "none"
            },
            "thresholdsStyle": {
              "mode": "off"
            }
          },
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": 0
              }
            ]
          }
        },
        "overrides": []
      },
      "gridPos": {
        "h": 4,
        "w": 6,
        "x": 0,
        "y": 7
      },
      "id": 629,
      "options": {
        "legend": {
          "calcs": [],
          "displayMode": "list",
          "placement": "bottom",
          "showLegend": True
        },
        "tooltip": {
          "hideZeros": False,
          "mode": "multi",
          "sort": "none"
        }
      },
      "pluginVersion": "12.1.1",
      "targets": [
        {
          "editorMode": "code",
          "expr": "cometbft_p2p_peers{installation=\"bb-testnet-geth\"}",
          "legendFormat": "CL Peers",
          "range": True,
          "refId": "A"
        }
      ],
      "title": "CL Peers",
      "type": "timeseries"
    }
  ],
  "title": "Geth Template",
  "type": "row"
}


def parse_installation_toml(toml_path):
    """Parse installation.toml to get chain and client information."""
    config = {}
    try:
        with open(toml_path, 'r') as f:
            content = f.read()
            
        # Extract chain from [network] section
        chain_match = re.search(r'chain\s*=\s*["\']([^"\']+)["\']', content)
        if chain_match:
            config['chain'] = chain_match.group(1)
            
        # Extract el_client from [clients] section
        el_client_match = re.search(r'el_client\s*=\s*["\']([^"\']+)["\']', content)
        if el_client_match:
            config['el_client'] = el_client_match.group(1)
            
    except Exception as e:
        print(f"Error parsing {toml_path}: {e}", file=sys.stderr)
        
    return config


def get_templates():
    """Return the hardcoded templates."""
    return {
        'system': SYSTEM_TEMPLATE,
        'reth': RETH_TEMPLATE,
        'geth': GETH_TEMPLATE
    }


def substitute_installation_name(template, installation_name):
    """Substitute installation-specific names in the template and set a friendly title."""
    template_str = json.dumps(template)
    # Replace all known placeholders
    for placeholder in ['bb-testnet-reth', 'bb-mainnet-reth', 'bb-testnet-geth', 'bb-mainnet-geth']:
        template_str = template_str.replace(placeholder, installation_name)

    template_dict = json.loads(template_str)

    # Determine client from contents and set title
    chain = installation_name.split('-')[1] if '-' in installation_name else 'unknown'
    title = template_dict.get('title', '')
    panels_json = json.dumps(template_dict.get('panels', []))
    if 'Reth' in title or 'reth_' in panels_json:
        template_dict['title'] = f'{chain.title()} Reth Installation ({installation_name})'
    elif 'Geth' in title or 'txpool_' in panels_json or 'p2p_peers_' in panels_json:
        template_dict['title'] = f'{chain.title()} Geth Installation ({installation_name})'

    return template_dict


def update_datasource_uid(dashboard, new_uid):
    """Update all datasource UIDs in the dashboard to the new UID."""
    def update_panel_datasource(panel):
        """Recursively update datasource UID in a panel."""
        if isinstance(panel, dict):
            # Check if this is a datasource field
            if 'datasource' in panel and 'uid' in panel['datasource']:
                if panel['datasource']['type'] == 'prometheus':
                    panel['datasource']['uid'] = new_uid
            
            # Recursively process all values
            for value in panel.values():
                update_panel_datasource(value)
        elif isinstance(panel, list):
            # Recursively process list items
            for item in panel:
                update_panel_datasource(item)
    
    update_panel_datasource(dashboard)
    return dashboard


def main():
    """Generate the Grafana dashboard JSON."""
    # Parse command line arguments
    if len(sys.argv) < 3:
        print("Usage: python3 grafana.py <installations_dir> <output_file> [datasource_uid]", file=sys.stderr)
        return 1
    
    installations_dir = Path(sys.argv[1])
    output_file = Path(sys.argv[2])
    datasource_uid = sys.argv[3] if len(sys.argv) > 3 else None
    
    if not installations_dir.exists():
        print(f"Installations directory not found: {installations_dir}", file=sys.stderr)
        return 1
        
    installations = []
    for install_dir in installations_dir.iterdir():
        if install_dir.is_dir():
            toml_path = install_dir / 'installation.toml'
            if toml_path.exists():
                config = parse_installation_toml(toml_path)
                installations.append({
                    'name': install_dir.name,
                    'config': config
                })
    
    if not installations:
        print("No installations found", file=sys.stderr)
        return 1
    
    # Load templates
    templates = get_templates()
    
    # Start building the dashboard
    dashboard = {
        "annotations": {
            "list": [
                {
                    "builtIn": 1,
                    "datasource": {
                        "type": "grafana",
                        "uid": "-- Grafana --"
                    },
                    "enable": True,
                    "hide": True,
                    "iconColor": "rgba(0, 211, 255, 1)",
                    "name": "Annotations & Alerts",
                    "type": "dashboard"
                }
            ]
        },
        "editable": True,
        "fiscalYearStartMonth": 0,
        "graphTooltip": 0,
        "id": 14,
        "links": [],
        "panels": [],
        "preload": False,
        "refresh": "1m",
        "schemaVersion": 41,
        "tags": ["berabox", "unified", "monitoring"],
        "templating": {"list": []},
        "time": {"from": "now-1h", "to": "now"},
        "timepicker": {},
        "timezone": "browser",
        "title": "Berabox - Multi-Installation Dashboard",
        "uid": "berabox-dashboard",
        "version": 6
    }
    
    # Add system infrastructure row (always first)
    system_row = templates['system'].copy()
    dashboard['panels'].append(system_row)
    
    # Add installation-specific rows
    y_position = 1
    for installation in installations:
        el_client = installation['config'].get('el_client', '').lower()
        
        if el_client == 'reth':
            template = substitute_installation_name(templates['reth'], installation['name'])
        elif el_client == 'geth':
            template = substitute_installation_name(templates['geth'], installation['name'])
        else:
            print(f"Unknown EL client '{el_client}' for installation {installation['name']}", file=sys.stderr)
            continue
        
        # Update grid position
        template['gridPos']['y'] = y_position
        y_position += 1
        
        dashboard['panels'].append(template)
    
    # Update datasource UID if provided
    if datasource_uid:
        dashboard = update_datasource_uid(dashboard, datasource_uid)
    
    # Output the dashboard JSON
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, 'w') as f:
        json.dump(dashboard, f, indent=2)
    
    print(f"✅ Generated Grafana dashboard: {output_file}")
    return 0


if __name__ == '__main__':
    sys.exit(main())