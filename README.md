# Colossus Social Kernel

## Scope

Colossus is a decentralized, federated social network architecture built on a micro-kernel design pattern. The system separates core infrastructure (the "main kernel") from domain-specific features (the "mini-kernels"), enabling independent development, deployment, and governance of social features while maintaining interoperability through standardized protocols.

### Architecture Overview

**Main Kernel Services:**
- **Gateway** (port 4000): Unified GraphQL + REST API entry point with request routing
- **Identity** (port 4001): OAuth aggregation, DID/native auth, JWT issuance, user profile management
- **Feed** (port 4003): Content aggregation from mini-kernels with custom algorithm support
- **Orchestrator** (port 4004): Mini-kernel lifecycle management, health monitoring, auto-scaling
- **Discovery** (port 4002): Service registry for mini-kernel registration and lookup

**Mini-Kernels (25 Phase 0 domains):**
Each mini-kernel is an independent microservice implementing a specific social domain:
- Professional networking, Personal social, Photo sharing, Messaging (E2EE)
- Video, Music, Live DJ sessions, CAD collaboration, Robotics simulation
- Gaming, Education/courses, Health tracking (private), Finance portfolios
- Travel, Food/recipes, Art/NFTs, Writing/blogs, E-commerce
- News/fact-checking, Events calendar, Environment projects
- Tech/opensource, Sports, Parenting, Mental health (anonymous)

### Key Design Principles

1. **Zero-Trust Security**: mTLS between all services, NetworkPolicy isolation, Vault-based secret management
2. **Data Sovereignty**: Users own their data with full export/deletion rights (GDPR/CCPA compliant)
3. **End-to-End Encryption**: Sensitive content (messages, health records) encrypted client-side
4. **Federated Governance**: Locked core (gateway, identity, proto) requires 75% RFC approval; mini-kernels use lazy consensus
5. **Extensibility**: New mini-kernels can be spawned dynamically via gRPC registration
6. **Offline-First**: PWA client with service worker caching

### Technology Stack

- **Runtime**: Node.js 20+, TypeScript 5+
- **API**: GraphQL (Apollo), REST fallback, gRPC (mini-kernel protocol)
- **Database**: PostgreSQL 15+ with pgcrypto for encryption
- **Message Bus**: NATS JetStream for event streaming
- **Infrastructure**: Kubernetes, Helm, Terraform, Istio/Linkerd (mTLS)
- **Secrets**: HashiCorp Vault (transit encryption for OAuth tokens)
- **Observability**: Prometheus, Grafana, Loki, Jaeger
- **Client**: React + Vite PWA with code-split kernel modules

### Implementation Phases

**Phase 0 (Current):** Core infrastructure + 25 mini-kernel scaffolds
- Main kernel services with stub implementations
- Mini-kernel base class (MiniKernelBase) with abstract methods
- Docker + Kubernetes deployment manifests
- Basic CI/CD pipeline

**Phase 1:** Full mini-kernel business logic implementation
- Complete all MK-001 through MK-023 tasks
- Elasticsearch indexing for full-text search
- Custom algorithm sandboxing (isolated-vm / WASM)
- DID/native authentication flow

**Phase 2:** Production hardening
- Rate limiting, DDoS protection
- Multi-region deployment
- Advanced observability dashboards
- Performance optimization (connection pooling, caching)

**Phase 3:** Federation & governance
- Cross-instance federation protocol
- RFC voting system implementation
- Fork compatibility testing suite

### Directory Structure

```
colossus/
├── main-kernel/          # Core services (gateway, identity, feed, orchestrator, discovery)
├── mini-kernels/         # 25 domain-specific microservices
├── shared/               # Protobuf definitions, TypeScript types, JSON schemas
├── tools/cli/            # CLI for kernel management
├── infrastructure/       # Terraform, Helm charts, K8s manifests, scripts
├── client/               # React PWA web application
├── docs/                 # Governance, contributing, architecture decisions
└── migrations/           # Database schema migrations
```

### Getting Started

```bash
# Start minimal stack (gateway + identity + discovery + postgres + nats)
docker-compose up gateway identity discovery postgres nats

# Run all mini-kernels (resource intensive)
docker-compose up

# Add a new mini-kernel
./generate-kernels.sh <kernel-name>
```

See `docs/CONTRIBUTING.md` and `NEXTAURA_ENV.md` for detailed development setup.

### License

MIT License - see LICENSE file for details.

### Governance

See `docs/GOVERNANCE.md` for RFC process, locked core definition, and voting rules.
