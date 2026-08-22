# nl3

`nl3` is a local-first federated chat prototype with:

- **1 Federation Node** (routing + node/group registry)
- **Multiple Community Nodes** (user accounts, message storage, UI)
- **Cross-node direct messaging**
- **Group chat + call signaling events**

## Repository layout

- `/Federation Node` — central routing/registry server (default port `3000`)
- `/Community Node` — chat node app (default port `3001`)
- `/.temp-node3` — temporary duplicate of Community Node used by cluster script
- `/start-cluster.js` — starts a 3-node local demo cluster

## Prerequisites

- Node.js 18+ (recommended)
- npm

## Install dependencies

Install dependencies in all three package roots:

```bash
npm install
cd "Federation Node" && npm install
cd "../Community Node" && npm install
```

## Quick start (recommended)

From the repository root:

```bash
node start-cluster.js
```

This starts:

- Federation Node: `http://localhost:3000`
- Community Node 2: `http://localhost:3001`
- Community Node 3: `http://localhost:3002`

> `start-cluster.js` intentionally resets local node data for clean end-to-end testing.

## Manual start

### 1) Start Federation Node

```bash
cd "Federation Node"
PORT=3000 node server.js
```

### 2) Start one or more Community Nodes

```bash
cd "Community Node"
PORT=3001 NODE_NAME=node2 CNODE_URL=http://localhost:3000 node server.js
```

For another node, run the same app from a separate copy with a different `PORT` and `NODE_NAME`.

## First-time setup flow (Community Node)

On first launch, open the Community Node URL and complete `/api/setup` via the setup UI:

1. Choose node details
2. Create admin account
3. Node saves config and connects to Federation Node

After setup, users can sign up/log in and message users on local or remote nodes.

## Persistence notes

- Community Node stores users/messages in `data.sqlite`
- Federation Node stores:
  - `nodes-registry.json` (node name ↔ UUID reservation)
  - `groups-registry.json` (group metadata)

## Current scripts

There are no npm run scripts for starting servers yet; run `node server.js` (or `node start-cluster.js`) directly.
