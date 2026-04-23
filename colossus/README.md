# Colossus Social Kernel v1.0 - Project Scope

## Overview

Colossus is a federated social platform architecture built on a **main kernel + mini-kernel** pattern. The system enables modular, category-specific social features while maintaining unified identity, discovery, and event propagation.

## Architecture

### Main Kernel
- **Central orchestrator** for the entire platform
- Handles unified identity management (users, follows, blocks)
- Runs the Discovery service for mini-kernel registration/heartbeat
- Aggregates feeds from all mini-kernels
- Provides GraphQL federation gateway
- Manages global events via NATS message bus

### Mini-Kernels (39 total)
Each mini-kernel is an **independent microservice** that:
- Extends `MiniKernelBase` class
- Implements category-specific data models and GraphQL resolvers
- Exposes `/feed`, `/events`, `/health`, `/capabilities` REST endpoints
- Registers with Discovery service on startup
- Sends heartbeats every 30 seconds
- Subscribes to relevant NATS events
- Stores data in isolated database tables (schema: `<category>_items`)

### Infrastructure
- **Kubernetes**: Helm charts for deployment
- **Terraform**: Cloud infrastructure provisioning
- **Docker**: Containerization for all services
- **NATS**: Event bus for cross-kernel communication
- **PostgreSQL**: Primary database per kernel
- **Apollo Federation**: GraphQL subgraph composition

## Mini-Kernel Categories

| ID | Category | Description |
|----|----------|-------------|
| MK-001 | photo-sharing | Photo uploads, likes, captions |
| MK-002 | messaging | Encrypted group messaging (AES-256-GCM) |
| MK-003 | video | Video uploads with HLS streaming |
| MK-004 | music | Track uploads, streaming, royalty calculation |
| MK-005 | live-dj | Live sessions, tips, real-time events |
| MK-006 | cad-collaboration | CAD file versioning, annotations |
| MK-007 | robotics | Robot models, simulation logs, sensor data |
| MK-008 | gaming | Match records, tournaments, clips |
| MK-009 | education | Courses, lessons, certificates |
| MK-010 | health | Private activity/medical records (encrypted) |
| MK-011 | finance | Portfolios, holdings, watchlists |
| MK-012 | travel | Trips, itineraries, meetups |
| MK-013 | food | Recipes, meal plans, restaurant reviews |
| MK-014 | art | Artworks, generative prompts, NFT minting |
| MK-015 | writing | Articles, series, newsletters |
| MK-016 | news | News posts, sources, fact-checks |
| MK-017 | environment | Sustainability tracking, challenges |
| MK-018 | parenting | Family groups, milestones, advice |
| MK-019 | events-calendar | Event creation, RSVPs, reminders |
| MK-020 | tech-opensource | Projects, contributions, bounties |
| MK-021 | professional | Job postings, applications, networking |
| MK-022 | ecommerce | Products, carts, orders |
| MK-023 | sports | Teams, matches, stats |
| MK-024 | mental-health | Journals, mood tracking, resources |

*(Full list of 39 kernels in `agents.jsonl`)*

## Key Design Principles

1. **Data Isolation**: Each mini-kernel owns its tables; no cross-kernel SQL joins
2. **Eventual Consistency**: Cross-kernel state sync via NATS events
3. **Privacy by Default**: Health/medical data encrypted at rest; private feeds
4. **No Plaintext Messaging**: Message content always stored as ciphertext
5. **Federated Identity**: `x-colossus-user-id` header propagates across all kernels
6. **Self-Registration**: Kernels auto-register with Discovery on startup
7. **Graceful Degradation**: Feed aggregation continues if individual kernels fail

## Implementation Tasks

Each mini-kernel requires:
1. `src/index.ts` - Main entry extending `MiniKernelBase`
2. Database migration (tables specific to category)
3. GraphQL type definitions and resolvers
4. `processFeed()` implementation (query by followed users)
5. `processEvent()` implementation (handle user.deleted, etc.)
6. Dockerfile (Node.js runtime)
7. Manifest in `shared/schemas/<category>-manifest.json`

## Testing Strategy

Verification criteria per kernel:
- GraphQL mutations return correct structure
- Feed endpoint respects follow graph
- Event processing handles cascade deletes
- Health/capabilities endpoints respond correctly
- NATS events published on state changes
- OAuth scopes declared in manifest match requirements

## Files Structure

```
colossus/
├── main-kernel/          # Core orchestrator
│   └── src/
│       ├── lib/mini-kernel-base.ts
│       ├── identity/
│       ├── feed/
│       ├── discovery/
│       └── orchestrator/
├── mini-kernels/         # 39 category-specific kernels
│   ├── photo-sharing/
│   ├── messaging/
│   └── ...
├── shared/
│   ├── proto/kernel.proto
│   ├── schemas/*-manifest.json
│   └── types/
├── infrastructure/
│   ├── helm/colossus/
│   ├── terraform/
│   └── scripts/deploy.sh
├── tools/cli/
├── docker-compose.yml
└── agents.jsonl          # Implementation task list
```

## Next Steps

1. Implement each mini-kernel per `agents.jsonl` tasks
2. Run verification tests per kernel
3. Deploy via Helm to Kubernetes cluster
4. Configure NATS, PostgreSQL, and Discovery service
