# 2N Intercom Card

Lovelace card for the [2N Intercom](https://github.com/Ctrlable/2n-intercom)
Home Assistant integration.

![2N Intercom Card](images/card-screenshot.png)

## Installation via HACS

1. HACS → Frontend → ⋮ → Custom repositories
2. Add `https://github.com/Ctrlable/lovelace-2n-intercom`
3. Category: **Dashboard**
4. Install — resource is added automatically

## Manual install

Copy `dist/2n-intercom.js` to `/config/www/` and add as a Lovelace resource:
`/local/2n-intercom.js` (type: JavaScript Module)

## Card config

```yaml
type: custom:2n-intercom-card
entity_prefix: "front_door"
title: "Front Door Intercom"
show_camera: true
```

Requires the [2N Intercom integration](https://github.com/Ctrlable/2n-intercom).
