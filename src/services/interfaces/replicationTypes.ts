/** Type of replication being used (snapshot or transactional) */
export type ReplicationType = 'snapshot' | 'transactional';

/** Type of subscription (push or pull) determining how changes are propagated */
export type SubscriptionType = 'push' | 'pull';