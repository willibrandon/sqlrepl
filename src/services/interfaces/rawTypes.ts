// Interface for raw publication data from SQL Server
export interface RawPublication {
    name: string;
    description: string;
    status: string;
    immediate_sync: boolean;
    enabled_for_internet: boolean;
    allow_push: boolean;
    allow_pull: boolean;
    allow_anonymous: boolean;
    immediate_sync_ready: boolean;
    allow_sync_tran: boolean;
    'replication frequency': number;
    [key: string]: unknown;
}