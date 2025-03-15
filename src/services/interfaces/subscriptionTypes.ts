import { SubscriptionType } from './replicationTypes';

/**
 * Configuration options for creating a new subscription.
 * Used when setting up a new replication subscription.
 */
export interface SubscriptionOptions {
    /** Name of the publication to subscribe to */
    publicationName: string;

    /** Name of the publishing server */
    publisherServer: string;

    /** Name of the database containing the publication */
    publisherDatabase: string;

    /** Name of the subscribing server */
    subscriberServer: string;

    /** Name of the database to receive the replicated data */
    subscriberDatabase: string;

    /** Type of subscription (push or pull) */
    type: SubscriptionType;

    /** Optional custom name for the subscription */
    subscriptionName?: string;

    /** How the subscription should be synchronized */
    syncType: 'automatic' | 'immediate' | 'manual';

    /** Optional login for remote connections */
    loginForRemoteConnections?: string;

    /** Optional password for remote connections */
    passwordForRemoteConnections?: string;
}

/**
 * Represents an existing subscription in SQL Server replication.
 * Contains the current state and configuration of a subscription.
 */
export interface Subscription {
    /** Name of the subscription */
    name: string;

    /** Name of the publication being subscribed to */
    publication: string;

    /** Name of the publishing server */
    publisher: string;

    /** Name of the publisher database */
    publisherDb: string;

    /** Name of the subscriber database */
    subscriberDb: string;

    /** Type of subscription (push or pull) */
    subscription_type: SubscriptionType;

    /** How the subscription is synchronized */
    sync_type: string;

    /** Current status of the subscription */
    status: string;

    /** When the subscription was last synchronized */
    last_sync?: Date;
}