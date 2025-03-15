# Managing Subscriptions

This guide explains how to create and manage subscriptions to SQL Server replication publications using the SQL Replication Extension.

## Understanding Subscriptions

A subscription defines how a database receives replicated data from a publication. The SQL Replication Extension supports two types of subscriptions:

- **Push Subscriptions**: The distributor pushes changes to subscribers
- **Pull Subscriptions**: Subscribers request changes from the distributor

## Creating a Subscription

1. **Access the Subscriptions View**
   - Expand your server in the SQL Replication view
   - Either:
     - Right-click a publication to subscribe to it
     - Right-click the "Subscriptions" folder to browse available publications

2. **Choose Subscription Type**
   Select either:
   - **Push**: Better for immediate synchronization, managed at publisher
   - **Pull**: Better for occasional synchronization, managed at subscriber

3. **Configure Database**
   - Select or create the subscriber database
   - The database name can be different from the publisher

4. **Set Synchronization Options**
   Choose when to initialize the subscription:
   - **Immediate**: Start synchronization right away
   - **Automatic**: Wait for next snapshot
   - **Manual**: Initialize later manually

5. **Configure Security**
   - Choose authentication mode for remote connections
   - Set up service account permissions if needed

## Managing Existing Subscriptions

### Viewing Subscriptions
- Expand your server in the SQL Replication view
- Open the "Subscriptions" folder
- Click a subscription to view its properties

### Common Tasks

1. **Reinitialize Subscription**
   - Right-click the subscription
   - Select "Reinitialize"
   - Choose synchronization options
   - Monitor initialization progress

2. **Monitor Status**
   - Check status indicators
   - View agent job history
   - Monitor synchronization progress

3. **Drop Subscription**
   - Right-click the subscription
   - Select "Drop Subscription"
   - Confirm the removal

## Best Practices

1. **Subscription Planning**
   - Choose appropriate subscription type based on needs
   - Consider network bandwidth and latency
   - Plan for initialization time with large databases

2. **Performance Optimization**
   - Monitor agent job performance
   - Schedule initializations during off-peak hours
   - Configure appropriate retry intervals

3. **Security Considerations**
   - Use Windows Authentication when possible
   - Create dedicated service accounts
   - Regularly review permissions

4. **Maintenance Tasks**
   - Monitor subscription status
   - Check for synchronization delays
   - Validate data consistency periodically

## Troubleshooting

### Common Issues

1. **Initialization Failures**
   - Verify network connectivity
   - Check permissions on both sides
   - Review snapshot availability

2. **Synchronization Delays**
   - Monitor distribution agent
   - Check for blocking processes
   - Verify agent job status

3. **Security Errors**
   - Verify service account permissions
   - Check network security settings
   - Review firewall configurations

### Getting Help

If you encounter issues:
1. Check the Output panel for error messages
2. Review agent job history
3. See our [troubleshooting guide](../advanced/troubleshooting.md)
4. File issues on [GitHub](https://github.com/willibrandon/sqlrepl/issues)
