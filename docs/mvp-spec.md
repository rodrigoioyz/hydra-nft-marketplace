Mvp-spec
Hydra NFT Marketplace MVP Spec
1. Purpose

Build a fixed-price NFT marketplace MVP that executes trades inside a Hydra Head on Cardano, using:

Hydra Head for low-latency, high-throughput off-chain transaction execution
Aiken for on-chain validator logic where escrow and settlement rules need to be enforced
TypeScript / Node.js for the application backend and Hydra API integration
Next.js / React for the user-facing web application
PostgreSQL for marketplace state, listings, order history, and operational auditability

The MVP should prove one core product thesis:

A buyer can purchase an NFT with near-instant settlement inside a Hydra Head, and the application can track and display that sale in a normal web UI.

2. MVP Goal

The MVP is successful when the team can demo the following end-to-end flow on a local devnet or Cardano preprod:

Open a Hydra Head operated by marketplace-controlled participants.
Commit ADA liquidity and at least one NFT into the Head.
Create a fixed-price listing for that NFT.
Show the listing in a web UI.
Execute a purchase inside the Head.
Reflect the updated ownership / sale state in the UI and backend.
Close and fan out the Head when needed.
3. Product Scope
In scope
Fixed-price NFT listings
Buy now flow
Seller cancellation flow
Hydra Head lifecycle management for a marketplace-operated Head
Web UI for listings, buy flow, and basic wallet interactions
Backend ingestion of Hydra events via WebSocket
Persistence of marketplace state in PostgreSQL
Optional Aiken validators for escrow/listing authorization rules
Local devnet and preprod support
Out of scope for MVP
Open public auctions
English auctions or bidding engines
Offers / counteroffers
Multi-collection royalty routing complexity
Fully permissionless direct participant onboarding into a Head
Cross-head liquidity
Advanced market maker logic
Sophisticated dispute recovery UX
Production-grade compliance / custodial controls
4. Why this architecture

Hydra Heads are best used for fast repeated interactions among a relatively small set of direct participants. That makes a delegated marketplace architecture the right MVP choice.

In this model:

The marketplace operators are the direct Hydra participants.
End users interact through a standard web app.
The app backend coordinates listing and trade execution.
Users do not need to operate Hydra nodes directly for the MVP.

This reduces protocol complexity while still demonstrating the key value of Hydra:

near-instant finality inside the Head
low transaction costs
Cardano-native UTxO semantics
5. User personas
Seller

A user who wants to list an NFT for a fixed ADA price.

Buyer

A user who wants to browse listings and purchase an NFT quickly.

Marketplace operator

A system operator running the Hydra infrastructure and backend services.

Admin

A technical user who needs visibility into Head status, liquidity, open listings, and failed submissions.

6. Functional requirements
6.1 Head lifecycle

The system must support:

initializing a Hydra Head
committing marketplace-controlled funds / inventory
detecting when the Head is open
submitting transactions into the Head
observing Head close events
observing readiness for fanout
handling fanout completion
6.2 Listing NFTs

The system must allow a seller to:

connect a supported Cardano wallet
select an owned NFT
specify a fixed ADA price
sign any required authorization payloads or L1 transaction
create a listing visible in the marketplace UI

The system must validate:

the NFT exists
seller is authorized to list it
the asset is not already listed
price is positive and above a minimum threshold
6.3 Buying NFTs

The system must allow a buyer to:

browse active listings
inspect NFT metadata
purchase a listed NFT using ADA available to the marketplace flow / Head flow

The system must ensure:

the listing is still active
the NFT is still available in the Head state
the buyer has sufficient funds
the resulting transaction pays seller and transfers NFT atomically
6.4 Cancelling listings

The system must allow cancellation when:

seller requests cancellation before purchase
listing is active
cancellation authorization is valid

The resulting flow must return the NFT to the seller or mark it as no longer for sale according to the selected custody model.

6.5 Marketplace state visibility

The system must provide:

listing status: draft / active / sold / cancelled / failed
Head status: idle / initializing / open / closed / contesting / fanout pending / finalized
recent sale history
operational logs for failed tx submissions
7. Non-functional requirements
Performance
Listing and buy actions should appear responsive in the UI.
Head-submitted transactions should be reflected in application state as soon as Hydra confirms them.
Reliability
The backend must survive restarts without losing marketplace state.
Hydra event ingestion should be resumable.
Submitted transactions should be idempotent at the application level.
Security
Private keys for operator infrastructure must never be exposed to the frontend.
Marketplace state transitions must be validated server-side.
Contract logic should minimize trusted assumptions.
Observability
The system should log Hydra command submissions and resulting events.
Admin metrics should track transaction success/failure and Head health.
Simplicity
MVP design should favor a small number of moving parts over maximal decentralization.
8. System architecture
8.1 Components
Frontend (Next.js)

Responsibilities:

wallet connection
listing creation form
listings browser
NFT detail page
buy button flow
portfolio view
admin Head status screen
Backend API (TypeScript / Node.js)

Responsibilities:

expose REST / RPC endpoints to the frontend
manage marketplace state machine
connect to Hydra node API over WebSocket / HTTP
build, validate, and submit transactions
ingest Hydra events
persist application state in PostgreSQL
Hydra integration service

Responsibilities:

connect to one or more marketplace Hydra nodes
query current snapshot UTxO
translate Hydra events into internal state updates
submit NewTx messages
track Head lifecycle transitions
Contracts (Aiken)

Responsibilities:

enforce listing or escrow rules if using script-based custody
validate authorized cancellations
validate settlement rules for sale execution
Database (PostgreSQL)

Responsibilities:

listings
users / wallet links
sale history
Hydra event journal
transaction submission attempts
Head session state
9. Recommended custody model for MVP

Use a marketplace-operated delegated Head.

There are two viable custody variants:

Option A — off-chain managed inventory (fastest MVP)
marketplace operators control the Head inventory
listing records are maintained off-chain
buy execution is enforced by backend logic plus Hydra UTxO checks

Pros

fastest to implement
smallest contract surface
easiest demo path

Cons

more trust in marketplace operator
weaker trust minimization
Option B — script-backed escrow with Aiken (best technical MVP)
listed NFTs move into an escrow UTxO
Aiken validator enforces sale and cancellation conditions
Hydra executes transactions that respect those same Cardano ledger rules

Pros

better trust minimization
stronger correctness story
cleaner path toward later decentralization

Cons

more implementation complexity
more testing burden
Recommendation

For the best MVP spec, define Option B as the target architecture, but allow Option A as a fallback implementation path if delivery risk becomes too high.

10. Asset and state model
10.1 Core domain objects
Listing
Listing {
  id: string
  sellerAddress: string
  policyId: string
  assetName: string
  unit: string
  priceLovelace: bigint
  status: "draft" | "active" | "sold" | "cancelled" | "failed"
  escrowTxHash?: string
  hydraHeadId: string
  createdAt: string
  updatedAt: string
}
Sale
Sale {
  id: string
  listingId: string
  buyerAddress: string
  sellerAddress: string
  unit: string
  priceLovelace: bigint
  hydraTxId: string
  status: "pending" | "confirmed" | "failed"
  createdAt: string
}
HeadSession
HeadSession {
  id: string
  status: "idle" | "initializing" | "open" | "closed" | "contesting" | "fanout_pending" | "finalized"
  network: "devnet" | "preprod"
  openedAt?: string
  closedAt?: string
  contestationDeadline?: string
  // Note: "contesting" is a blocking state between "closed" and "fanout_pending".
  // The Head cannot fanout until the contestation deadline passes.
  // During this period no new trades can execute.
}
11. Transaction flows
11.1 Listing flow
Objective

Move an NFT into the marketplace sale flow and mark it active.

Preferred flow
Seller connects wallet.
Seller selects NFT and sale price.
Frontend sends listing request to backend.
Backend validates ownership and market rules.
NFT is moved into escrow or committed inventory flow.
Backend stores listing as active.
Listing appears in the UI.
Success criteria
Listing is visible.
Asset is not double-listed.
Corresponding UTxO is discoverable in current Head or known pending flow.
11.2 Buy flow
Objective

Atomically transfer ADA to seller and NFT to buyer.

Preferred flow
Buyer clicks Buy.
Backend checks latest listing state.
Backend queries or uses mirrored Head UTxO.
Backend builds a Cardano transaction.
Backend submits transaction to Hydra via NewTx.
Hydra confirms transaction within Head progression.
Backend marks listing sold and records sale.
UI updates ownership and listing status.
Success criteria
no partial state
listing cannot be sold twice
NFT and ADA move atomically
11.3 Cancellation flow
Seller requests cancellation.
Backend validates seller authorization.
Backend builds cancellation transaction.
Transaction returns NFT to seller or removes escrow sale state.
Listing is marked cancelled.
12. Smart contract scope with Aiken

Aiken should be used only where it clearly improves correctness.

12.1 Minimum validator set
Listing / Escrow validator

Rules:

NFT unit must match listing datum
seller identity must match datum
sale price must match datum
valid purchase consumes listing UTxO and pays seller correctly
valid cancellation returns NFT to seller with seller authorization

Validator output traversal logic (buy case):
- find the output paying the seller address
- verify that output contains at least `price` lovelace
- find the output paying the buyer address
- verify that output contains the NFT (policy_id + asset_name, quantity 1)
- the listing UTxO must be consumed (input present in tx.inputs)
- seller address is derived from datum.seller (VerificationKeyHash → enterprise address)
Optional marketplace policy helpers

These are not required for the MVP unless you mint marketplace receipts or listing NFTs.

12.2 Suggested datum / redeemer design
Datum
pub type ListingDatum {
  seller: VerificationKeyHash,
  policy_id: ByteArray,
  asset_name: ByteArray,
  price: Int,
}
Redeemer
pub type ListingAction {
  Buy { buyer: VerificationKeyHash }
  Cancel
}
12.3 Aiken stdlib usage guidelines

Use stdlib to simplify and standardize:

list processing
option / result handling
pair / dictionary-like structures where appropriate
transaction context traversal helpers

Contract code should stay minimal, explicit, and heavily tested.

13. Hydra integration design
13.1 Hydra API usage

The backend must support:

WebSocket connection to hydra-node (default port 4001)
HTTP query of current snapshot UTxO: GET /snapshot/utxo
submission of transactions via NewTx: { "tag": "NewTx", "transaction": <signed-cbor> }
ingestion of lifecycle events: HeadIsInitializing, Committed, HeadIsOpen, TxValid, TxInvalid, SnapshotConfirmed, HeadIsClosed, ReadyToFanout

Contestation period note: all hydra-node participants must be started with the same --contestation-period flag. The node auto-contests if it sees a stale snapshot — the backend does not need to implement contestation logic, only model the state.
13.2 Event-driven state sync

The backend should treat Hydra as the source of truth for in-Head execution state.

Maintain a projection layer:

receive Hydra event
persist raw event journal
update derived marketplace tables
notify frontend through polling or WebSocket/SSE
13.3 Idempotency

Each command submission should have:

client request id
internal tx build id
hydra submission record
eventual reconciliation step

This prevents duplicated sales caused by retries.

14. API design
14.1 Suggested endpoints
Public / app endpoints
GET /api/listings
GET /api/listings/:id
POST /api/listings
POST /api/listings/:id/buy
POST /api/listings/:id/cancel
GET /api/portfolio/:address
GET /api/head/status
Admin endpoints
POST /api/admin/head/init
POST /api/admin/head/commit
POST /api/admin/head/close
GET /api/admin/events
GET /api/admin/tx-submissions
15. Database schema

Minimum tables:

wallet_users
listings
sales
head_sessions
hydra_events
tx_submissions
assets

Recommended indexing:

listings by status
listings by seller
sales by buyer
hydra events by head session and sequence
tx submissions by correlation id
16. Frontend requirements
16.1 Pages
/ marketplace listings
/listing/[id] listing detail
/sell create listing
/portfolio owned assets / active sales
/admin/head-status operational dashboard
16.2 UX requirements
clearly show Head online / offline / open / closed status
prevent duplicate clicks on buy
show pending transaction state
display NFT metadata and collection information
show success/failure outcomes clearly
17. Security model
17.1 Threats to consider
double purchase attempts
stale UI state causing invalid buys
unauthorized cancellation
backend replay of submissions
operator key misuse
mismatch between DB state and Head state
17.2 Mitigations
always re-check latest Head-derived listing state before buy
require server-side authorization for every state transition
use idempotency keys
audit every submission attempt
separate operator roles and secrets
reconcile DB projection against Hydra UTxO periodically
18. Testing strategy
18.1 Contract tests
valid buy succeeds
wrong price fails
wrong seller payout fails
unauthorized cancel fails
malformed datum fails
18.2 Backend integration tests
Hydra WebSocket ingestion
snapshot UTxO synchronization
tx build and submit lifecycle
duplicate submission handling
restart recovery from persisted events
18.3 End-to-end tests
seller lists NFT
buyer buys NFT
listing disappears or becomes sold
sale recorded in DB
Head closes and fanout completes
19. Environments
19.1 Local development

Use Docker Compose and local Hydra/devnet tooling for:

hydra nodes
backend
frontend
postgres
optional monitoring
19.2 Preprod demo

Deploy a narrow demo environment with:

2 or 3 marketplace-run hydra nodes
backend API
frontend
database
demo wallets and assets
20. Observability and operations

Track at minimum:

current Head status
number of active listings
number of pending submissions
transaction confirmation latency
Hydra WebSocket connectivity
failed tx builds / submissions

Admin dashboard should show:

last Hydra events
current mirrored UTxO snapshot metadata
current Head session
stuck / failed commands
21. Delivery plan
Milestone 1 — Hydra proof of execution
run hydra locally
open a Head
commit ADA and one NFT
submit a successful in-Head transfer
Milestone 2 — Listing and sale model
implement listing data model
implement buy and cancel flows
persist state in PostgreSQL
Milestone 3 — Contract-backed escrow
implement Aiken validator
test buy and cancel logic
integrate validator into listing flow
Milestone 4 — Demo UI
build listings page
build sell page
build buy flow
build admin Head status page
Milestone 5 — End-to-end demo
seed demo NFTs
demonstrate listing, buying, and closing Head
document operational runbook
22. Definition of done

The MVP is done when:

a Hydra Head can be opened in the target environment
an NFT can be listed for fixed-price sale
a buyer can purchase it inside the Head
the application records the sale correctly
the listing cannot be purchased twice
the UI shows updated state within seconds
the team can demo Head close and fanout
23. Best-practice guidance for writing this MVP spec

To create the best MVP spec for this stack, the spec should:

define one narrow success path first
separate protocol truth from app projection state
distinguish trusted operator behavior from trust-minimized contract behavior
avoid over-specifying future auction mechanics
make explicit which flows are in-Head versus on L1
include Head lifecycle and failure handling, not only happy-path trading
keep contract scope minimal and testable
define measurable demo success criteria
24. Recommended implementation choice

For the strongest balance of speed and technical credibility:

Hydra Head for transaction execution and Head lifecycle
TypeScript backend for fastest integration with WebSocket / HTTP APIs and frontend ecosystem
Aiken validator for escrow-backed listings and cancellation / purchase correctness
Next.js frontend for demoability and fast iteration
PostgreSQL for durable marketplace projection state

This gives the MVP a clear story:

Cardano-native NFT trades, executed at Hydra speed, with contract-enforced marketplace rules and a familiar web application UX.
