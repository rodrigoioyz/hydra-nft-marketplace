// Hydra WebSocket event types (v1.3.0)

export type HeadStatus =
  | "Idle"
  | "Initializing"
  | "Open"
  | "Closed"
  | "FanoutPossible"
  | "Final";

export type HydraEventTag =
  | "Greetings"
  | "HeadIsInitializing"
  | "Committed"
  | "HeadIsOpen"
  | "TxValid"
  | "TxInvalid"
  | "SnapshotConfirmed"
  | "HeadIsClosed"
  | "HeadIsContested"
  | "ReadyToFanout"
  | "HeadIsFinalized"
  | "CommandFailed"
  | "PostTxOnChainFailed"
  | "CommitRecorded"
  | "CommitApproved"
  | "CommitFinalized"
  | "DecommitRequested"
  | "DecommitApproved"
  | "DecommitInvalid"
  | "DecommitFinalized";

export interface HydraUtxo {
  address: string;
  datum: string | null;
  datumhash: string | null;
  inlineDatum: unknown | null;
  inlineDatumRaw: string | null;
  referenceScript: unknown | null;
  value: {
    lovelace: number;
    [assetId: string]: number | Record<string, number>;
  };
}

export type UtxoSet = Record<string, HydraUtxo>;

export interface GreetingsEvent {
  tag: "Greetings";
  headStatus: HeadStatus;
  hydraNodeVersion: string;
  hydraHeadId?: string;
  me: { vkey: string };
  env: {
    contestationPeriod: number;
    otherParties: { vkey: string }[];
    participants: string[];
  };
  networkInfo: { networkConnected: boolean };
}

export interface HeadIsOpenEvent {
  tag: "HeadIsOpen";
  headId: string;
  utxo: UtxoSet;
  seq: number;
  timestamp: string;
}

export interface TxValidEvent {
  tag: "TxValid";
  headId: string;
  transactionId: string;  // top-level in Hydra v1.2.0 — no nested transaction object
  seq: number;
  timestamp: string;
}

export interface TxInvalidEvent {
  tag: "TxInvalid";
  headId: string;
  transaction: { type: string; description: string; cborHex: string; txId?: string };
  utxo: UtxoSet;
  validationError: { reason: string };
  seq: number;
  timestamp: string;
}

export interface SnapshotConfirmedEvent {
  tag: "SnapshotConfirmed";
  headId: string;
  snapshot: {
    number: number;
    utxo: UtxoSet;
    confirmedTransactions: string[];
  };
  seq: number;
  timestamp: string;
}

export interface HeadIsClosedEvent {
  tag: "HeadIsClosed";
  headId: string;
  snapshotNumber: number;
  contestationDeadline: string;
  seq: number;
  timestamp: string;
}

export interface ReadyToFanoutEvent {
  tag: "ReadyToFanout";
  headId: string;
  seq: number;
  timestamp: string;
}

export interface HeadIsFinalizedEvent {
  tag: "HeadIsFinalized";
  headId: string;
  utxo: UtxoSet;
  seq: number;
  timestamp: string;
}

export interface CommandFailedEvent {
  tag: "CommandFailed";
  clientInput: unknown;
  seq: number;
  timestamp: string;
}

export type HydraEvent =
  | GreetingsEvent
  | HeadIsOpenEvent
  | TxValidEvent
  | TxInvalidEvent
  | SnapshotConfirmedEvent
  | HeadIsClosedEvent
  | ReadyToFanoutEvent
  | HeadIsFinalizedEvent
  | CommandFailedEvent
  | { tag: HydraEventTag; [key: string]: unknown };

// Commands sent TO Hydra
export interface NewTxCommand {
  tag: "NewTx";
  transaction: {
    cborHex: string;
    description: string;
    type: string;
  };
}

export interface InitCommand    { tag: "Init" }
export interface CollectCommand { tag: "Collect" }
export interface CloseCommand   { tag: "Close" }
export interface FanoutCommand  { tag: "Fanout" }

export type HydraCommand = NewTxCommand | InitCommand | CollectCommand | CloseCommand | FanoutCommand;
