# PrivacyNet FL — Federated Learning Platform

A distributed machine learning system where users train a digit recognizer (0–9) locally in their browser, then share only the learned weights — **never their drawings** — to improve a global model.

## Architecture

```
┌─────────────────────────────────────┐
│         Browser (Client)            │
│                                     │
│  ┌─────────────┐  ┌──────────────┐  │
│  │  Drawing     │  │  TensorFlow  │  │
│  │  Canvas      │→ │  .js Model   │  │
│  └─────────────┘  └──────┬───────┘  │
│                          │          │
│  ┌─────────────┐         │          │
│  │  IndexedDB   │   extractWeights  │
│  │  (Dexie.js)  │         │          │
│  └─────────────┘         ↓          │
│                   ┌──────────────┐  │
│                   │  Socket.io   │──┼──→ WebSocket
│                   │  Client      │  │
│                   └──────────────┘  │
└─────────────────────────────────────┘
                       │
                       ↓
┌─────────────────────────────────────┐
│       Aggregation Server            │
│                                     │
│  ┌──────────────┐  ┌─────────────┐  │
│  │  Socket.io   │  │  Federated  │  │
│  │  Server      │→ │  Averaging  │  │
│  └──────────────┘  └──────┬──────┘  │
│                           │         │
│                    ┌──────↓──────┐  │
│                    │   MongoDB   │  │
│                    │  (Global    │  │
│                    │   Model)    │  │
│                    └─────────────┘  │
└─────────────────────────────────────┘
```

## Privacy Guarantee

**Your drawings never leave your browser.** Only the model weights (mathematical parameters learned from your data) are transmitted to the server. The server aggregates weights from multiple clients using the FedAvg algorithm and broadcasts the improved global model back to all participants.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Client ML | TensorFlow.js 4.11+ |
| Client Storage | IndexedDB (Dexie.js) |
| Client UI | React 18 + Vite |
| Transport | Socket.io |
| Server | Node.js 18+ / Express |
| Database | MongoDB (Mongoose) |
| Algorithm | Federated Averaging (FedAvg) |

## Model Architecture

```
Input (784) → Dense(128, ReLU) → Dropout(0.2) → Dense(64, ReLU) → Dense(10, Softmax)
```

- **Input**: 28×28 grayscale image, flattened to 784 pixels
- **Output**: 10 probabilities (one per digit 0–9)
- **Total Parameters**: ~109,386

## Quick Start

### Prerequisites
- Node.js 18+
- MongoDB running locally on port 27017

### Server
```bash
cd server
npm install
cp .env.example .env
npm run dev
```

### Client
```bash
cd client
npm install
npm run dev
```

The client runs at `http://localhost:5173` and the server at `http://localhost:3001`.

## Project Structure

```
privacynet-fl/
├── client/
│   ├── src/
│   │   ├── services/
│   │   │   ├── tensorflowService.js   # Model init, training, prediction
│   │   │   ├── indexedDBService.js     # Local drawing storage (Dexie.js)
│   │   │   └── socketService.js       # Real-time server communication
│   │   ├── utils/
│   │   │   └── modelHelpers.js        # Data gen, weight deltas, normalization
│   │   ├── App.jsx                    # Root component — data layer
│   │   └── main.jsx                   # React entry point
│   ├── package.json
│   └── vite.config.js
├── server/
│   ├── models/
│   │   ├── GlobalModel.js             # MongoDB schema — global model versions
│   │   └── TrainingSession.js         # MongoDB schema — client contributions
│   ├── services/
│   │   ├── federatedAveraging.js      # FedAvg algorithm implementation
│   │   └── modelManager.js            # Model lifecycle management
│   ├── sockets/
│   │   └── trainingSocket.js          # WebSocket protocol handlers
│   ├── server.js                      # Express + Socket.io entry point
│   └── package.json
└── README.md
```

## Federated Learning Protocol

1. **Client connects** → receives current participant count
2. **Client requests model** → server sends latest GlobalModel weights
3. **Client draws digits** → stored in IndexedDB (never sent to server)
4. **Client trains locally** → 10 epochs on local data
5. **Client submits weights** → only weight arrays sent via WebSocket
6. **Server aggregates** → when ≥ N clients submit, FedAvg runs
7. **Server broadcasts** → new global model sent to all clients
8. **Repeat** from step 3

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 | Server port |
| `MONGODB_URI` | mongodb://localhost:27017/privacynet | MongoDB connection string |
| `CLIENT_URL` | http://localhost:5173 | CORS origin for client |
| `MIN_CLIENTS_FOR_AGGREGATION` | 2 | Clients needed before FedAvg triggers |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Server health check |
| GET | `/api/model/latest` | Latest model metadata |
| GET | `/api/model/history` | Model version history |

## WebSocket Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `join_training` | Client → Server | `{ clientId }` |
| `request_global_model` | Client → Server | `{ clientId }` |
| `submit_weights` | Client → Server | `{ weights, localAccuracy, samplesUsed }` |
| `participant_count` | Server → Client | `{ count }` |
| `model_updated` | Server → Client | `{ version, weights, accuracy }` |
| `aggregation_complete` | Server → Client | `{ round, participantCount }` |
