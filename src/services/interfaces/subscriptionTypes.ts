import { SubscriptionType } from './replicationTypes';

// Interface for subscription options
export interface SubscriptionOptions {
    publicationName: string;
    publisherServer: string;
    publisherDatabase: string;
    subscriberServer: string;
    subscriberDatabase: string;
    type: SubscriptionType;
    subscriptionName?: string;
    syncType: 'automatic' | 'immediate' | 'manual';
    loginForRemoteConnections?: string;
    passwordForRemoteConnections?: string;
}

// Interface for subscription
export interface Subscription {
    name: string;
    publication: string;
    publisher: string;
    publisherDb: string;
    subscriberDb: string;
    subscription_type: SubscriptionType;
    sync_type: string;
    status: string;
    last_sync?: Date;
}