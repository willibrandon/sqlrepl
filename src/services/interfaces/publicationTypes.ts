import { ReplicationType } from "./replicationTypes";

/**
 * Configuration options for creating a new publication.
 * Used when setting up a new replication publication on a SQL Server.
 */
export interface PublicationOptions {
    /** Name of the publication */
    name: string;

    /** Type of replication (snapshot or transactional) */
    type: ReplicationType;

    /** Optional description of the publication */
    description?: string;

    /** Network path where snapshot files will be stored */
    snapshotFolder: string;

    /** Name of the database containing the articles to publish */
    database: string;

    /** Array of table/article names to include in the publication */
    articles: string[];
}

/**
 * Represents a configured publication in SQL Server replication.
 * Contains the current state and settings of an existing publication.
 */
export interface Publication {
    /** Name of the publication */
    name: string;

    /** Description of the publication's purpose */
    description: string;

    /** Type of replication being used */
    type: ReplicationType;

    /** Current status of the publication */
    status: string;

    /** Whether changes are immediately synchronized */
    immediate_sync: boolean;

    /** Whether the publication is accessible over the internet */
    enabled_for_internet: boolean;

    /** Whether push subscriptions are allowed */
    allow_push: boolean;

    /** Whether pull subscriptions are allowed */
    allow_pull: boolean;

    /** Whether anonymous subscriptions are allowed */
    allow_anonymous: boolean;

    /** Whether the publication is ready for immediate synchronization */
    immediate_sync_ready: boolean;

    /** Whether transactional synchronization is allowed */
    allow_sync_tran: boolean;

    /** Name of the database containing the publication */
    database: string;
}