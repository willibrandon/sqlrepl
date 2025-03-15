import { ReplicationType } from "./replicationTypes";

// Interface for publication options
export interface PublicationOptions {
    name: string;
    type: ReplicationType;
    description?: string;
    snapshotFolder: string;
    database: string;
    articles: string[];
}

// Interface for publication data
export interface Publication {
    name: string;
    description: string;
    type: ReplicationType;
    status: string;
    immediate_sync: boolean;
    enabled_for_internet: boolean;
    allow_push: boolean;
    allow_pull: boolean;
    allow_anonymous: boolean;
    immediate_sync_ready: boolean;
    allow_sync_tran: boolean;
    database: string;
}